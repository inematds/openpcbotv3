// Preço por modelo (USD por 1M tokens). Ollama = 0 sempre.
import type { ConfigPrecos } from '../config/yaml.js';

export function calcularCusto(
  precos: ConfigPrecos,
  provedor: string,
  modelo: string,
  tokensIn: number,
  tokensOut: number,
  tokensCache = 0,
): number {
  if (provedor === 'ollama') return 0;
  const p = precos.modelos[modelo] ?? precos.modelos[modelo.replace(/^anthropic\//, '')];
  if (!p) return 0;
  const custo = (tokensIn * p.in + tokensOut * p.out + tokensCache * (p.cache ?? p.in)) / 1_000_000;
  return Math.round(custo * 1e6) / 1e6;
}
