// Cliente HTTP do Ollama (portado do v2, com `format`, `num_predict` e embed).
// Só HTTP: nunca `ollama serve` (regra de ouro 3).
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface OllamaChatResponse {
  message: { role: string; content: string; thinking?: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
  error?: string;
}

export interface OllamaResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

const DEFAULT_URL = 'http://localhost:11434';

export function getOllamaUrl(): string {
  return process.env.OLLAMA_URL || DEFAULT_URL;
}

export async function ollamaChat(
  model: string,
  messages: OllamaMessage[],
  options?: {
    temperature?: number;
    timeout?: number;
    keepAlive?: string | number;
    think?: boolean;
    format?: 'json';
    numPredict?: number;
    abortSignal?: AbortSignal;
  },
): Promise<OllamaResult> {
  const url = `${getOllamaUrl()}/api/chat`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 300_000);
  const onExternalAbort = (): void => controller.abort();
  options?.abortSignal?.addEventListener('abort', onExternalAbort);

  const opts: Record<string, unknown> = {};
  if (options?.temperature != null) opts.temperature = options.temperature;
  if (options?.numPredict != null) opts.num_predict = options.numPredict;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(options?.think != null ? { think: options.think } : {}),
        ...(options?.keepAlive !== undefined && options.keepAlive !== '' ? { keep_alive: options.keepAlive } : {}),
        ...(options?.format ? { format: options.format } : {}),
        ...(Object.keys(opts).length ? { options: opts } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    if (data.error) throw new Error(`Ollama: ${data.error}`);
    return {
      content: data.message?.content ?? '',
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
    };
  } finally {
    clearTimeout(timeoutId);
    options?.abortSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function ollamaEmbed(
  model: string,
  input: string[],
  timeout = 120_000,
): Promise<{ embeddings: number[][]; promptTokens: number }> {
  const res = await fetch(`${getOllamaUrl()}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input, keep_alive: '10m' }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Ollama embed ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const d = (await res.json()) as { embeddings?: number[][]; prompt_eval_count?: number };
  return { embeddings: d.embeddings ?? [], promptTokens: d.prompt_eval_count ?? 0 };
}

export async function ollamaHealthCheck(model?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `Ollama returned ${res.status}` };
    if (model) {
      const data = (await res.json()) as { models: Array<{ name: string }> };
      const names = data.models.map((m) => m.name);
      const found = names.some((n) => n === model || n.startsWith(model + ':'));
      if (!found) return { ok: false, error: `Model "${model}" not found. Available: ${names.join(', ')}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: `Ollama unreachable at ${getOllamaUrl()}` };
  }
}
