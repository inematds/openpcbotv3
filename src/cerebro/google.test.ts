import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

// O conector Python é substituído no nível do `execFile`: o que se testa aqui é
// a SEMÂNTICA DO MARCADOR, não a API do Google.
const saidas: string[] = [];
vi.mock('node:child_process', () => ({
  // promisify() sem o símbolo custom resolve o 1º valor do callback — por isso
  // o objeto {stdout,stderr} inteiro vai como um argumento só.
  execFile: (_c: string, _a: string[], _o: unknown, cb: (e: Error | null, r: unknown) => void) =>
    cb(null, { stdout: saidas.shift() ?? '[]', stderr: '' }),
}));

const { aplicarMigrations } = await import('../db/migrations.js');
const { Cerebro } = await import('./memoria.js');
const { Ingestao } = await import('./ingestao.js');
const { ingerirCalendario, ingerirGmail } = await import('./google.js');

const relogio = { t: 1_757_000_000 };
let ing: InstanceType<typeof Ingestao>;
const gateway = { async chamar() { return { texto: '{"fatos":["Reunião com o time na terça"]}' }; } };

beforeEach(() => {
  saidas.length = 0;
  relogio.t = 1_757_000_000;
  const db = new Database(':memory:');
  aplicarMigrations(db, () => relogio.t);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ing = new Ingestao(db, new Cerebro(db, () => relogio.t), gateway as any, () => relogio.t);
});

describe('ingerirCalendario', () => {
  it('vê um evento criado DEPOIS, mesmo começando antes do evento mais distante da janela', async () => {
    // 1ª passagem: a janela tem um evento lá na frente (daqui a 10 dias).
    saidas.push(JSON.stringify([{ account: 'pessoal', summary: 'Viagem', start: '2026-09-17T09:00:00-03:00' }]));
    await ingerirCalendario(ing, 'c1', 14, undefined, () => relogio.t);
    const marcador = ing.ultimoId('gcal:pessoal');
    expect(marcador).toBeGreaterThan(0);

    // 2ª passagem, um dia depois: entra um compromisso para AMANHÃ, cujo `start`
    // é MENOR que o da viagem. Com o marcador pela data do evento ele sumiria.
    relogio.t += 86_400;
    saidas.push(JSON.stringify([
      { account: 'pessoal', summary: 'Viagem', start: '2026-09-17T09:00:00-03:00' },
      { account: 'pessoal', summary: 'Dentista', start: '2026-09-08T14:00:00-03:00' },
    ]));
    const r = await ingerirCalendario(ing, 'c1', 14, undefined, () => relogio.t);
    expect(r[0].lidos).toBe(2);
    expect(ing.ultimoId('gcal:pessoal')).toBeGreaterThan(marcador);
  });

  it('duas passagens no mesmo segundo não se anulam por empate de relógio', async () => {
    saidas.push(JSON.stringify([{ account: 'pessoal', summary: 'A', start: '2026-09-10T09:00:00-03:00' }]));
    await ingerirCalendario(ing, 'c1', 14, undefined, () => relogio.t);
    const m1 = ing.ultimoId('gcal:pessoal');
    saidas.push(JSON.stringify([{ account: 'pessoal', summary: 'B', start: '2026-09-11T09:00:00-03:00' }]));
    const r = await ingerirCalendario(ing, 'c1', 14, undefined, () => relogio.t);
    expect(r[0].lidos).toBe(1);
    expect(ing.ultimoId('gcal:pessoal')).toBe(m1 + 1);
  });
});

describe('ingerirGmail', () => {
  it('lê só o que chegou depois do marcador e separa uma fonte por conta', async () => {
    saidas.push(JSON.stringify([
      { conta: 'pessoal', id: 'a', de: 'x@y', assunto: 'Nota', data: '2026-09-06T10:00:00Z', resumo: 'oi' },
      { conta: 'trabalho', id: 'b', de: 'z@w', assunto: 'Contrato', data: '2026-09-06T11:00:00Z', resumo: 'assinar' },
    ]));
    const r1 = await ingerirGmail(ing, 'c1', 8, undefined, () => relogio.t);
    expect(r1.map((x) => x.fonte).sort()).toEqual(['gmail:pessoal', 'gmail:trabalho']);

    // Repetir o MESMO lote não reprocessa nada: o marcador já passou dessas datas.
    saidas.push(JSON.stringify([
      { conta: 'pessoal', id: 'a', de: 'x@y', assunto: 'Nota', data: '2026-09-06T10:00:00Z', resumo: 'oi' },
    ]));
    expect(await ingerirGmail(ing, 'c1', 8, undefined, () => relogio.t)).toEqual([]);
  });
});
