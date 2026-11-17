// Trava de cota compartilhada (17/11/2026). Mesma tabela `pools` do EngineBridge e do
// `ia_motor.py` dos crons (~/.local/state/enginebridge/state.sqlite): quando uma assinatura
// recusa por cota, TODOS os sistemas da máquina param de abrir o programa até o horário de
// volta. Só `blocked`/`until`; nunca a concessão exclusiva (lease), que serializaria os jobs.
// Motivo: lote-135 fez 12.619 chamadas recusadas (429) em 15–16/11 sem trava nenhuma.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export const COTA_PADRAO_S = 3600;   // recusa de cota sem horário legível
export const LIMITE_CURTO_S = 300;   // 429 momentâneo (sem usage_limit_reached)

export class CotaEsgotada extends Error {
  constructor(readonly motor: string, readonly ate?: number, readonly manual = false) {
    super(`${motor} sem cota (${manual ? 'bloqueio manual' : ate ? `até ${formatar(ate)}` : 'sem horário de volta'})`
      + ' — use /motor para trocar de assinatura ou aguarde');
    this.name = 'CotaEsgotada';
  }
}

function formatar(ate: number): string {
  const d = new Date(ate * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function cotaDb(env: NodeJS.ProcessEnv = process.env): string {
  return env.INEMA_COTA_DB || resolve(homedir(), '.local/state/enginebridge/state.sqlite');
}

/** Identidade da cota: motor + perfil de login. Mesmas chaves do `ia_motor.py`. */
export function poolDe(motor: string, env: NodeJS.ProcessEnv): string {
  if (motor === 'claude') return 'claude:' + (env.CLAUDE_CONFIG_DIR || resolve(homedir(), '.claude'));
  const home = env.CODEX_HOME || resolve(homedir(), '.codex');
  try { return 'codex:' + realpathSync(home); } catch { return 'codex:' + resolve(home); }
}

function abrir(env: NodeJS.ProcessEnv): Database.Database {
  const p = cotaDb(env);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  const db = new Database(p, { timeout: 10_000 });
  db.exec('CREATE TABLE IF NOT EXISTS pools (pool TEXT PRIMARY KEY, blocked INTEGER DEFAULT 0, until REAL DEFAULT 0, owner TEXT, lease REAL DEFAULT 0)');
  return db;
}

/** Antes de abrir o programa. Falha do banco nunca impede a chamada (a trava é proteção, não portão). */
export function cotaConferir(motor: string, env: NodeJS.ProcessEnv, agora = Date.now() / 1000): void {
  let linha: { blocked: number; until: number } | undefined;
  if (!existsSync(cotaDb(env))) return;      // ninguém gravou trava ainda: livre, sem criar nada
  try {
    const db = abrir(env);
    try { linha = db.prepare('SELECT blocked, until FROM pools WHERE pool=?').get(poolDe(motor, env)) as typeof linha; }
    finally { db.close(); }
  } catch { return; }
  if (linha?.blocked) throw new CotaEsgotada(motor, undefined, true);
  if (linha && linha.until > agora) throw new CotaEsgotada(motor, linha.until);
}

export function cotaRegistrar(motor: string, env: NodeJS.ProcessEnv, ate: number): void {
  try {
    const db = abrir(env);
    try {
      db.prepare('INSERT INTO pools(pool, until) VALUES (?, ?) ON CONFLICT(pool) DO UPDATE SET until=MAX(pools.until, excluded.until)')
        .run(poolDe(motor, env), ate);
    } finally { db.close(); }
  } catch { /* sem banco: segue sem trava */ }
}

const MESES: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** Diferença (ms) entre o relógio de parede do fuso e o UTC, no instante dado. */
function deslocamento(tz: string, instante: number): number {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instante)).map((p) => [p.type, p.value]));
  const comoUtc = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/** 'resets 9pm (America/Sao_Paulo)' ou 'resets Nov 16, 9pm (…)' → epoch (s); undefined se ilegível ou absurdo. */
export function horarioVolta(texto: string, agora = Date.now() / 1000): number | undefined {
  const m = /resets\s+(?:([A-Z][a-z]{2})\s+(\d{1,2}),\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([A-Za-z_]+\/[A-Za-z_/]+)\)/.exec(texto ?? '');
  if (!m) return undefined;
  const tz = m[6];
  let desl: number;
  try { desl = deslocamento(tz, agora * 1000); } catch { return undefined; }
  const hoje = new Date(agora * 1000 + desl);   // campos UTC = relógio de parede do fuso
  const h = (+m[3] % 12) + (m[5] === 'pm' ? 12 : 0);
  const min = +(m[4] ?? 0);
  let ano = hoje.getUTCFullYear(), mes = hoje.getUTCMonth() + 1, dia = hoje.getUTCDate();
  if (m[1]) {
    if (!MESES[m[1]]) return undefined;
    mes = MESES[m[1]]; dia = +m[2];
  }
  let alvo = (Date.UTC(ano, mes - 1, dia, h, min) - desl) / 1000;
  if (!m[1] && alvo <= agora) alvo += 86400;
  return alvo > agora && alvo <= agora + 8 * 86400 ? alvo : undefined;
}

/**
 * Só a recusa ESTRUTURADA do Claude Code (JSON is_error + campos de API) conta; texto de uma
 * resposta normal nunca. Devolve o epoch (s) de volta, ou undefined. Exemplo real em cota.test.ts.
 */
export function recusaCotaClaude(bruto: string | undefined, agora = Date.now() / 1000): number | undefined {
  let j: Record<string, unknown>;
  try { j = JSON.parse((bruto ?? '').trim()) as Record<string, unknown>; } catch { return undefined; }
  if (!j || typeof j !== 'object' || j.is_error !== true) return undefined;
  if (j.api_error === 'usage_limit_reached') return horarioVolta(String(j.result ?? ''), agora) ?? agora + COTA_PADRAO_S;
  if (j.api_error_status === 429 || j.api_error_type === 'rate_limit_error') return agora + LIMITE_CURTO_S;
  return undefined;
}
