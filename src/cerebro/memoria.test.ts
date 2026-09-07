import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import { aplicarMigrations } from '../db/migrations.js';
import { Cerebro, classificarSetor, hashConteudo } from './memoria.js';

function novo(): { db: Database.Database; c: Cerebro; relogio: { t: number } } {
  const db = new Database(':memory:');
  const relogio = { t: 1_700_000_000 };
  aplicarMigrations(db, () => relogio.t);
  return { db, c: new Cerebro(db, () => relogio.t), relogio };
}

describe('sinais semânticos PT-BR (TODO #1 do v2)', () => {
  it.each([
    'eu prefiro modo escuro', 'minha cachorra chama Mel', 'nunca esqueça do deploy de sexta',
    'meu nome é Nei', 'lembra que moro em Porto Alegre', 'sempre uso flux2-klein', 'I prefer dark mode',
  ])('%s → semantic', (t) => expect(classificarSetor(t)).toBe('semantic'));

  it.each(['qual a previsão do tempo hoje?', 'gera um resumo desse texto aí', 'ok obrigado'])('%s → episodic', (t) =>
    expect(classificarSetor(t)).toBe('episodic'));
});

describe('Cerebro', () => {
  let db: Database.Database; let c: Cerebro; let relogio: { t: number };
  beforeEach(() => { ({ db, c, relogio } = novo()); });

  it('salva, busca por FTS e toca salience', () => {
    const m = c.salvar('1', 'eu prefiro respostas curtas e diretas');
    expect(m?.sector).toBe('semantic');
    const r = c.buscar('1', 'respostas curtas', 3);
    expect(r.map((x) => x.id)).toEqual([m!.id]);
    c.tocar(m!.id);
    expect(c.obter(m!.id)!.salience).toBeGreaterThan(1.0);
  });

  it('dedupe exato por hash: mesma frase não duplica', () => {
    c.salvar('1', 'Meu nome é Nei');
    expect(c.salvar('1', 'meu  nome é nei ')).toBeNull();
    expect(c.contagem('1').total).toBe(1);
    expect(hashConteudo('A  b')).toBe(hashConteudo('a b'));
  });

  it('superseded esconde sem apagar', () => {
    const a = c.salvar('1', 'moro em Canoas')!;
    const b = c.salvar('1', 'moro em Porto Alegre agora')!;
    c.substituir(a.id, b.id);
    expect(c.listar('1').map((m) => m.id)).toEqual([b.id]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memories').get()).toEqual({ n: 2 });
  });

  it('decaimento remove só episódicas velhas e fracas', () => {
    const e = c.salvar('1', 'hoje testei a fila do bot', 'episodic')!;
    const s = c.salvar('1', 'eu prefiro café sem açúcar', 'semantic')!;
    relogio.t += 200 * 86400;
    for (let i = 0; i < 200; i++) c.decair();
    expect(c.obter(e.id)).toBeNull();
    expect(c.obter(s.id)).not.toBeNull();
  });

  it('vetores: grava e busca por cosseno', () => {
    const a = c.salvar('1', 'gosto de música clássica')!;
    const b = c.salvar('1', 'o servidor caiu ontem')!;
    c.gravarVetor(a.id, 'bge-m3', [1, 0, 0]);
    c.gravarVetor(b.id, 'bge-m3', [0, 1, 0]);
    const r = c.buscarVetor('1', [0.9, 0.1, 0], 2, 0.5);
    expect(r[0].id).toBe(a.id);
    expect(r.length).toBe(1);
    expect(c.semVetor().length).toBe(0);
  });

  it('não vaza memória entre chats', () => {
    c.salvar('1', 'segredo do chat um sobre finanças');
    expect(c.buscar('2', 'finanças')).toEqual([]);
    expect(c.recentes('2')).toEqual([]);
  });
});
