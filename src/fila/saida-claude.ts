export interface SaidaCli {
  texto: string;
  sessionId?: string;
  custoUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCache?: number;
}

/** Saída JSON do `claude -p --output-format json`; cai para texto se não for JSON. */
export function interpretarSaidaCli(bruto: string): SaidaCli {
  const t = bruto.trim();
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const texto = typeof j.result === 'string' ? j.result : t;
    const usage = (j.usage ?? {}) as Record<string, number>;
    return {
      texto,
      sessionId: typeof j.session_id === 'string' ? j.session_id : undefined,
      custoUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined,
      tokensIn: usage.input_tokens ?? undefined,
      tokensOut: usage.output_tokens ?? undefined,
    };
  } catch {
    return { texto: t };
  }
}
