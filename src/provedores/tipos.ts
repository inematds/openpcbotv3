// Contrato mínimo de um provedor de LLM. Nenhum módulo chama provedor direto:
// tudo passa por `custo/gateway.ts` (regra de ouro 2).
export interface MensagemLLM {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PedidoLLM {
  modelo: string;
  mensagens: MensagemLLM[];
  temperatura?: number;
  maxTokens?: number;
  timeoutMs?: number;
  sinal?: AbortSignal;
  /** JSON estrito (roteador). */
  json?: boolean;
  keepAlive?: string | number;
}

export interface RespostaLLM {
  texto: string;
  tokensIn: number;
  tokensOut: number;
  tokensCache?: number;
  /** Custo informado pelo provedor (OpenRouter devolve); senão calculamos. */
  custoUsdInformado?: number;
}

export interface Provedor {
  nome: 'ollama' | 'openrouter' | 'anthropic';
  chamar(p: PedidoLLM): Promise<RespostaLLM>;
}
