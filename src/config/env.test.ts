import { describe, expect, it } from 'vitest';

import { BOT_ID_V2, validarTokenTelegram } from './env.js';

describe('guarda do token do Telegram', () => {
  it('recusa o token do v2 (409 → bot surdo)', () => {
    const r = validarTokenTelegram(`${BOT_ID_V2}:AAHabcdefghijklmnopqrstuvwxyz0123456`);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/v2/);
  });
  it('recusa ausente e formato inválido', () => {
    expect(validarTokenTelegram(undefined).ok).toBe(false);
    expect(validarTokenTelegram('abc').ok).toBe(false);
  });
  it('aceita token próprio', () => {
    expect(validarTokenTelegram('1234567890:AAHabcdefghijklmnopqrstuvwxyz0123456').ok).toBe(true);
  });
});
