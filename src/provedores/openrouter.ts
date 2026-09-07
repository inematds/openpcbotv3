// OpenRouter (API compatível com OpenAI). `usage.cost` vem na resposta quando
// pedimos `usage: {include: true}` — é o custo real cobrado.
import type { PedidoLLM, Provedor, RespostaLLM } from './tipos.js';

export class ProvedorOpenRouter implements Provedor {
  nome = 'openrouter' as const;

  constructor(private readonly apiKey: string, private readonly fetchFn: typeof fetch = fetch) {}

  async chamar(p: PedidoLLM): Promise<RespostaLLM> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), p.timeoutMs ?? 120_000);
    const onAbort = (): void => ctrl.abort();
    p.sinal?.addEventListener('abort', onAbort);
    try {
      const r = await this.fetchFn('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/inematds/openpcbotv3',
          'X-Title': 'openpcbotv3',
        },
        body: JSON.stringify({
          model: p.modelo,
          messages: p.mensagens,
          temperature: p.temperatura,
          max_tokens: p.maxTokens,
          usage: { include: true },
          ...(p.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
      const d = (await r.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      return {
        texto: d.choices?.[0]?.message?.content ?? '',
        tokensIn: d.usage?.prompt_tokens ?? 0,
        tokensOut: d.usage?.completion_tokens ?? 0,
        tokensCache: d.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        custoUsdInformado: typeof d.usage?.cost === 'number' ? d.usage.cost : undefined,
      };
    } finally {
      clearTimeout(t);
      p.sinal?.removeEventListener('abort', onAbort);
    }
  }
}
