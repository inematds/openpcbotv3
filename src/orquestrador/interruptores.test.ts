import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { aplicarMigrations } from '../db/migrations.js';
import { FilaSqlite } from '../fila/store.js';
import { Prefs } from '../config/prefs.js';
import { Interruptores, cancelarEmVoo, filtroDoAlvo, parsearAlvo } from './interruptores.js';

function montar() {
  const db = new Database(':memory:');
  let t = 1000;
  const agora = () => t++;
  aplicarMigrations(db, agora);
  return { prefs: new Prefs(db, agora), fila: new FilaSqlite(db, agora) };
}

describe('parsearAlvo', () => {
  it('aceita tudo/agentes/agente conhecido e recusa desconhecido', () => {
    expect(parsearAlvo(undefined, [])).toBe('tudo');
    expect(parsearAlvo('agentes', [])).toBe('agentes');
    expect(parsearAlvo('ops', ['ops'])).toBe('agente:ops');
    expect(parsearAlvo('agente:ops', ['ops'])).toBe('agente:ops');
    expect(parsearAlvo('hacker', ['ops'])).toBeNull();
  });
});

describe('Interruptores', () => {
  it('tudo bloqueia resposta e qualquer agente; persiste com motivo', () => {
    const { prefs } = montar();
    const i = new Interruptores(prefs);
    expect(i.bloqueiaResposta()).toBeNull();
    i.ligar('tudo', 'manutenção');
    expect(i.bloqueiaResposta()).toContain('manutenção');
    expect(i.bloqueiaAgente('ops')).toContain('tudo');
    expect(new Interruptores(prefs).listar()).toHaveLength(1);
    expect(i.desligar('tudo')).toBe(true);
    expect(i.bloqueiaResposta()).toBeNull();
  });

  it('agentes bloqueia só o despacho de agente; agente:<id> só aquele', () => {
    const i = new Interruptores(montar().prefs);
    i.ligar('agentes');
    expect(i.bloqueiaResposta()).toBeNull();
    expect(i.bloqueiaAgente('ops')).toContain('agentes');
    i.desligarTodos();
    i.ligar('agente:ops', 'quebrado');
    expect(i.bloqueiaAgente('ops')).toContain('quebrado');
    expect(i.bloqueiaAgente('research')).toBeNull();
  });
});

describe('cancelarEmVoo', () => {
  it('cancela queued e running das lanes de conversa segundo o alvo', () => {
    const { fila } = montar();
    const a = fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'agente:ops', input: '{}' });
    const b = fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'consulta:research', input: '{}' });
    const c = fila.enfileirar({ fila: 'ollama', kind: 'function', tarefa: 'consolidacao', input: '{}' });
    expect(cancelarEmVoo(fila, filtroDoAlvo('agente:ops'))).toBe(1);
    expect(fila.obter(a.id)?.status).toBe('canceled');
    expect(fila.obter(b.id)?.status).toBe('queued');
    expect(cancelarEmVoo(fila, filtroDoAlvo('tudo'))).toBe(1);
    expect(fila.obter(c.id)?.status).toBe('queued');
  });
});
