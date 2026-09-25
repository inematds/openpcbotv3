import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Modelo Claude "topo" do ecossistema INEMA — fonte única em
 * ~/.config/inema/modelos.env (doc: ~/projetos/wifi/MODELOS.md).
 * Ordem: variável de ambiente → arquivo central → reserva.
 */
const ARQUIVO_CENTRAL = path.join(os.homedir(), '.config', 'inema', 'modelos.env');

function lerCentral(chave: string): string | undefined {
  if (process.env[chave]) return process.env[chave];
  try {
    const m = fs.readFileSync(ARQUIVO_CENTRAL, 'utf-8').match(new RegExp(`^${chave}=(.*)$`, 'm'));
    return m?.[1].trim() || undefined;
  } catch {
    return undefined;
  }
}

export const CLAUDE_TOPO = lerCentral('INEMA_CLAUDE_TOPO') ?? 'claude-opus-5-5';

/**
 * Níveis neutros do central (super/topo/executor/menor), um valor por motor:
 * `INEMA_<MOTOR>_<NIVEL>` (modelo) e `INEMA_<MOTOR>_<NIVEL>_EFFORT` (esforço).
 * SUPER vazio herda TOPO. Esforço vazio = não mandar.
 */
export const NIVEIS = ['super', 'topo', 'executor', 'menor'] as const;
export type Nivel = (typeof NIVEIS)[number];
export type Motor = 'claude' | 'codex' | 'ollama' | 'openrouter';

export function ehNivel(s: unknown): s is Nivel {
  return typeof s === 'string' && (NIVEIS as readonly string[]).includes(s);
}

export function nivel(motor: Motor, n: Nivel): { modelo?: string; esforco?: string } {
  const ler = (x: string) => ({
    modelo: lerCentral(`INEMA_${motor.toUpperCase()}_${x}`),
    esforco: lerCentral(`INEMA_${motor.toUpperCase()}_${x}_EFFORT`),
  });
  const r = ler(n.toUpperCase());
  return !r.modelo && n === 'super' ? ler('TOPO') : r;
}

/** `model: topo|executor|super|menor` no agent.yaml vira o modelo central do Claude. */
export function resolverModelo(model?: string): string | undefined {
  if (model === 'topo') return nivel('claude', 'topo').modelo ?? CLAUDE_TOPO;
  return ehNivel(model) ? nivel('claude', model).modelo ?? CLAUDE_TOPO : model;
}
