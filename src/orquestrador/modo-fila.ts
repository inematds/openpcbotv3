// Modos de chegada por chat (openclaw `docs/concepts/queue.md`, adaptado ao
// que dá pra fazer com `claude -p` em subprocesso):
//   collect   junta mensagens seguidas por 2 s antes de responder (padrão)
//   followup  sem janela; ocupado → entra na fila e responde depois
//   steer     ocupado → substitui o que estava na fila deste chat, prioridade alta
//             (NÃO injeta no agente em execução, ao contrário do openclaw)
//   interrupt cancela tudo deste chat (fila e agente em voo) e responde à nova
//             agora; resposta direta já em voo no Ollama é descartada ao chegar
import type { FilaSqlite } from '../fila/store.js';
import type { Prefs } from '../config/prefs.js';

export type Modo = 'collect' | 'followup' | 'steer' | 'interrupt';
export const MODOS: Modo[] = ['collect', 'followup', 'steer', 'interrupt'];
export const DESCRICAO: Record<Modo, string> = {
  collect: 'junta mensagens seguidas por 2 s (padrão)',
  followup: 'sem janela; se ocupado, entra na fila',
  steer: 'se ocupado, substitui o que estava na fila deste chat',
  interrupt: 'cancela tudo deste chat e responde à nova agora',
};
const CHAVE = 'fila:modo';

export function parsearModo(s: string | undefined): Modo | null {
  const t = (s ?? '').toLowerCase();
  return (MODOS as string[]).includes(t) ? (t as Modo) : null;
}

export function lerModo(prefs: Prefs, chatId: string): Modo {
  return parsearModo(prefs.resolver(chatId, CHAVE, 'collect')) ?? 'collect';
}

export function gravarModo(prefs: Prefs, chatId: string, modo: Modo): void {
  prefs.gravar(chatId, CHAVE, modo);
}

/**
 * Cancela jobs deste chat pelo `flow_ref` (`canal:chatId`, que o orquestrador
 * põe em tudo que enfileira). `chat_id` numérico não serve: o CLI não tem.
 */
export function cancelarDoChat(fila: FilaSqlite, flowRef: string, o: { emVoo: boolean; apenasTarefa?: string }): number {
  let n = 0;
  const status = o.emVoo ? (['queued', 'running'] as const) : (['queued'] as const);
  for (const s of status) {
    for (const j of fila.listar({ status: s, limite: 500 })) {
      if (j.flow_ref !== flowRef) continue;
      if (o.apenasTarefa && j.tarefa !== o.apenasTarefa) continue;
      if (fila.cancelar(j.id)) n += 1;
    }
  }
  return n;
}

/**
 * Contador de geração por chat: `interrupt` incrementa; quem começou a
 * responder na geração anterior descarta o resultado ao terminar. É o jeito
 * de "abortar" uma chamada ao Ollama que não aceita AbortSignal.
 */
export class Geracoes {
  private readonly g = new Map<string, number>();
  atual(chave: string): number { return this.g.get(chave) ?? 0; }
  avancar(chave: string): number { const n = this.atual(chave) + 1; this.g.set(chave, n); return n; }
  vigente(chave: string, g: number): boolean { return this.atual(chave) === g; }
}
