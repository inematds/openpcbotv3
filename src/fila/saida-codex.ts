// Protocolo JSONL do codex exec --json; nunca entrega logs de ferramentas como resposta.
import type { SaidaCli } from './saida-claude.js';
export type SaidaCodex = SaidaCli;
export function interpretarSaidaCodex(bruto: string): SaidaCodex {
  let sessionId: string | undefined;
  let texto = '';
  let concluido = false;
  let uso: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number } = {};
  for (const linha of bruto.trim().split('\n')) {
    let e: Record<string, any>;
    try { e = JSON.parse(linha); } catch { throw new Error('Codex: saída JSONL inválida ou truncada'); }
    if (e.type === 'thread.started') sessionId = e.thread_id;
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') texto = e.item.text ?? '';
    if (e.type === 'turn.failed' || e.type === 'error') throw new Error(`Codex: ${String(e.error?.message ?? e.message ?? 'execução falhou').slice(0, 400)}`);
    if (e.type === 'turn.completed') { concluido = true; uso = e.usage ?? {}; }
  }
  if (!concluido || !texto.trim()) throw new Error('Codex: execução incompleta ou sem resposta final');
  return { texto: texto.trim(), sessionId, tokensIn: uso.input_tokens, tokensOut: uso.output_tokens, tokensCache: uso.cached_input_tokens };
}
