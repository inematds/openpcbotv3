// Quadro do chat: o MESMO retrato do momento para roteador, qwen, Claude e Codex.
// Montado por código na hora de cada chamada, lendo a fila — nunca guardado,
// para não ficar velho (bot reiniciado, job morto já aparecem certos).
import type { FilaSqlite } from '../fila/store.js';
import type { Job } from '../fila/types.js';
import { jobsAbertos, pedidoDe } from './situacao.js';

/** Tarefas que são trabalho de agente (não poll interno nem cron). */
export function ehJobDeAgente(j: Job): boolean {
  return /^(agente:|consulta:|agente-lead$)/.test(j.tarefa);
}

function hora(seg: number): string {
  return new Date(seg * 1000).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

function curto(t: string, n: number): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function quem(j: Job): string {
  return j.tarefa.replace(/^(agente|consulta):/, '');
}

/** Último job de agente terminado deste chat (done/failed), entre os mais recentes. */
function ultimaEntrega(fila: FilaSqlite, flowRef: string): Job | undefined {
  const fim = [...fila.listar({ status: 'done', limite: 200 }), ...fila.listar({ status: 'failed', limite: 100 })]
    .filter((j) => j.flow_ref === flowRef && j.tarefa.startsWith('agente:'));
  return fim.sort((a, b) => (b.terminado_em ?? 0) - (a.terminado_em ?? 0))[0];
}

/**
 * Bloco `[Situação deste chat]` (≤ 6 linhas). `proprio` = id do job que vai
 * ler o quadro (o agente se vê como "você está nesta").
 */
export function quadroDoChat(fila: FilaSqlite, flowRef: string | null, agora: number, proprio?: number): string {
  if (!flowRef) return '';
  const abertos = jobsAbertos(fila, flowRef).filter(ehJobDeAgente);
  const rodando = abertos.filter((j) => j.status === 'running' && j.id !== proprio);
  const naFila = abertos.filter((j) => j.status === 'queued' && j.id !== proprio);
  const entrega = ultimaEntrega(fila, flowRef);
  const ativo = abertos.find((j) => j.id === proprio) ?? abertos[0] ?? entrega;
  const assunto = ativo ? curto(pedidoDe(ativo), 90) : '';

  const l: string[] = [`[Situação deste chat — ${hora(agora)}, lida da fila agora]`];
  l.push(`Assunto ativo: ${assunto || '(nenhum trabalho de agente recente)'}`);
  if (proprio) l.push(`Você está executando o job #${proprio}.`);
  l.push(rodando.length ? `Rodando: ${rodando.map((j) => `#${j.id} ${quem(j)} há ${Math.max(0, Math.round((agora - (j.iniciado_em ?? j.criado_em)) / 60))} min — "${curto(pedidoDe(j), 60)}"`).join('; ')}` : 'Rodando: nada');
  if (naFila.length) l.push(`Na fila: ${naFila.slice(0, 3).map((j) => `#${j.id} ${quem(j)} — "${curto(pedidoDe(j), 50)}"`).join('; ')}${naFila.length > 3 ? ` (+${naFila.length - 3})` : ''}`);
  if (entrega) {
    const r = entrega.status === 'done' ? curto(entrega.resultado ?? '', 90) : `falhou: ${curto(entrega.erro ?? '?', 60)}`;
    l.push(`Última entrega: #${entrega.id} ${quem(entrega)} às ${hora(entrega.terminado_em ?? entrega.criado_em)} — ${r}`);
  }
  return l.join('\n');
}

/** Prefixo de quem respondeu. */
export const PREFIXO = {
  local: '🏠 ',
  agente: (id: number, agente: string) => `🧠 #${id} ${agente} · `,
} as const;
