// Kill switches (claudeclaw-os `kill-switches.ts`, adaptado). Três alvos:
// `tudo` (nenhuma resposta nem agente), `agentes` (nenhum `claude -p`; resposta
// direta no Ollama continua) e `agente:<id>`. Persistem em `prefs` ('*').
// Manutenção na lane `ollama` (consolidação, ingestão) NÃO é bloqueada: custo
// zero e não fala com ninguém.
import type { FilaSqlite } from '../fila/store.js';
import { GLOBAL, type Prefs } from '../config/prefs.js';

export type Alvo = 'tudo' | 'agentes' | `agente:${string}`;

export interface Interruptor { alvo: Alvo; motivo: string; em: number }

const CHAVE = 'parar:';

export function parsearAlvo(s: string | undefined, agentes: string[]): Alvo | null {
  const t = (s ?? 'tudo').toLowerCase();
  if (t === 'tudo' || t === 'all') return 'tudo';
  if (t === 'agentes' || t === 'agents') return 'agentes';
  const id = t.replace(/^agente:/, '');
  return agentes.includes(id) ? `agente:${id}` : null;
}

export class Interruptores {
  constructor(private readonly prefs: Prefs) {}

  ligar(alvo: Alvo, motivo = ''): void { this.prefs.gravar(GLOBAL, CHAVE + alvo, motivo || 'sem motivo'); }
  desligar(alvo: Alvo): boolean { return this.prefs.apagar(GLOBAL, CHAVE + alvo); }
  desligarTodos(): number { let n = 0; for (const i of this.listar()) if (this.desligar(i.alvo)) n += 1; return n; }

  listar(): Interruptor[] {
    return this.prefs.listar(CHAVE).map((l) => ({ alvo: l.chave.slice(CHAVE.length) as Alvo, motivo: l.valor, em: l.em }));
  }

  /** Motivo do bloqueio para responder em geral, ou null se livre. */
  bloqueiaResposta(): string | null { return this.motivo('tudo'); }

  /** Motivo do bloqueio para despachar um agente específico, ou null. */
  bloqueiaAgente(id: string): string | null {
    return this.motivo('tudo') ?? this.motivo('agentes') ?? this.motivo(`agente:${id}`);
  }

  private motivo(alvo: Alvo): string | null {
    const v = this.prefs.obter(GLOBAL, CHAVE + alvo);
    return v === undefined ? null : `${alvo}: ${v}`;
  }
}

/**
 * `/parar tudo` também cancela o que está em voo nas lanes de conversa e agente.
 * Um `claude -p` em execução só morre quando o worker bate (até 30 s).
 */
export function cancelarEmVoo(fila: FilaSqlite, filtro: (tarefa: string) => boolean): number {
  let n = 0;
  for (const status of ['queued', 'running'] as const) {
    for (const j of fila.listar({ status, limite: 500 })) {
      if ((j.fila === 'chat' || j.fila === 'agente' || j.fila === 'io') && filtro(j.tarefa) && fila.cancelar(j.id)) n += 1;
    }
  }
  return n;
}

export function filtroDoAlvo(alvo: Alvo): (tarefa: string) => boolean {
  if (alvo === 'tudo') return () => true;
  if (alvo === 'agentes') return (t) => t.startsWith('agente') || t.startsWith('consulta:');
  const id = alvo.slice('agente:'.length);
  return (t) => t === `agente:${id}` || t === `consulta:${id}`;
}
