import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { abrirDb } from '../db/abrir.js';
import { MIGRATIONS, aplicarMigrations } from '../db/migrations.js';
import { FilaSqlite } from '../fila/store.js';
import { quadroDoChat } from './quadro.js';
import { agenteDo, complementoEspera, ehCancelar, jobAlvo, parsearTriagem } from './triagem.js';

describe('triagem', () => {
  it('cancelar só com pedido claro', () => {
    for (const t of ['para', 'Cancela tudo!', 'esquece isso', 'pare agora.']) expect(ehCancelar(t)).toBe(true);
    for (const t of ['para quando fica pronto?', 'cancela a assinatura do HeyGen e me avisa', 'não para não']) expect(ehCancelar(t)).toBe(false);
  });

  it('parser: false explícito = outro assunto; lixo = mesmo assunto', () => {
    expect(parsearTriagem('{"mesmo":false,"motivo":"outro pedido"}')).toEqual({ mesmo: false, motivo: 'outro pedido' });
    expect(parsearTriagem('{"mesmo":true}').mesmo).toBe(true);
    expect(parsearTriagem('não sei').mesmo).toBe(true);
  });
});

describe('fila: alvo, agente e quadro', () => {
  let dir: string;
  let t = 1_700_000_000;
  let fila: FilaSqlite;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'triagem-'));
    const db = abrirDb(join(dir, 'f.db'));
    aplicarMigrations(db, () => t, MIGRATIONS);
    fila = new FilaSqlite(db, () => t);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const enf = (tarefa: string, input: object, flow = 'telegram:1') =>
    fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa, input: JSON.stringify(input), chat_id: 1, max_tentativas: 1, flow_ref: flow });

  it('alvo = o que roda; agente vem da tarefa ou do agente-lead', () => {
    const a = enf('agente:ops', { texto: 'limpar disco' });
    const b = enf('agente:lead', { texto: 'alerta do norte avatar' });
    fila.pegar('agente', 120, 'teste'); // pega o primeiro (a)
    expect(jobAlvo([fila.obter(a.id)!, fila.obter(b.id)!])!.id).toBe(a.id);
    expect(agenteDo(fila.obter(a.id)!)).toBe('ops');
    const l = fila.enfileirar({ fila: 'io', kind: 'function', tarefa: 'agente-lead', input: JSON.stringify({ entrada: { agente: 'research', texto: 'x' }, consultas: [] }), chat_id: 1, max_tentativas: 1, flow_ref: 'telegram:1' });
    expect(agenteDo(l)).toBe('research');
  });

  it('com especialista consultando, complemento espera (não roda antes do pedido)', () => {
    const c = enf('consulta:research', { texto: 'pedido A' });
    const l = fila.enfileirar({ fila: 'io', kind: 'function', tarefa: 'agente-lead', input: JSON.stringify({ entrada: { agente: 'lead', texto: 'pedido A' }, consultas: [c.id] }), chat_id: 1, max_tentativas: 1, flow_ref: 'telegram:1' });
    expect(complementoEspera([c, l])).toBe(true);
    expect(complementoEspera([enf('agente:lead', { texto: 'pedido B' })])).toBe(false);
  });

  it('quadro mostra assunto, rodando, fila e se vê como "você está executando"', () => {
    const a = enf('agente:lead', { texto: 'enviar o video-avatar do Alerta do Norte ao bot v3' });
    enf('agente:ops', { texto: 'limpar disco do output' });
    enf('agente:lead', { texto: 'outro chat' }, 'telegram:2');
    fila.pegar('agente', 120, 'teste');
    t += 300;
    const q = quadroDoChat(fila, 'telegram:1', t);
    expect(q).toContain('Assunto ativo: enviar o video-avatar');
    expect(q).toMatch(new RegExp(`Rodando: #${a.id} lead há 5 min`));
    expect(q).toContain('Na fila: #');
    expect(q).not.toContain('outro chat');
    const proprio = quadroDoChat(fila, 'telegram:1', t, a.id);
    expect(proprio).toContain(`Você está executando o job #${a.id}`);
    expect(proprio).toContain('Rodando: nada');
    expect(quadroDoChat(fila, null, t)).toBe('');
    expect(q.split('\n').length).toBeLessThanOrEqual(6);
  });
});
