// Configuração por ambiente. Regra global: API keys vivem no `.env` do v2 e são
// carregadas em RUNTIME (nunca copiadas). O `.env` do v3 vem POR CIMA e só
// carrega o que é específico deste bot: token próprio, chat, porta, banco.
//
// Ordem de precedência (mais forte primeiro):
//   1. variáveis já presentes no processo (systemd EnvironmentFile, shell)
//   2. openpcbotv3/.env
//   3. openpcbotv2/.env  (keys compartilhadas)
import { existsSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { resolve } from 'node:path';

export const RAIZ = resolve(new URL('../..', import.meta.url).pathname);
export const RAIZ_V2 = process.env.OPENPCBOT_V2_DIR ?? resolve(homedir(), 'projetos/openpcbotv2');

/** Prefixo (bot id) do token do v2. O v3 RECUSA subir com este token: dois
 * `getUpdates` no mesmo token = 409 e bot surdo (lição do v2). */
export const BOT_ID_V2 = '8644490375';

function lerDotenv(caminho: string): Record<string, string> {
  if (!existsSync(caminho)) return {};
  const out: Record<string, string> = {};
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const l = linha.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i <= 0) continue;
    const k = l.slice(0, i).trim();
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

/** Aplica os dois `.env` no `process.env` sem sobrescrever o que já existe. */
export function carregarEnv(): void {
  const camadas = [resolve(RAIZ, '.env'), resolve(RAIZ_V2, '.env')];
  for (const arq of camadas) {
    for (const [k, v] of Object.entries(lerDotenv(arq))) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

/** Lista separada por vírgula; `undefined` quando a variável não existe. */
function lista(v: string | undefined): string[] | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function num(nome: string, def: number): number {
  const v = process.env[nome];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export interface Config {
  versao: string;
  instancia: string;
  telegramToken: string | undefined;
  chatPermitido: string | undefined;
  /** Chats em que o bot RESPONDE. Default: só o `ALLOWED_CHAT_ID`. */
  chatsResponder: string[];
  /** Chats que o bot só OBSERVA (grava no cérebro, nunca responde). `['todos']` = qualquer chat. */
  chatsObservar: string[];
  porta: number;
  dbPath: string;
  vaultPath: string;
  ollamaUrl: string;
  openrouterKey: string | undefined;
  anthropicKey: string | undefined;
  /** Piso de RAM disponível (GB) para carregar modelo NÃO residente no Ollama. */
  pisoRamGb: number;
  orcamentoMensalUsd: number;
  whatsappAtivo: boolean;
  slackAtivo: boolean;
  claudeBin: string;
  codexBin: string;
  logLevel: string;
}

export function lerConfig(): Config {
  return {
    versao: '3.1.1',
    instancia: `${hostname()}:${process.pid}`,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN_V3 || undefined,
    chatPermitido: process.env.ALLOWED_CHAT_ID || undefined,
    chatsResponder: lista(process.env.TELEGRAM_CHATS_RESPONDER) ?? (process.env.ALLOWED_CHAT_ID ? [process.env.ALLOWED_CHAT_ID] : []),
    chatsObservar: lista(process.env.TELEGRAM_CHATS_OBSERVAR) ?? [],
    porta: num('PORT_V3', 3142),
    dbPath: process.env.DB_PATH_V3 ?? resolve(RAIZ, 'store/openpcbotv3.db'),
    vaultPath: process.env.VAULT_PATH ?? resolve(homedir(), 'vault'),
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    openrouterKey: process.env.OPENROUTER_API_KEY || undefined,
    anthropicKey: process.env.ANTHROPIC_API_KEY || undefined,
    pisoRamGb: num('PISO_RAM_GB', 40),
    orcamentoMensalUsd: num('ORCAMENTO_MENSAL_USD', 50),
    whatsappAtivo: process.env.WHATSAPP_ENABLED === '1',
    slackAtivo: process.env.SLACK_ENABLED === '1',
    claudeBin: process.env.CLAUDE_BIN || 'claude',
    codexBin: process.env.CODEX_BIN || 'codex',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

/** Guarda: o token do v3 nunca pode ser o do v2. */
export function validarTokenTelegram(token: string | undefined): { ok: boolean; motivo?: string } {
  if (!token) return { ok: false, motivo: 'TELEGRAM_BOT_TOKEN_V3 ausente — canal Telegram desligado' };
  const id = token.split(':')[0];
  if (id === BOT_ID_V2) return { ok: false, motivo: 'TELEGRAM_BOT_TOKEN_V3 é o token do v2 — recusado (409/bot surdo)' };
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false, motivo: 'TELEGRAM_BOT_TOKEN_V3 com formato inválido' };
  return { ok: true };
}
