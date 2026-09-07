// Heartbeat (30 min): recupera leases vencidos, detecta zumbi (job rodando
// > 2× o timeout), grava o pulso e devolve alertas. Padrão openclaw/Hermes.
import type Database from 'better-sqlite3';

import type { FilaSqlite } from '../fila/store.js';
import type { Job } from '../fila/types.js';

export interface ResultadoHeartbeat {
  requeued: number;
  falhados: Job[];
  zumbis: Job[];
  alertas: { chave: string; nivel: 'aviso' | 'erro'; texto: string }[];
}

export class Heartbeat {
  constructor(
    private readonly db: Database.Database,
    private readonly fila: FilaSqlite,
    private readonly agora: () => number,
    private readonly timeoutAgenteSeg = 20 * 60,
  ) {}

  bater(detalhe?: string): ResultadoHeartbeat {
    const t = this.agora();
    const { requeued, falhados } = this.fila.recuperarLeasesVencidos();
    const zumbis = (this.fila.listar({ status: 'running' }) as Job[]).filter((j) => j.iniciado_em !== null && t - (j.iniciado_em as number) > 2 * this.timeoutAgenteSeg);
    const alertas: ResultadoHeartbeat['alertas'] = [];
    if (falhados.length) alertas.push({ chave: 'fila.lease-morto', nivel: 'aviso', texto: `${falhados.length} job(s) falharam por lease vencido: ${falhados.map((j) => `#${j.id}`).join(', ')}` });
    for (const z of zumbis) {
      alertas.push({ chave: `fila.zumbi.${z.id}`, nivel: 'erro', texto: `Job #${z.id} (${z.fila}/${z.tarefa}) rodando há ${Math.round((t - (z.iniciado_em as number)) / 60)} min — zumbi, cancelando` });
      this.fila.cancelar(z.id);
    }
    // 3 falhas recentes do mesmo tipo de tarefa → alerta
    const repetidas = this.db.prepare(
      `SELECT tarefa, COUNT(*) AS n FROM jobs WHERE status = 'failed' AND terminado_em >= ? GROUP BY tarefa HAVING n >= 3`,
    ).all(t - 3600) as { tarefa: string; n: number }[];
    for (const r of repetidas) alertas.push({ chave: `fila.falhas.${r.tarefa}`, nivel: 'aviso', texto: `Tarefa ${r.tarefa} falhou ${r.n}× na última hora` });

    this.db.prepare('INSERT INTO heartbeat (id, ultimo_em, detalhe) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET ultimo_em = excluded.ultimo_em, detalhe = excluded.detalhe')
      .run(t, detalhe ?? null);
    return { requeued, falhados, zumbis, alertas };
  }

  ultimo(): { ultimo_em: number; detalhe: string | null } | undefined {
    return this.db.prepare('SELECT ultimo_em, detalhe FROM heartbeat WHERE id = 1').get() as { ultimo_em: number; detalhe: string | null } | undefined;
  }
}
