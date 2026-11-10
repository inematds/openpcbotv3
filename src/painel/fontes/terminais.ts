// Terminais: sessões vivas do Claude Code e as interrompidas, pelo comando
// `terminais --json` (do hub wifi). Mais as pendências do topo do hub.
import type { DepsPainel } from '../tipos.js';
import { corta, lerTexto, paraEpoch } from '../util.js';
import { detalharSessoes, type InfoSessao } from './sessoes.js';

export interface Terminal { session_id: string; pid: number | null; cwd: string; projeto: string; inicio: number | null; tipo: string; tty: string | null }

export function lerTerminais(saida: string): Terminal[] | null {
  let j: unknown;
  try { j = JSON.parse(saida); } catch { return null; }
  const lista = Array.isArray(j) ? j : (j && typeof j === 'object' ? ((j as { sessoes?: unknown[] }).sessoes ?? (j as { terminais?: unknown[] }).terminais ?? (j as { interrompidos?: unknown[] }).interrompidos) : null);
  if (!Array.isArray(lista)) return null;
  return (lista as Record<string, unknown>[]).filter((t) => t && typeof t === 'object').map((t) => {
    const cwd = String(t.cwd ?? '');
    return {
      session_id: String(t.session_id ?? t.sessao ?? t.id ?? ''),
      pid: typeof t.pid === 'number' ? t.pid : null,
      cwd, projeto: String(t.projeto ?? (cwd.split('/').filter(Boolean).pop() || '?')),
      inicio: paraEpoch(t.inicio ?? t.desde ?? t.started_at), tipo: String(t.tipo ?? 'terminal'), tty: typeof t.tty === 'string' ? t.tty : null,
    };
  });
}

export async function coletarTerminais(d: DepsPainel) {
  const ausentes: string[] = [];
  const vivos = await d.cache.obter('term:vivos', 20_000, async () => {
    const r = await d.exec(d.caminhos.scriptTerminais, ['--json'], 5000);
    return r.stdout.trim() ? lerTerminais(r.stdout) : null;
  });
  const interrompidos = await d.cache.obter('term:interr', 60_000, async () => {
    const r = await d.exec(d.caminhos.scriptTerminais, ['--interrompidos', '--json'], 5000);
    return r.stdout.trim() ? lerTerminais(r.stdout) : null;
  });
  const info: Record<string, InfoSessao> = await d.cache.obter('term:info', 20_000, async () => ({
    ...(await detalharSessoes(d, vivos ?? [], true)),
    ...(await detalharSessoes(d, interrompidos ?? [], false)),
  }));
  const junta = (t: Terminal) => ({ ...t, ...(info[t.session_id] ?? {}) });
  if (vivos === null) ausentes.push('terminais');
  if (interrompidos === null) ausentes.push('terminais interrompidos');
  return { dados: { vivos: (vivos ?? []).map(junta), interrompidos: (interrompidos ?? []).map(junta), miniatura: null as string | null }, ausentes };
}

/** Itens do topo de pendencias.md: cada `- **título**` ou `### título` antes de "## Resolvidas". */
export function lerPendencias(texto: string | null, max = 8): { titulo: string }[] | null {
  if (texto === null) return null;
  const out: { titulo: string }[] = [];
  for (const l of texto.split('\n')) {
    if (/^##\s+Resolvidas/i.test(l)) break;
    let m = /^- \*\*(.+?)\*\*/.exec(l);
    if (!m) m = /^###\s+(.+)/.exec(l);
    if (!m) continue;
    // "07/11/2026 — assunto" vira "07/11 · assunto" (o ano come espaço na TV).
    const t = m[1].replace(/\*\*/g, '').trim().replace(/^(\d{2}\/\d{2})\/\d{4}\s*[—·-]\s*/, '$1 · ');
    out.push({ titulo: corta(t, 140) });
    if (out.length >= max) break;
  }
  return out;
}

export function coletarPendencias(d: DepsPainel) {
  return lerPendencias(lerTexto(d.caminhos.pendencias));
}
