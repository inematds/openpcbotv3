// Cron como jobs na fila (lane `cron`). Duas sessões: `principal` (vê o
// contexto do chat) ou `isolada` (contexto limpo, mais barato).
import { CronExpressionParser } from 'cron-parser';
import type Database from 'better-sqlite3';

import type { FilaSqlite } from '../fila/store.js';

export interface CronJob {
  id: number;
  nome: string;
  expressao: string;
  tarefa: string;
  input: string;
  sessao: 'principal' | 'isolada';
  canal: string;
  chat_id: string | null;
  ativo: number;
  proxima_em: number | null;
  ultima_em: number | null;
  ultimo_job: number | null;
}

export function proximaExecucao(expressao: string, apos: number, tz = 'America/Sao_Paulo'): number {
  const it = CronExpressionParser.parse(expressao, { currentDate: new Date(apos * 1000), tz });
  return Math.floor(it.next().getTime() / 1000);
}

export class Cron {
  constructor(private readonly db: Database.Database, private readonly fila: FilaSqlite, private readonly agora: () => number) {}

  listar(): CronJob[] {
    return this.db.prepare('SELECT * FROM cron_jobs ORDER BY nome').all() as CronJob[];
  }

  /** Cria ou atualiza (idempotente por nome). */
  definir(c: Omit<CronJob, 'id' | 'ativo' | 'proxima_em' | 'ultima_em' | 'ultimo_job'>): CronJob {
    const prox = proximaExecucao(c.expressao, this.agora());
    this.db.prepare(
      `INSERT INTO cron_jobs (nome, expressao, tarefa, input, sessao, canal, chat_id, proxima_em, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(nome) DO UPDATE SET expressao = excluded.expressao, tarefa = excluded.tarefa, input = excluded.input,
         sessao = excluded.sessao, canal = excluded.canal, chat_id = excluded.chat_id, proxima_em = excluded.proxima_em, ativo = 1`,
    ).run(c.nome, c.expressao, c.tarefa, c.input, c.sessao, c.canal, c.chat_id, prox, this.agora());
    return this.db.prepare('SELECT * FROM cron_jobs WHERE nome = ?').get(c.nome) as CronJob;
  }

  ativar(nome: string, ativo: boolean): boolean {
    return this.db.prepare('UPDATE cron_jobs SET ativo = ? WHERE nome = ?').run(ativo ? 1 : 0, nome).changes === 1;
  }

  remover(nome: string): boolean {
    return this.db.prepare('DELETE FROM cron_jobs WHERE nome = ?').run(nome).changes === 1;
  }

  /**
   * Tick (a cada 30 s): enfileira o que venceu com `idem_key = nome@proxima_em`
   * (nunca dispara duas vezes a mesma ocorrência) e avança `proxima_em`.
   */
  tick(): number {
    const t = this.agora();
    const vencidos = this.db.prepare('SELECT * FROM cron_jobs WHERE ativo = 1 AND proxima_em IS NOT NULL AND proxima_em <= ?').all(t) as CronJob[];
    let n = 0;
    for (const c of vencidos) {
      const { job, novo } = this.fila.enfileirarSeNovo({
        fila: 'cron', kind: 'function', tarefa: c.tarefa,
        input: JSON.stringify({ cron: c.nome, sessao: c.sessao, canal: c.canal, chatId: c.chat_id, input: c.input }),
        idem_key: `cron:${c.nome}@${c.proxima_em}`, max_tentativas: 2,
        chat_id: c.chat_id && /^-?\d+$/.test(c.chat_id) ? Number(c.chat_id) : null,
      });
      let prox: number | null = null;
      try { prox = proximaExecucao(c.expressao, t); } catch { /* expressão inválida: desativa abaixo */ }
      this.db.prepare('UPDATE cron_jobs SET proxima_em = ?, ultima_em = ?, ultimo_job = ?, ativo = ? WHERE id = ?')
        .run(prox, t, job.id, prox ? 1 : 0, c.id);
      if (novo) n += 1;
    }
    return n;
  }
}
