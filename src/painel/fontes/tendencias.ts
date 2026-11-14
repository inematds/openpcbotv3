// Tendências de rede (Nei, 12/11/2026): resumo do youtube-bombando (~/projetos/youtube-bombando),
// que roda 1x por dia às 07:15 e grava painel/dados.json. Aqui só leitura; o painel completo
// é servido em /bombando/ (atrás do mesmo login do painel).
import { join } from 'node:path';

import type { DepsPainel } from '../tipos.js';
import { corta, lerJson, paraEpoch } from '../util.js';

export interface QuenteTend { nicho: string; id: string; titulo: string; canal: string; views: number | null; velocidade: number | null }
export interface DadosTendencias {
  gerado_em: number | null;
  videos: number;
  erros: number;
  assuntos: { termo: string; peso: number }[];
  conclusao: string | null;
  quentes: QuenteTend[];
  link: string;
  oportunidades: Oportunidades | null;
}

// Radar de oportunidades (Nei, 13/11/2026): ~/projetos/wifi/radar-oportunidades/painel.json, gravado pelo
// oportunidades.py (08:15 + a cada aprovação). "nao rodou" = passou das 09:45 e o arquivo não é de hoje.
export interface PautaOport { n: number; tema: string; slug: string; canal: string; estado: string; ultima: string }
export interface Oportunidades { data: string; estado: string; erro: string | null; atualizado: number | null; pautas: PautaOport[]; fora: { tema: string; motivo: string }[] }
const HORA_LIMITE_MIN = 9 * 60 + 45;

interface VideoBruto { id?: string; titulo?: string; canal?: string; views?: unknown; velocidade?: unknown; indisponivel?: unknown; nichos?: string[]; notas?: Record<string, unknown> }
interface Bruto {
  gerado_em?: string; videos?: VideoBruto[]; nichos?: string[];
  rodada?: { erros?: unknown[] };
  assuntos?: { geral?: { termo?: string; peso?: unknown }[] };
  porque?: { geral?: { conclusao?: string } };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const LINK_BOMBANDO = '/bombando/';

export const VAZIO_TENDENCIAS: DadosTendencias = { gerado_em: null, videos: 0, erros: 0, assuntos: [], conclusao: null, quentes: [], link: LINK_BOMBANDO, oportunidades: null };

export function normalizarTendencias(b: Bruto): DadosTendencias {
  const videos = Array.isArray(b.videos) ? b.videos : [];
  const quentes: QuenteTend[] = [];
  for (const nicho of Array.isArray(b.nichos) ? b.nichos : []) {
    let melhor: VideoBruto | null = null, nota = -Infinity;
    for (const v of videos) {
      if (v.indisponivel || !v.nichos?.includes(nicho) || num(v.velocidade) == null) continue;
      const x = num(v.notas?.[nicho]) ?? -Infinity;
      if (x > nota) { nota = x; melhor = v; }
    }
    if (melhor?.id) quentes.push({ nicho: corta(nicho, 60), id: corta(melhor.id, 20), titulo: corta(melhor.titulo ?? '', 140), canal: corta(melhor.canal ?? '', 80), views: num(melhor.views), velocidade: num(melhor.velocidade) });
  }
  return {
    gerado_em: paraEpoch(b.gerado_em),
    videos: videos.length,
    erros: Array.isArray(b.rodada?.erros) ? b.rodada!.erros!.length : 0,
    assuntos: (b.assuntos?.geral ?? []).filter((t) => t?.termo && num(t.peso) != null).slice(0, 8).map((t) => ({ termo: corta(t.termo!, 60), peso: t.peso as number })),
    conclusao: typeof b.porque?.geral?.conclusao === 'string' ? corta(b.porque.geral.conclusao, 300) : null,
    quentes,
    link: LINK_BOMBANDO,
    oportunidades: null,
  };
}

/** Data e minuto do dia em Brasília (UTC-3) para um epoch em segundos. */
function brasilia(epoch: number): { dia: string; min: number } {
  const t = new Date((epoch - 3 * 3600) * 1000);
  return { dia: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

interface OportBruto { data?: unknown; estado?: unknown; erro?: unknown; atualizado?: unknown; pautas?: unknown; fora?: unknown }
export function normalizarOportunidades(b: OportBruto | null, agora: number): Oportunidades {
  const hoje = brasilia(agora);
  const str = (v: unknown, n: number) => (typeof v === 'string' ? corta(v, n) : '');
  const data = str(b?.data, 10);
  if (!b || data !== hoje.dia) {
    const atrasado = hoje.min >= HORA_LIMITE_MIN;
    return { data: hoje.dia, estado: atrasado ? 'nao rodou' : 'aguardando 08:15', erro: atrasado ? 'o radar de oportunidades não rodou hoje' : null, atualizado: null, pautas: [], fora: [] };
  }
  const pautas = (Array.isArray(b.pautas) ? b.pautas : []).map((p: Record<string, unknown>) => ({
    n: num(p.n) ?? 0, tema: str(p.tema, 140), slug: str(p.slug, 60), canal: str(p.canal, 20), estado: str(p.estado, 20), ultima: str(p.ultima, 200),
  }));
  const fora = (Array.isArray(b.fora) ? b.fora : []).slice(0, 5).map((f: Record<string, unknown>) => ({ tema: str(f.tema, 140), motivo: str(f.motivo, 160) }));
  return { data, estado: str(b.estado, 20) || 'desconhecido', erro: str(b.erro, 220) || null, atualizado: num(b.atualizado), pautas, fora };
}

export function coletarTendencias(d: DepsPainel): { dados: DadosTendencias; ausentes: string[] } {
  const oportunidades = normalizarOportunidades(lerJson<OportBruto>(d.caminhos.oportunidades), d.agora());
  const b = lerJson<Bruto>(join(d.caminhos.bombando, 'dados.json'));
  if (!b || typeof b !== 'object') return { ausentes: ['youtube-bombando/painel/dados.json'], dados: { ...VAZIO_TENDENCIAS, oportunidades } };
  return { ausentes: [], dados: { ...normalizarTendencias(b), oportunidades } };
}
