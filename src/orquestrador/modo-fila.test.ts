import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { aplicarMigrations } from '../db/migrations.js';
import { FilaSqlite } from '../fila/store.js';
import { Prefs } from '../config/prefs.js';
import { Geracoes, cancelarDoChat, gravarModo, lerModo, parsearModo } from './modo-fila.js';

function montar() {
  const db = new Database(':memory:');
  let t = 1000;
  const agora = () => t++;
  aplicarMigrations(db, agora);
  return { prefs: new Prefs(db, agora), fila: new FilaSqlite(db, agora) };
}

describe('modo de fila', () => {
  it('parseia e persiste por chat, com padrão collect', () => {
    const { prefs } = montar();
    expect(parsearModo('STEER')).toBe('steer');
    expect(parsearModo('x')).toBeNull();
    expect(lerModo(prefs, '1')).toBe('collect');
    gravarModo(prefs, '1', 'interrupt');
    expect(lerModo(prefs, '1')).toBe('interrupt');
    expect(lerModo(prefs, '2')).toBe('collect');
  });

  it('cancelarDoChat respeita flow_ref, emVoo e apenasTarefa', () => {
    const { fila } = montar();
    const a = fila.enfileirar({ fila: 'chat', kind: 'function', tarefa: 'responder', input: '{}', flow_ref: 'telegram:1' });
    const b = fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'agente:ops', input: '{}', flow_ref: 'telegram:1' });
    const c = fila.enfileirar({ fila: 'chat', kind: 'function', tarefa: 'responder', input: '{}', flow_ref: 'telegram:2' });
    expect(cancelarDoChat(fila, 'telegram:1', { emVoo: false, apenasTarefa: 'responder' })).toBe(1);
    expect(fila.obter(a.id)?.status).toBe('canceled');
    expect(fila.obter(b.id)?.status).toBe('queued');
    expect(cancelarDoChat(fila, 'telegram:1', { emVoo: true })).toBe(1);
    expect(fila.obter(c.id)?.status).toBe('queued');
  });

  it('geração avança e invalida a anterior', () => {
    const g = new Geracoes();
    const antes = g.atual('k');
    expect(g.vigente('k', antes)).toBe(true);
    g.avancar('k');
    expect(g.vigente('k', antes)).toBe(false);
    expect(g.vigente('k', g.atual('k'))).toBe(true);
  });
});
