// Barramento de eventos in-process, tipado (padrão nanobot/bus). Canais
// publicam `mensagem.recebida`; o orquestrador publica `mensagem.enviar`; os
// adaptadores de canal entregam. Ninguém importa ninguém "para cima".
import { EventEmitter } from 'node:events';

export type Canal = 'telegram' | 'whatsapp' | 'slack' | 'cli' | 'http';

export interface MensagemRecebida {
  canal: Canal;
  chatId: string;
  texto: string;
  usuario?: string;
  /** Nome do chat/grupo, quando o canal informa (usado no cérebro). */
  titulo?: string;
  /** Só observar: grava no cérebro e NUNCA responde. */
  observar?: boolean;
  /** id da mensagem no canal, para responder/editar. */
  ref?: string;
  traceId: string;
  recebidaEm: number;
}

export interface MensagemEnviar {
  canal: Canal;
  chatId: string;
  texto: string;
  /** Responder a esta mensagem (quando o canal suporta). */
  ref?: string;
  traceId?: string;
  /** Markdown simples (negrito/código). Default: texto puro. */
  formato?: 'texto' | 'markdown';
}

export interface Alerta {
  nivel: 'info' | 'aviso' | 'erro';
  chave: string;
  texto: string;
}

export interface Eventos {
  'mensagem.recebida': (m: MensagemRecebida) => void;
  'mensagem.enviar': (m: MensagemEnviar) => void;
  'alerta': (a: Alerta) => void;
  'job.terminou': (j: { id: number; status: string; chatId: string | null; canal?: Canal }) => void;
}

export class Bus {
  private readonly em = new EventEmitter();

  constructor() {
    this.em.setMaxListeners(50);
  }

  on<K extends keyof Eventos>(evento: K, fn: Eventos[K]): () => void {
    this.em.on(evento, fn as (...a: unknown[]) => void);
    return () => this.em.off(evento, fn as (...a: unknown[]) => void);
  }

  emit<K extends keyof Eventos>(evento: K, ...args: Parameters<Eventos[K]>): void {
    // Um listener que lança não pode derrubar o produtor.
    for (const fn of this.em.listeners(evento)) {
      try {
        const r = (fn as (...a: unknown[]) => unknown)(...args);
        if (r instanceof Promise) r.catch(() => {});
      } catch { /* isolado */ }
    }
  }

  /** Atalho: publica uma resposta no mesmo canal/chat da mensagem de origem. */
  responder(origem: MensagemRecebida, texto: string, formato: MensagemEnviar['formato'] = 'texto'): void {
    this.emit('mensagem.enviar', { canal: origem.canal, chatId: origem.chatId, texto, ref: origem.ref, traceId: origem.traceId, formato });
  }
}

export function novoTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
