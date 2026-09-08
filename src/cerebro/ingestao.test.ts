import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { aplicarMigrations } from '../db/migrations.js';
import { Cerebro } from './memoria.js';
import { Ingestao } from './ingestao.js';
import { papelDoChat } from '../canais/telegram.js';

/** Gateway falso: devolve o JSON combinado e conta as chamadas. */
function gatewayFake(respostas: string[]) {
  const g = {
    chamadas: [] as string[],
    async chamar(p: { mensagens: { role: string; content: string }[] }) {
      g.chamadas.push(p.mensagens[p.mensagens.length - 1].content);
      return { texto: respostas.shift() ?? '{"fatos":[]}' };
    },
  };
  return g;
}

function montar(respostas: string[]) {
  const db = new Database(':memory:');
  const relogio = { t: 1_757_000_000 };
  aplicarMigrations(db, () => relogio.t);
  const cerebro = new Cerebro(db, () => relogio.t);
  const g = gatewayFake(respostas);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ing = new Ingestao(db, cerebro, g as any, () => relogio.t);
  const observar = (chat: string, texto: string, grupo?: string): void =>
    cerebro.logarTurno(chat, 'telegram', 'user', texto, grupo, 'observado');
  return { db, cerebro, ing, g, observar, relogio };
}

describe('papelDoChat', () => {
  it('responder vence observar quando o chat está nas duas listas', () => {
    expect(papelDoChat('1', ['1'], ['1'])).toBe('responder');
  });
  it('observa quem está só na lista de observação, e "todos" pega qualquer chat', () => {
    expect(papelDoChat('-100', ['1'], ['-100'])).toBe('observar');
    expect(papelDoChat('-999', ['1'], ['todos'])).toBe('observar');
  });
  it('ignora chat fora das duas listas', () => {
    expect(papelDoChat('42', ['1'], ['-100'])).toBe('ignorar');
  });
  it('sem nenhuma lista configurada, responde (bot recém-criado)', () => {
    expect(papelDoChat('42', [], [])).toBe('responder');
  });
});

describe('Ingestao', () => {
  it('extrai fatos de um bloco observado e grava com a origem da fonte', async () => {
    const { ing, cerebro, observar } = montar(['{"fatos":["Paulo fecha a proposta até sexta","Reunião do time mudou para 10h"]}']);
    for (const t of ['paulo: fecho a proposta até sexta', 'ana: ok', 'ana: a reunião mudou pras 10h', 'paulo: anotado']) observar('-100', t, 'Time');
    const [r] = await ing.ingerirObservados();
    expect(r).toMatchObject({ fonte: 'telegram:-100', lidos: 4, fatos: 2 });
    const mems = cerebro.listar('-100');
    expect(mems.map((m) => m.origem)).toEqual(['telegram:-100', 'telegram:-100']);
    expect(mems.map((m) => m.content)).toContain('Paulo fecha a proposta até sexta');
  });

  it('não reprocessa o que já foi ingerido', async () => {
    const { ing, g, observar } = montar(['{"fatos":["a"]}', '{"fatos":["b"]}']);
    for (const t of ['um', 'dois', 'tres']) observar('-100', t);
    await ing.ingerirObservados();
    expect(g.chamadas).toHaveLength(1);
    // Sem mensagens novas: nem chega a chamar o modelo.
    await ing.ingerirObservados();
    expect(g.chamadas).toHaveLength(1);
    for (const t of ['quatro', 'cinco', 'seis']) observar('-100', t);
    const [r] = await ing.ingerirObservados();
    expect(g.chamadas).toHaveLength(2);
    expect(r.lidos).toBe(3);
    expect(g.chamadas[1]).not.toContain('um');
  });

  it('bloco curto demais não gasta chamada de LLM', async () => {
    const { ing, g, observar } = montar(['{"fatos":["x"]}']);
    observar('-100', 'oi');
    observar('-100', 'tudo bem?');
    expect(await ing.ingerirObservados()).toEqual([]);
    expect(g.chamadas).toHaveLength(0);
  });

  it('erro na chamada NÃO avança o marcador: o bloco é relido depois', async () => {
    const { ing, observar, db, cerebro } = montar([]);
    const quebrado = { async chamar() { throw new Error('Ollama fora'); } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ing2 = new Ingestao(db, cerebro, quebrado as any, () => 1);
    void ing;
    for (const t of ['um', 'dois', 'tres']) observar('-100', t);
    const [r] = await ing2.ingerirObservados();
    expect(r.erro).toMatch(/Ollama fora/);
    expect(r.fatos).toBe(0);
    expect(ing2.ultimoId('telegram:-100')).toBe(0);
  });

  it('resposta ilegível AVANÇA o marcador: um bloco ruim não trava a fila para sempre', async () => {
    const { ing, observar } = montar(['isso não é json', '{"fatos":["depois deu certo"]}']);
    for (const t of ['um', 'dois', 'tres']) observar('-100', t);
    const [r1] = await ing.ingerirObservados();
    expect(r1.fatos).toBe(0);
    expect(ing.ultimoId('telegram:-100')).toBeGreaterThan(0);
    for (const t of ['quatro', 'cinco', 'seis']) observar('-100', t);
    const [r2] = await ing.ingerirObservados();
    expect(r2.fatos).toBe(1);
  });

  it('conversa normal (não observada) fica fora da ingestão', async () => {
    const { ing, cerebro, g } = montar(['{"fatos":["x"]}']);
    for (const t of ['um', 'dois', 'tres']) cerebro.logarTurno('55', 'telegram', 'user', t);
    expect(await ing.ingerirObservados()).toEqual([]);
    expect(g.chamadas).toHaveLength(0);
  });

  it('estado é auditável por fonte', async () => {
    const { ing, observar } = montar(['{"fatos":["x"]}']);
    for (const t of ['um', 'dois', 'tres']) observar('-100', t, 'Time');
    await ing.ingerirObservados();
    expect(ing.estado()).toMatchObject([{ fonte: 'telegram:-100', itens: 3 }]);
    expect(ing.ultimoId('telegram:-100')).toBeGreaterThan(0);
  });
});
