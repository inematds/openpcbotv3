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

/** `model: topo` no agent.yaml vira o modelo central. */
export function resolverModelo(model?: string): string | undefined {
  return model === 'topo' ? CLAUDE_TOPO : model;
}
