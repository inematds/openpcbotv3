// Leitura dos YAML de `config/` com defaults embutidos — o serviço sobe mesmo
// sem os arquivos (e o `doctor` avisa).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

import { RAIZ } from './env.js';

export interface PapelOllama {
  modelo: string;
  /** '10m', ou -1 (número) = residente para sempre. */
  keep_alive?: string | number;
  residente?: boolean;
  ativo?: boolean;
}

export interface ConfigOllama {
  papeis: Record<'roteador' | 'geral' | 'embed' | 'pesado', PapelOllama>;
  /** GB de RAM disponível mínimos para carregar um modelo que não está residente. */
  piso_ram_gb: number;
  /** Durante a coexistência com o v2, o v3 NUNCA descarrega modelo que não carregou. */
  descarregar_alheios: boolean;
  probe_segundos: number;
  latencia_alerta_ms: number;
}

export interface PrecoModelo {
  in: number;   // USD por 1M tokens de entrada
  out: number;  // USD por 1M tokens de saída
  cache?: number;
}

export interface ConfigPrecos {
  modelos: Record<string, PrecoModelo>;
  tiers: {
    local: { provedor: 'ollama'; modelo: string };
    barato: { provedor: 'openrouter' | 'anthropic'; modelo: string };
    premium: { provedor: 'openrouter' | 'anthropic'; modelo: string };
  };
}

export interface ConfigOrcamento {
  mensal_usd: number;
  aviso_pct: number;
  trava_pct: number;
}

function ler<T>(nome: string, def: T): T {
  const p = resolve(RAIZ, 'config', nome);
  if (!existsSync(p)) return def;
  const doc = yaml.load(readFileSync(p, 'utf8'));
  return { ...def, ...(doc as object) } as T;
}

export const OLLAMA_DEFAULT: ConfigOllama = {
  papeis: {
    roteador: { modelo: 'llama3.2', keep_alive: '10m' },
    // MESMA tag do v2 (.env OLLAMA_MODEL) — um só modelo residente serve os dois bots.
    geral: { modelo: 'qwen3.8:27b', keep_alive: -1, residente: true },
    embed: { modelo: 'bge-m3', keep_alive: '10m' },
    pesado: { modelo: 'llama3.1:70b', ativo: false },
  },
  piso_ram_gb: 40,
  descarregar_alheios: false,
  probe_segundos: 60,
  latencia_alerta_ms: 5000,
};

export const PRECOS_DEFAULT: ConfigPrecos = {
  modelos: {
    'anthropic/claude-haiku-4.5': { in: 1, out: 5, cache: 0.1 },
    'anthropic/claude-sonnet-5': { in: 3, out: 15, cache: 0.3 },
    'anthropic/claude-opus-5': { in: 15, out: 75, cache: 1.5 },
    'claude-haiku-4-5-20251001': { in: 1, out: 5, cache: 0.1 },
    'claude-sonnet-5': { in: 3, out: 15, cache: 0.3 },
    'claude-opus-5': { in: 15, out: 75, cache: 1.5 },
  },
  tiers: {
    local: { provedor: 'ollama', modelo: 'qwen3.8:27b' },
    barato: { provedor: 'openrouter', modelo: 'anthropic/claude-haiku-4.5' },
    premium: { provedor: 'openrouter', modelo: 'anthropic/claude-sonnet-5' },
  },
};

export const ORCAMENTO_DEFAULT: ConfigOrcamento = { mensal_usd: 50, aviso_pct: 70, trava_pct: 100 };

export const lerConfigOllama = (): ConfigOllama => ler('ollama.yaml', OLLAMA_DEFAULT);
export const lerConfigPrecos = (): ConfigPrecos => ler('precos.yaml', PRECOS_DEFAULT);
export const lerConfigOrcamento = (): ConfigOrcamento => ler('orcamento.yaml', ORCAMENTO_DEFAULT);
