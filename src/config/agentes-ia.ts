import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { RAIZ } from './env.js';
import type { Prefs } from './prefs.js';
import type { Perfil } from '../fila/types.js';

export type MotorAgente = 'claude' | 'codex';
export const CHAVE_MOTOR = 'agente_motor';
export interface ConfigAgentesIA { motor: MotorAgente; codex: { modelo: string; esforco: string } }

export function ehMotor(v: unknown): v is MotorAgente { return v === 'claude' || v === 'codex'; }

export function lerAgentesIA(arquivo = resolve(RAIZ, 'config/agentes-ia.yaml')): ConfigAgentesIA {
  const c = yaml.load(readFileSync(arquivo, 'utf8')) as ConfigAgentesIA;
  if (!c || !ehMotor(c.motor) || !/^gpt-[\w.-]+$/.test(c.codex?.modelo ?? '') ||
      !['minimal', 'low', 'medium', 'high', 'xhigh'].includes(c.codex?.esforco)) {
    throw new Error('config/agentes-ia.yaml inválido: motor claude|codex e modelo/esforço Codex explícitos');
  }
  return c;
}

export function perfilAgente(prefs: Prefs | undefined, chat: string, claude: { modelo: string; esforco: string }, config = lerAgentesIA()): Perfil {
  const motor = prefs?.resolver(chat, CHAVE_MOTOR, config.motor) ?? config.motor;
  if (!ehMotor(motor)) throw new Error('Motor de agente inválido; use /motor codex ou /motor claude');
  return { motor, ...(motor === 'codex' ? config.codex : claude) };
}
