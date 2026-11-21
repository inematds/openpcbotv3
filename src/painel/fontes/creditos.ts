// Créditos e logins: limites do Claude (gravados pela statusline), limite do
// Codex (fim do registro mais novo de ~/.codex-2/sessions), custo do dia por
// provedor e avisos manuais (`painel-avisos.json`). `contas` traz cada login do
// Claude e cada CODEX_HOME com os dias até zerar. Do auth.json do Codex só lê o
// e-mail do payload do id_token; nenhum token é usado nem sai daqui.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { DepsPainel } from '../tipos.js';
import { idadeArquivo, inicioDoDia, lerFim, lerJson, paraEpoch } from '../util.js';

export interface Limite { nome: string; pct: number; reset_em: number | null; dias?: number | null }

/** Dias de calendário até o reset (0 = hoje), como nos avisos com prazo. */
export function diasAte(resetEm: number | null, agora: number): number | null {
  return resetEm === null ? null : Math.max(0, Math.round((inicioDoDia(resetEm) - inicioDoDia(agora)) / 86400));
}

/** "nei.maldaner2014@…" → "nei"; "inematds@…" → "inematds". */
export function rotuloConta(email: string | null | undefined, reserva: string): string {
  if (!email) return reserva;
  return email.split('@')[0].split('.')[0] || reserva;
}

export interface ContaCota { servico: 'Claude' | 'Codex'; conta: string; limites: Limite[]; idade_s: number | null; plano?: string | null }

/** Um cache de cota por pasta de login: cc_limits_<uid>.json (~/.claude) e cc_limits_<uid>_<pasta>.json. */
export function descobrirContasClaude(pasta: string, uid: number, home: string): { arquivo: string; cfg: string; reserva: string }[] {
  let nomes: string[] = [];
  try { nomes = readdirSync(pasta); } catch { return []; }
  const re = new RegExp(`^cc_limits_${uid}(?:_([A-Za-z0-9._-]+))?\\.json$`);
  const out: { arquivo: string; cfg: string; reserva: string }[] = [];
  for (const n of nomes.sort()) {
    const m = re.exec(n);
    if (!m) continue;
    const dir = m[1];
    if (dir && (dir.includes('..') || dir.includes('/'))) continue;
    out.push({ arquivo: join(pasta, n), cfg: dir ? join(home, dir, '.claude.json') : join(home, '.claude.json'), reserva: dir ? dir.replace(/^\.claude-?/, '') || dir : 'padrão' });
  }
  return out;
}

/** E-mail do id_token do Codex (só o payload público; nenhum token sai daqui). */
export function emailCodex(authJson: unknown): string | null {
  try {
    const t = (authJson as { tokens?: { id_token?: string } })?.tokens?.id_token;
    if (typeof t !== 'string') return null;
    const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')) as { email?: unknown };
    return typeof p.email === 'string' ? p.email : null;
  } catch { return null; }
}

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
  // Todas as contas (20/11): cada login do Claude e cada CODEX_HOME, com os dias até zerar.
  const contas: ContaCota[] = [];
  const uid = process.getuid?.() ?? 1000;
  for (const c of descobrirContasClaude(d.caminhos.ccLimitesPasta, uid, d.caminhos.home)) {
    const j = lerJson<Record<string, unknown>>(c.arquivo);
    const lim = lerLimitesClaude(j);
    if (!lim.length) continue;
    const email = (lerJson<{ oauthAccount?: { emailAddress?: string } }>(c.cfg))?.oauthAccount?.emailAddress;
    contas.push({ servico: 'Claude', conta: rotuloConta(email, c.reserva), limites: lim.map((l) => ({ ...l, dias: l.nome === '5 horas' ? null : diasAte(l.reset_em, agora) })), idade_s: idadeArquivo(c.arquivo, agora) });
  }
  for (const ch of d.caminhos.codexHomes) {
    const x = await d.cache.obter(`cred:codex:${ch}`, 60_000, () => lerCodex(join(ch, 'sessions'), agora));
    if (!x) continue;
    const nome = rotuloConta(emailCodex(lerJson(join(ch, 'auth.json'))), ch.split('/').pop() || ch);
    // Leitura velha cuja janela já passou: a cota zerou e não houve uso depois (Codex parado há dias).
    const zerou = x.reset_em !== null && x.reset_em < agora;
    contas.push({ servico: 'Codex', conta: nome, limites: [{ nome: (x.janela_h ? `Janela de ${x.janela_h} h` : 'Janela') + (zerou ? ' (zerou)' : ''), pct: zerou ? 0 : x.pct, reset_em: zerou ? null : x.reset_em, dias: zerou ? null : diasAte(x.reset_em, agora) }], idade_s: x.idade_s, plano: x.plano });
  }
  return { dados: { claude, codex, contas, custo_hoje: porProvedor, avisos: lerAvisos(avj, agora) }, ausentes };
}
