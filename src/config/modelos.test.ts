import { afterEach, describe, expect, it } from 'vitest';

import { argumentosCodex } from '../fila/runner-codex.js';
import { ehNivel, nivel, resolverModelo } from './modelos.js';

const CHAVES = ['INEMA_CLAUDE_SUPER', 'INEMA_CLAUDE_TOPO', 'INEMA_CLAUDE_TOPO_EFFORT',
  'INEMA_CLAUDE_EXECUTOR', 'INEMA_CLAUDE_EXECUTOR_EFFORT', 'INEMA_CODEX_MENOR', 'INEMA_OLLAMA_MENOR', 'INEMA_OLLAMA_TOPO'];
const antes = Object.fromEntries(CHAVES.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of CHAVES) {
    if (antes[k] === undefined) delete process.env[k];
    else process.env[k] = antes[k];
  }
});

describe('níveis centrais', () => {
  it('reconhece só os quatro níveis', () => {
    expect(['super', 'topo', 'executor', 'menor'].every(ehNivel)).toBe(true);
    expect(ehNivel('opus')).toBe(false);
  });

  it('lê modelo e esforço por motor (env vence o arquivo)', () => {
    process.env.INEMA_CLAUDE_EXECUTOR = 'claude-x';
    process.env.INEMA_CLAUDE_EXECUTOR_EFFORT = 'low';
    expect(nivel('claude', 'executor')).toEqual({ modelo: 'claude-x', esforco: 'low' });
    expect(resolverModelo('executor')).toBe('claude-x');
    expect(resolverModelo('claude-opus-5-5')).toBe('claude-opus-5-5');
  });

  it('super vazio herda o topo (modelo e esforço)', () => {
    // INEMA_OLLAMA_SUPER fica vazio no arquivo central de propósito (Ollama não tem super próprio)
    process.env.INEMA_OLLAMA_TOPO = 'q-topo';
    expect(nivel('ollama', 'super').modelo).toBe('q-topo');
  });

  it('codex: nível vira --model do central quando não há mapa', () => {
    process.env.INEMA_CODEX_MENOR = 'gpt-teste';
    const args = argumentosCodex({ prompt: 'p', perfil: { motor: 'codex', modelo: 'menor', esforco: 'low' } } as never, {});
    expect(args.join(' ')).toContain('--model gpt-teste');
  });
});
