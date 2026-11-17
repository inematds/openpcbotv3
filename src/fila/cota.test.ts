import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { cotaConferir, cotaRegistrar, CotaEsgotada, horarioVolta, poolDe, recusaCotaClaude } from './cota.js';

// Recusa REAL do Claude Code (16/11/2026 14:34, crítico do r7ex; ids de conta removidos).
export const RECUSA_CLAUDE = JSON.stringify({
  type: 'result', subtype: 'success', is_error: true, api_error_status: 429, api_error_type: 'rate_limit_error',
  api_error_origin: 'first_party', api_error: 'usage_limit_reached', num_turns: 1, terminal_reason: 'api_error',
  result: "You've hit your weekly limit · resets 9pm (America/Sao_Paulo)",
});
// 16/11/2026 14:34 em São Paulo (UTC-3) = 17:34Z
const AGORA = Date.UTC(2026, 10, 16, 17, 34) / 1000;

const envTemp = () => ({ INEMA_COTA_DB: join(mkdtempSync(join(tmpdir(), 'cota-')), 'state.sqlite'), CLAUDE_CONFIG_DIR: '/x/.claude' });

describe('trava de cota compartilhada', () => {
  it('recusa real vira o horário de volta (21:00 de São Paulo)', () => {
    expect(recusaCotaClaude(RECUSA_CLAUDE, AGORA)).toBe(Date.UTC(2026, 10, 17, 0, 0) / 1000);
  });

  it('resposta normal falando de limite não trava', () => {
    expect(recusaCotaClaude(JSON.stringify({ type: 'result', is_error: false, result: "You've hit your weekly limit · resets 9pm (America/Sao_Paulo)" }), AGORA)).toBeUndefined();
    expect(recusaCotaClaude('não é json', AGORA)).toBeUndefined();
    expect(recusaCotaClaude(JSON.stringify({ is_error: true, result: 'outro erro' }), AGORA)).toBeUndefined();
  });

  it('horário com data; absurdo ou fuso inválido é ignorado', () => {
    const agora = Date.UTC(2026, 10, 15, 14, 0) / 1000;
    expect(horarioVolta('resets Nov 16, 9pm (America/Sao_Paulo)', agora)).toBe(Date.UTC(2026, 10, 17, 0, 0) / 1000);
    expect(horarioVolta('resets Dec 30, 9pm (America/Sao_Paulo)', agora)).toBeUndefined();
    expect(horarioVolta('resets 9pm (Lugar/Inexistente)', agora)).toBeUndefined();
  });

  it('429 momentâneo trava só 5 min', () => {
    expect(recusaCotaClaude(JSON.stringify({ is_error: true, api_error_status: 429 }), AGORA)).toBe(AGORA + 300);
  });

  it('grava, confere e libera no horário; mesma chave do ia_motor.py', () => {
    const env = envTemp();
    expect(poolDe('claude', env)).toBe('claude:/x/.claude');
    cotaConferir('claude', env, AGORA);                       // livre
    cotaRegistrar('claude', env, AGORA + 3600);
    expect(() => cotaConferir('claude', env, AGORA)).toThrow(CotaEsgotada);
    expect(() => cotaConferir('claude', env, AGORA)).toThrow(/claude sem cota \(até/);
    cotaConferir('claude', env, AGORA + 3601);                // passou o horário
    cotaConferir('codex', env, AGORA);                        // outra conta não é afetada
  });

  it('bloqueio manual do EngineBridge também vale', () => {
    const env = envTemp();
    cotaRegistrar('codex', env, 0);                           // cria o banco
    const db = new Database(env.INEMA_COTA_DB);
    db.prepare('UPDATE pools SET blocked=1').run();
    db.prepare("INSERT OR IGNORE INTO pools(pool, blocked) VALUES ('claude:/x/.claude', 1)").run();
    db.close();
    expect(() => cotaConferir('claude', env, AGORA)).toThrow(/bloqueio manual/);
  });

  it('banco inacessível não impede a chamada', () => {
    expect(() => cotaConferir('claude', { INEMA_COTA_DB: '/etc/passwd/nao/state.sqlite' }, AGORA)).not.toThrow();
  });
});
