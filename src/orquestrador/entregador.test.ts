// Entrega do resultado de job de agente (11/11/2026): chat de texto ("painel") não tem chat_id numérico
// e o resultado era descartado — o painel só via "job #N".
import { describe, expect, it } from 'vitest';

import type { App } from '../app.js';
import type { Job } from '../fila/types.js';
import { criarEntregador } from './tarefas-fila.js';

function app() {
  const enviados: { canal: string; chatId: string; texto: string }[] = [];
  const a = { cerebro: { logarTurno: () => {} }, bus: { emit: (_e: string, m: { canal: string; chatId: string; texto: string }) => { enviados.push(m); } } } as unknown as App;
  return { a, enviados };
}
const job = (p: Partial<Job>) => ({ id: 7, tarefa: 'agente:lead', status: 'done', resultado: 'duas VPS passam de 50%', erro: null, chat_id: null, ...p }) as Job;

describe('entregador de job de agente', () => {
  it('chat do painel (sem chat_id numérico) recebe o resultado', async () => {
    const { a, enviados } = app();
    await criarEntregador(a)(job({ input: JSON.stringify({ chatId: 'painel', canal: 'http', texto: 'x', agente: 'lead' }) }));
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ canal: 'http', chatId: 'painel' });
    expect(enviados[0].texto).toContain('duas VPS passam de 50%');
  });

  it('sem chat nenhum não envia', async () => {
    const { a, enviados } = app();
    await criarEntregador(a)(job({ input: JSON.stringify({ canal: 'http', texto: 'x', agente: 'lead' }) }));
    expect(enviados).toHaveLength(0);
  });
});
