// Anthropic Messages API direto (sem SDK, para manter o processo leve).
import type { MensagemLLM, PedidoLLM, Provedor, RespostaLLM } from './tipos.js';

export class ProvedorAnthropic implements Provedor {
  nome = 'anthropic' as const;

  constructor(private readonly apiKey: string, private readonly fetchFn: typeof fetch = fetch) {}

  async chamar(p: PedidoLLM): Promise<RespostaLLM> {
    const system = p.mensagens.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages = p.mensagens.filter((m): m is MensagemLLM & { role: 'user' | 'assistant' } => m.role !== 'system');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), p.timeoutMs ?? 120_000);
    const onAbort = (): void => ctrl.abort();
    p.sinal?.addEventListener('abort', onAbort);
    try {
      const r = await this.fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: p.modelo,
          max_tokens: p.maxTokens ?? 2048,
          temperature: p.temperatura,
          ...(system ? { system } : {}),
          messages,
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
      const d = (await r.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      };
      return {
        texto: (d.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''),
        tokensIn: d.usage?.input_tokens ?? 0,
        tokensOut: d.usage?.output_tokens ?? 0,
        tokensCache: d.usage?.cache_read_input_tokens ?? 0,
      };
    } finally {
      clearTimeout(t);
      p.sinal?.removeEventListener('abort', onAbort);
    }
  }
}
