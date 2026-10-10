// Triagem de mensagem que chega com agente trabalhando no chat (item 3).
// Sem interromper o agente (o `claude -p` não aceita mensagem no meio):
//   cancelar      → cancela os jobs do chat
//   mesmo assunto → complemento: job do MESMO agente, mesma sessão (--resume),
//                   roda logo depois do atual (lane agente = 1 por vez)
//   outro assunto → espera na fila (`apos-agente`) e só então é roteado
// Nenhum dos três projetos pesquisados (Hermes, OpenClaw, Agent Zero) separa por assunto.
import type { GatewayLLM } from '../custo/gateway.js';
import type { Job } from '../fila/types.js';
import { pedidoDe } from './situacao.js';

export const CANCELAR_RE = /^\s*(para|pare|parar|cancela|cancele|cancelar|esquece|esque[çc]a|aborta|aborte|stop)(\s+(tudo|isso|isto|a tarefa|o job|agora|por favor))?\s*[.!]*\s*$/i;

export function ehCancelar(texto: string): boolean {
  return CANCELAR_RE.test(texto);
}

/** Job de referência: o que está rodando; senão o mais antigo na fila. */
export function jobAlvo(abertos: Job[]): Job | undefined {
  return abertos.find((j) => j.status === 'running') ?? abertos[0];
}

/** Agente dono da conversa do job (complemento vai para ele, na mesma sessão). */
export function agenteDo(j: Job): string {
  if (j.tarefa.startsWith('agente:')) return j.tarefa.slice('agente:'.length);
  try { return (JSON.parse(j.input) as { entrada?: { agente?: string } }).entrada?.agente ?? 'lead'; } catch { return 'lead'; }
}

/**
 * Complemento precisa esperar quando o job `agente:<x>` do pedido ainda não
 * existe (especialistas consultando / `agente-lead` aguardando): despachar já
 * faria o complemento rodar ANTES do pedido original.
 */
export function complementoEspera(abertos: Job[]): boolean {
  return abertos.some((j) => !j.tarefa.startsWith('agente:'));
}

export function promptTriagem(pedido: string, nova: string): string {
  return `Um agente está trabalhando neste pedido do usuário:
«${pedido.slice(0, 600)}»

Chegou uma nova mensagem do mesmo usuário:
«${nova.slice(0, 600)}»

A nova mensagem é do MESMO assunto (complemento, correção, detalhe, continuação, pergunta sobre esse trabalho) ou de um assunto DIFERENTE (outro pedido, sem relação)?
Responda SOMENTE JSON: {"mesmo":true|false,"motivo":"<até 10 palavras>"}`;
}

/** Sem JSON válido → mesmo assunto (o complemento também espera o atual; errar aqui é barato). */
export function parsearTriagem(bruto: string): { mesmo: boolean; motivo: string } {
  const m = bruto.match(/\{[\s\S]*\}/);
  if (!m) return { mesmo: true, motivo: 'fallback: sem JSON' };
  try {
    const j = JSON.parse(m[0]) as { mesmo?: unknown; motivo?: unknown };
    return { mesmo: j.mesmo !== false, motivo: String(j.motivo ?? '').slice(0, 80) };
  } catch { return { mesmo: true, motivo: 'fallback: JSON inválido' }; }
}

export async function mesmoAssunto(
  gateway: GatewayLLM, modelo: string, alvo: Job, nova: string, ctx: { chatId: string; traceId: string; keepAlive?: string | number },
): Promise<{ mesmo: boolean; motivo: string }> {
  try {
    const r = await gateway.chamar({
      tier: 'local', modelo, json: true, temperatura: 0.1, maxTokens: 80, timeoutMs: 30_000, keepAlive: ctx.keepAlive,
      agente: 'triagem', chatId: ctx.chatId, traceId: ctx.traceId,
      mensagens: [{ role: 'user', content: promptTriagem(pedidoDe(alvo), nova) }],
    });
    return parsearTriagem(r.texto);
  } catch {
    return { mesmo: true, motivo: 'fallback: triagem indisponível' };
  }
}
