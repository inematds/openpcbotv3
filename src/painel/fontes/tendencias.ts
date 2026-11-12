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
}

interface VideoBruto { id?: string; titulo?: string; canal?: string; views?: unknown; velocidade?: unknown; indisponivel?: unknown; nichos?: string[]; notas?: Record<string, unknown> }
interface Bruto {
  gerado_em?: string; videos?: VideoBruto[]; nichos?: string[];
  rodada?: { erros?: unknown[] };
  assuntos?: { geral?: { termo?: string; peso?: unknown }[] };
  porque?: { geral?: { conclusao?: string } };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const LINK_BOMBANDO = '/bombando/';

export const VAZIO_TENDENCIAS: DadosTendencias = { gerado_em: null, videos: 0, erros: 0, assuntos: [], conclusao: null, quentes: [], link: LINK_BOMBANDO };

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
  };
}

export function coletarTendencias(d: DepsPainel): { dados: DadosTendencias; ausentes: string[] } {
  const b = lerJson<Bruto>(join(d.caminhos.bombando, 'dados.json'));
  if (!b || typeof b !== 'object') return { ausentes: ['youtube-bombando/painel/dados.json'], dados: VAZIO_TENDENCIAS };
  return { ausentes: [], dados: normalizarTendencias(b) };
}
