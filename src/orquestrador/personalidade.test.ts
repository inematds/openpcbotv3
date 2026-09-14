import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aplicarMigrations } from '../db/migrations.js';
import { Prefs } from '../config/prefs.js';
import { blocoPersonalidade, definirPersonalidade, lerPersonalidade, lerSoul, listarPersonalidades } from './personalidade.js';

describe('personalidade', () => {
  let dir: string;
  let prefs: Prefs;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pers-'));
    writeFileSync(join(dir, 'curto.md'), '# Curto\nTrês linhas.');
    writeFileSync(join(dir, 'README.md'), 'doc');
    const db = new Database(':memory:');
    aplicarMigrations(db, () => 1);
    prefs = new Prefs(db, () => 1);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lista sem README, lê por nome e recusa caminho torto', () => {
    expect(listarPersonalidades(dir)).toEqual(['curto']);
    expect(lerPersonalidade('curto', dir)).toContain('Três linhas');
    expect(lerPersonalidade('../etc/passwd', dir)).toBeNull();
    expect(lerPersonalidade('nada', dir)).toBeNull();
  });

  it('bloco vazio sem escolha; com escolha vem rotulado; off apaga', () => {
    expect(blocoPersonalidade(prefs, '1', dir)).toBe('');
    definirPersonalidade(prefs, '1', 'curto');
    expect(blocoPersonalidade(prefs, '1', dir)).toMatch(/^\[Personalidade: curto\]/);
    definirPersonalidade(prefs, '1', null);
    expect(blocoPersonalidade(prefs, '1', dir)).toBe('');
  });

  it('SOUL.md do agente é opcional', () => {
    expect(lerSoul(dir)).toBe('');
    writeFileSync(join(dir, 'SOUL.md'), 'Persona fixa');
    expect(lerSoul(dir)).toBe('Persona fixa');
  });
});
