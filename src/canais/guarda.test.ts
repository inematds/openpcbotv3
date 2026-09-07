import { describe, expect, it } from 'vitest';

import { redigir, valoresSensiveisDoAmbiente } from './guarda.js';

describe('guarda de exfiltração', () => {
  it('redige token de bot Telegram', () => {
    const r = redigir('use 8644490375:AAHx9f2kLmNoPqRsTuVwXyZ0123456789ab no header', []);
    expect(r.redigiu).toBe(true);
    expect(r.texto).not.toMatch(/8644490375:/);
  });

  it('redige chaves sk- e xoxb e JWT', () => {
    const r = redigir('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 e xoxb-1234567890-abcdefghij eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop', []);
    expect(r.texto.match(/\[REDIGIDO\]/g)?.length).toBe(3);
  });

  it('redige valores das variáveis *_KEY/_TOKEN do ambiente', () => {
    const env = { MINHA_API_KEY: 'valor-super-secreto-123', PATH: '/usr/bin', CURTA_KEY: 'abc' };
    const extras = valoresSensiveisDoAmbiente(env);
    expect(extras).toEqual(['valor-super-secreto-123']);
    expect(redigir('a key é valor-super-secreto-123 ok', extras).texto).toBe('a key é [REDIGIDO] ok');
  });

  it('texto limpo passa intocado', () => {
    const r = redigir('oi, tudo bem? o job #12 terminou.', []);
    expect(r).toEqual({ texto: 'oi, tudo bem? o job #12 terminou.', redigiu: false });
  });
});
