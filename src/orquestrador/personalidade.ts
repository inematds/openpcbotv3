// Camada de persona (Hermes SOUL.md): `personalidades/<nome>.md` escolhida por
// chat com `/personality`, mais `agents/<id>/SOUL.md` fixo por agente. A base
// (`IDENTIDADE.md`) nunca sai; isto é SOMADO a ela.
import fs from 'node:fs';
import path from 'node:path';

import { RAIZ } from '../config/env.js';
import type { Prefs } from '../config/prefs.js';

export const PERSONALIDADES_DIR = path.join(RAIZ, 'personalidades');
const CHAVE = 'personalidade';
const MAX_CHARS = 3000;

export function listarPersonalidades(dir = PERSONALIDADES_DIR): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.slice(0, -3)).sort();
  } catch { return []; }
}

export function lerPersonalidade(nome: string, dir = PERSONALIDADES_DIR): string | null {
  if (!/^[a-z0-9_-]+$/i.test(nome)) return null;
  try { return fs.readFileSync(path.join(dir, `${nome}.md`), 'utf8').slice(0, MAX_CHARS); } catch { return null; }
}

export function personalidadeDoChat(prefs: Prefs, chatId: string): string | null {
  return prefs.obter(chatId, CHAVE) ?? null;
}

export function definirPersonalidade(prefs: Prefs, chatId: string, nome: string | null): void {
  if (nome) prefs.gravar(chatId, CHAVE, nome); else prefs.apagar(chatId, CHAVE);
}

/** Bloco pronto para o prompt (ou '' quando o chat não tem personalidade). */
export function blocoPersonalidade(prefs: Prefs, chatId: string, dir = PERSONALIDADES_DIR): string {
  const nome = personalidadeDoChat(prefs, chatId);
  if (!nome) return '';
  const t = lerPersonalidade(nome, dir);
  return t ? `[Personalidade: ${nome}]\n${t.trim()}` : '';
}

/** `agents/<id>/SOUL.md`, se existir. */
export function lerSoul(dirAgente: string): string {
  try { return fs.readFileSync(path.join(dirAgente, 'SOUL.md'), 'utf8').slice(0, MAX_CHARS).trim(); } catch { return ''; }
}
