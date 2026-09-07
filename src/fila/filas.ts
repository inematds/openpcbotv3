// Lanes da fila (plano §4.1) — UMA fonte de verdade para concorrência e listagem.
//
// Por que estes números durante a coexistência com o v2 (mesma máquina, mesmo
// Ollama): cada `claude -p` custa ~500 MB de RSS e o Ollama serializa de
// qualquer jeito (`-np 1`). Subir a concorrência aqui sem subir a RAM da
// máquina é o caminho mais curto para o OOM de agosto/2026.
import type { Fila } from './types.js';

export const CONCORRENCIAS: Record<Fila, number> = {
  chat: 2,     // resposta direta (Ollama residente), leve
  agente: 1,   // CLI por subprocesso (claude/codex) — 1 por vez, RAM
  ollama: 1,   // carga/descarga/embeddings pesados no Ollama
  cron: 1,     // tarefas agendadas
  io: 4,       // rede/arquivo (notificações, downloads)
};

/** Ordem estável — é a ordem em que o `/status` lista. */
export const FILAS = Object.keys(CONCORRENCIAS) as Fila[];

export function ehFila(nome: string): nome is Fila {
  return Object.hasOwn(CONCORRENCIAS, nome);
}
