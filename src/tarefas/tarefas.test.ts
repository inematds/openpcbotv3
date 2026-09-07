import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { aplicarMigrations } from '../db/migrations.js';
import { FilaSqlite } from '../fila/store.js';
import { Cron, proximaExecucao } from './cron.js';
import { Heartbeat } from './heartbeat.js';
import { TarefasUsuario, parsearQuando } from './usuario.js';

function base() {
  const db = new Database(':memory:');
  const rel = { t: 1_757_000_000 }; // 2025-09-04
  aplicarMigrations(db, () => rel.t);
  return { db, rel, fila: new FilaSqlite(db, () => rel.t) };
}

describe('cron', () => {
  it('proximaExecucao respeita o fuso', () => {
    const t = proximaExecucao('0 8 * * *', 1_757_000_000, 'America/Sao_Paulo');
    expect(new Date(t * 1000).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })).toBe('08:00');
  });

  it('tick enfileira uma vez por ocorrência (idem_key) e avança', () => {
    const { db, rel, fila } = base();
    const cron = new Cron(db, fila, () => rel.t);
    const c = cron.definir({ nome: 'x', expressao: '* * * * *', tarefa: 'lembretes', input: '', sessao: 'isolada', canal: 'telegram', chat_id: null });
    expect(cron.tick()).toBe(0);
    rel.t = (c.proxima_em as number) + 1;
    expect(cron.tick()).toBe(1);
    expect(cron.tick()).toBe(0); // mesma ocorrência não repete
    expect(fila.listar({ fila: 'cron' }).length).toBe(1);
    expect(cron.listar()[0].proxima_em).toBeGreaterThan(rel.t);
  });

  it('definir é idempotente por nome', () => {
    const { db, rel, fila } = base();
    const cron = new Cron(db, fila, () => rel.t);
    cron.definir({ nome: 'x', expressao: '0 8 * * *', tarefa: 'a', input: '', sessao: 'isolada', canal: 'telegram', chat_id: null });
    cron.definir({ nome: 'x', expressao: '0 9 * * *', tarefa: 'b', input: '', sessao: 'isolada', canal: 'telegram', chat_id: null });
    expect(cron.listar()).toHaveLength(1);
    expect(cron.listar()[0].tarefa).toBe('b');
  });
});

describe('tarefas do usuário', () => {
  it('parseia "em 2h", "amanhã 9h", "15/09 14h"', () => {
    const agora = Math.floor(new Date(2026, 8, 6, 22, 0).getTime() / 1000);
    expect(parsearQuando('em 2h ligar pro dentista', agora)).toEqual({ quando: agora + 7200, resto: 'ligar pro dentista' });
    const a = parsearQuando('amanhã 9h revisar PR', agora);
    expect(new Date((a.quando as number) * 1000).getHours()).toBe(9);
    expect(a.resto).toBe('revisar PR');
    const d = parsearQuando('15/09 14:30 reunião', agora);
    expect(new Date((d.quando as number) * 1000).getDate()).toBe(15);
    expect(parsearQuando('só texto', agora)).toEqual({ quando: null, resto: 'só texto' });
  });

  it('lembretes vencidos saem uma vez', () => {
    const { db, rel } = base();
    const t = new TarefasUsuario(db, () => rel.t);
    t.adicionar('1', 'x', rel.t - 10);
    t.adicionar('1', 'y', rel.t + 100);
    expect(t.lembretesVencidos().map((x) => x.texto)).toEqual(['x']);
    expect(t.lembretesVencidos()).toEqual([]);
    expect(t.pendentes('1')).toHaveLength(2);
    expect(t.concluir('1', 1)).toBe(true);
    expect(t.pendentes('1')).toHaveLength(1);
  });
});

describe('heartbeat', () => {
  it('recupera lease vencido, cancela zumbi e grava o pulso', () => {
    const { db, rel, fila } = base();
    const hb = new Heartbeat(db, fila, () => rel.t, 60);
    fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'agente:lead', input: '{}', max_tentativas: 2 });
    const j = fila.pegar('agente', 10, 'w1')!;
    rel.t += 500; // lease venceu (10 s) e passou de 2×60 s
    const r = hb.bater();
    expect(r.requeued).toBe(1);
    expect(fila.obter(j.id)!.status).toBe('queued');
    expect(hb.ultimo()?.ultimo_em).toBe(rel.t);
    // zumbi: running há mais de 2× timeout com lease ainda vivo
    const z = fila.pegar('agente', 10_000, 'w1')!;
    rel.t += 200;
    const r2 = hb.bater();
    expect(r2.zumbis.map((x) => x.id)).toEqual([z.id]);
    expect(fila.obter(z.id)!.status).toBe('canceled');
  });
});
