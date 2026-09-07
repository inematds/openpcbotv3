import { ollamaChat } from '../ollama/cliente.js';
import type { PedidoLLM, Provedor, RespostaLLM } from './tipos.js';

export class ProvedorOllama implements Provedor {
  nome = 'ollama' as const;

  async chamar(p: PedidoLLM): Promise<RespostaLLM> {
    const r = await ollamaChat(p.modelo, p.mensagens, {
      temperature: p.temperatura,
      timeout: p.timeoutMs,
      abortSignal: p.sinal,
      keepAlive: p.keepAlive,
      format: p.json ? 'json' : undefined,
      numPredict: p.maxTokens,
      think: false,
    });
    return { texto: r.content, tokensIn: r.promptTokens, tokensOut: r.completionTokens };
  }
}
