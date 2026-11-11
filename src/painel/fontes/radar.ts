// Radar Viral (Nei, 10/11/2026): finviral, saudeviral, advviral, contaviral e futviral publicam no
// lives24 por uma fila única, 1 vídeo por hora (~/projetos/radar-viral). Aqui só leitura:
// radar.json (horários), historico.jsonl (o que saiu) e os marcadores PUBLICAR_PENDENTE nas edições.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { DepsPainel } from '../tipos.js';
import { corta, inicioDoDia, lerFim, lerJson, linhasJson, paraEpoch } from '../util.js';

interface NichoCfg { projeto: string; nome: string; gera: string; a_partir: string; metricool?: boolean }
interface RadarCfg { nome?: string; canal?: string; esquecer_apos_h?: number; nichos: NichoCfg[] }
interface LinhaHist { ts?: string; projeto?: string; nome?: string; edicao?: string; resultado?: string; url?: string | null; motivo?: string; tentativas?: number }

export interface ItemRadar { projeto: string; nome: string; edicao: string; video: string; desde: number; estado: 'liberado' | 'espera' | 'segurado'; a_partir: string }
export interface NichoRadar { projeto: string; nome: string; gera: string; a_partir: string; hoje: 'publicado' | 'na_fila' | 'erro' | 'nada'; url: string | null; quando: number | null }
export interface EnvioRadar { quando: number; projeto: string; nome: string; edicao: string; resultado: string; url: string | null; motivo: string | null }
export interface DadosRadar { nome: string; canal: string; nichos: NichoRadar[]; fila: ItemRadar[]; historico: EnvioRadar[]; hoje: number; erros_24h: number; proxima: number }

const minutos = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const SIDECAR = /\.(feito|segurado|esquecido|erro|tentativas|sem-metricool)$/;

/** Mesma regra do radar.py: marcado hoje só sai a partir do horário do nicho; marcado antes de hoje já pode. */
export function liberadoRadar(desde: number, aPartir: string, agora: number): boolean {
  const dia = inicioDoDia(agora);
  if (desde < dia) return true;
  return (agora - dia) / 60 >= minutos(aPartir);
}

export function filaRadar(raiz: string, cfg: RadarCfg, agora: number): ItemRadar[] {
  const out: ItemRadar[] = [];
  const lim = (cfg.esquecer_apos_h ?? 24) * 3600;
  for (const n of cfg.nichos) {
    const ed = join(raiz, n.projeto, 'edicoes');
    let eds: string[] = [];
    try { eds = readdirSync(ed); } catch { continue; }
    for (const e of eds) {
      let arqs: string[] = [];
      try { arqs = readdirSync(join(ed, e)).filter((a) => a.startsWith('PUBLICAR_PENDENTE.') && !SIDECAR.test(a)); } catch { continue; }
      for (const a of arqs) {
        let t = 0;
        try { t = Math.floor(statSync(join(ed, e, a)).mtimeMs / 1000); } catch { continue; }
        if (agora - t > lim) continue; // o radar esquece na próxima rodada
        const seg = existsSync(join(ed, e, 'SEGURAR'));
        out.push({ projeto: n.projeto, nome: n.nome, edicao: e, video: a.replace(/^PUBLICAR_PENDENTE\./, ''), desde: t, a_partir: n.a_partir,
          estado: seg ? 'segurado' : liberadoRadar(t, n.a_partir, agora) ? 'liberado' : 'espera' });
      }
    }
  }
  return out.sort((x, y) => x.desde - y.desde);
}

export function coletarRadar(d: DepsPainel): { dados: DadosRadar; ausentes: string[] } {
  const raiz = d.caminhos.raizProjetos;
  const agora = d.agora();
  const cfg = lerJson<RadarCfg>(join(raiz, 'radar-viral', 'radar.json'));
  if (!cfg || !Array.isArray(cfg.nichos)) return { ausentes: ['radar.json'], dados: { nome: 'Radar Viral', canal: 'lives24', nichos: [], fila: [], historico: [], hoje: 0, erros_24h: 0, proxima: (Math.floor(agora / 3600) + 1) * 3600 } };
  const hist: EnvioRadar[] = linhasJson<LinhaHist>(lerFim(join(raiz, 'radar-viral', 'historico.jsonl'), 64_000) ?? '')
    .map((l) => ({ quando: paraEpoch(l.ts) ?? 0, projeto: l.projeto ?? '?', nome: l.nome ?? l.projeto ?? '?', edicao: l.edicao ?? '', resultado: l.resultado ?? '?', url: l.url ?? null, motivo: l.motivo ? corta(l.motivo, 200) : null }))
    .filter((h) => h.quando > 0)
    .sort((a, b) => b.quando - a.quando);
  const dia = inicioDoDia(agora);
  const fila = filaRadar(raiz, cfg, agora);
  const nichos: NichoRadar[] = cfg.nichos.map((n) => {
    const pub = hist.find((h) => h.projeto === n.projeto && h.resultado === 'publicado' && h.quando >= dia);
    const erro = hist.find((h) => h.projeto === n.projeto && h.resultado === 'erro' && h.quando >= dia);
    const naFila = fila.some((f) => f.projeto === n.projeto);
    return { projeto: n.projeto, nome: n.nome, gera: n.gera, a_partir: n.a_partir,
      hoje: naFila ? 'na_fila' : pub ? 'publicado' : erro ? 'erro' : 'nada', url: pub?.url ?? null, quando: pub?.quando ?? erro?.quando ?? null };
  });
  return {
    ausentes: [],
    dados: {
      nome: cfg.nome ?? 'Radar Viral', canal: cfg.canal ?? 'lives24', nichos, fila, historico: hist.slice(0, 15),
      hoje: hist.filter((h) => h.resultado === 'publicado' && h.quando >= dia).length,
      erros_24h: hist.filter((h) => h.resultado === 'erro' && agora - h.quando < 86400).length,
      proxima: (Math.floor(agora / 3600) + 1) * 3600,
    },
  };
}
