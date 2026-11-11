// Créditos e logins: limites do Claude (gravados pela statusline), limite do
// Codex (fim do registro mais novo de ~/.codex-2/sessions), custo do dia por
// provedor e avisos manuais (`painel-avisos.json`). Não lê credencial nenhuma.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { DepsPainel } from '../tipos.js';
import { idadeArquivo, inicioDoDia, lerFim, lerJson, paraEpoch } from '../util.js';

export interface Limite { nome: string; pct: number; reset_em: number | null }

export function lerLimitesClaude(j: Record<string, unknown> | null): Limite[] {
  if (!j) return [];
  const out: Limite[] = [];
  const lim = Array.isArray(j.limits) ? j.limits as { kind?: string; percent?: number; resets_at?: string; scope?: { model?: { display_name?: string } } | null }[] : [];
  for (const l of lim) {
    if (typeof l.percent !== 'number') continue;
    const modelo = l.scope?.model?.display_name;
    const nome = l.kind === 'weekly_all' ? 'Semana (todos)' : l.kind === 'weekly_scoped' ? `Semana · ${modelo ?? 'escopo'}` : l.kind === 'five_hour' || l.kind === 'session' ? '5 horas' : String(l.kind ?? 'limite');
    out.push({ nome, pct: Math.round(l.percent), reset_em: paraEpoch(l.resets_at) });
  }
  if (!out.length) {
    const sd = j.seven_day as { utilization?: number; resets_at?: string } | null;
    if (sd && typeof sd.utilization === 'number') out.push({ nome: 'Semana (todos)', pct: Math.round(sd.utilization), reset_em: paraEpoch(sd.resets_at) });
    const fh = j.five_hour as { utilization?: number; resets_at?: string } | null;
    if (fh && typeof fh.utilization === 'number') out.push({ nome: '5 horas', pct: Math.round(fh.utilization), reset_em: paraEpoch(fh.resets_at) });
  }
  return out;
}

/** Último dir em ordem lexical (AAAA → MM → DD), sem varrer a árvore. */
function ultimoDir(p: string): string | null {
  try {
    const d = readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name).sort();
    return d.length ? join(p, d[d.length - 1]) : null;
  } catch { return null; }
}

/** Extrai o último objeto `"rate_limits":{…}` de um texto (chaves balanceadas). */
export function extrairRateLimits(texto: string): Record<string, unknown> | null {
  const i = texto.lastIndexOf('"rate_limits":{');
  if (i < 0) return null;
  let p = i + '"rate_limits":'.length, prof = 0, emStr = false;
  for (let k = p; k < texto.length; k++) {
    const c = texto[k];
    if (emStr) { if (c === '\\') k++; else if (c === '"') emStr = false; continue; }
    if (c === '"') emStr = true;
    else if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) { try { return JSON.parse(texto.slice(p, k + 1)) as Record<string, unknown>; } catch { return null; } } }
  }
  return null;
}

/** Últimos .jsonl de sessão do Codex (ano/mês/dia), do mais novo para o mais velho, olhando até 3 dias. */
function sessoesCodex(raiz: string, max = 12): string[] {
  const dias: string[] = [];
  const subs = (p: string) => { try { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => join(p, e.name)).sort().reverse(); } catch { return []; } };
  for (const a of subs(raiz)) for (const m of subs(a)) for (const d of subs(m)) { dias.push(d); if (dias.length >= 3) break; }
  const out: { f: string; m: number }[] = [];
  for (const d of dias.slice(0, 3)) {
    try { for (const f of readdirSync(d)) if (f.endsWith('.jsonl')) out.push({ f: join(d, f), m: statSync(join(d, f)).mtimeMs }); } catch { /* sem pasta */ }
  }
  return out.sort((a, b) => b.m - a.m).slice(0, max).map((x) => x.f);
}

export function lerCodex(raiz: string, agora: number): { pct: number; reset_em: number | null; janela_h: number | null; plano: string | null; idade_s: number | null } | null {
  // Sessão recém-aberta ainda não tem "rate_limits": segue para a anterior (10/11: o quadro perdia o Codex à toa).
  for (const arq of sessoesCodex(raiz)) {
    const rl = extrairRateLimits(lerFim(arq, 96 * 1024) ?? '');
    const pri = rl?.primary as { used_percent?: number; resets_at?: number; window_minutes?: number } | undefined;
    if (!pri || typeof pri.used_percent !== 'number') continue;
    return { pct: Math.round(pri.used_percent), reset_em: paraEpoch(pri.resets_at), janela_h: pri.window_minutes ? Math.round(pri.window_minutes / 60) : null, plano: typeof rl?.plan_type === 'string' ? rl.plan_type : null, idade_s: idadeArquivo(arq, agora) };
  }
  return null;
}

export interface AvisoManual { titulo: string; ate: string | null; nivel: 'erro' | 'aviso' | 'info'; vencido: boolean; dias: number | null }

export function lerAvisos(j: unknown, agora: number): AvisoManual[] {
  const lista = Array.isArray(j) ? j : (j && typeof j === 'object' && Array.isArray((j as { avisos?: unknown[] }).avisos) ? (j as { avisos: unknown[] }).avisos : []);
  return (lista as Record<string, unknown>[]).filter((a) => a && typeof a.titulo === 'string').map((a) => {
    const ate = typeof a.ate === 'string' ? a.ate : null;
    const t = ate ? paraEpoch(/^\d{4}-\d{2}-\d{2}$/.test(ate) ? ate + 'T23:59:59' : ate) : null;
    const nivel = a.nivel === 'erro' || a.nivel === 'info' ? a.nivel : 'aviso';
    // Dias de calendário: em 09/11 um prazo de 11/11 faltam 2 dias (não 3).
    const dias = t !== null ? Math.round((inicioDoDia(t) - inicioDoDia(agora)) / 86400) : null;
    return { titulo: String(a.titulo), ate, nivel, vencido: t !== null && agora > t, dias };
  });
}

export async function coletarCreditos(d: DepsPainel) {
  const agora = d.agora();
  const ausentes: string[] = [];
  const cc = lerJson<Record<string, unknown>>(d.caminhos.ccLimites);
  if (!cc) ausentes.push('limites do Claude');
  const claude = { limites: lerLimitesClaude(cc), idade_s: idadeArquivo(d.caminhos.ccLimites, agora) };
  const codex = await d.cache.obter('cred:codex', 60_000, () => lerCodex(d.caminhos.codexSessoes, agora));
  if (!codex) ausentes.push('limite do Codex');
  let porProvedor: { provedor: string; chamadas: number; usd: number }[] = [];
  if (d.db) {
    try {
      porProvedor = (d.db.prepare('SELECT provedor, count(*) chamadas, coalesce(sum(custo_usd),0) usd FROM chamadas_llm WHERE created_at >= ? GROUP BY provedor ORDER BY usd DESC').all(inicioDoDia(agora)) as { provedor: string; chamadas: number; usd: number }[])
        .map((r) => ({ ...r, usd: Math.round(r.usd * 1000) / 1000 }));
    } catch { ausentes.push('custo do v3'); }
  } else ausentes.push('custo do v3');
  const avj = lerJson(d.caminhos.avisos);
  if (avj === null) ausentes.push('painel-avisos.json');
  return { dados: { claude, codex, custo_hoje: porProvedor, avisos: lerAvisos(avj, agora) }, ausentes };
}
