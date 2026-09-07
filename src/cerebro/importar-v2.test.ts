import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aplicarMigrations } from '../db/migrations.js';
import { importarMemoriasV2 } from './importar-v2.js';

describe('importar memórias do v2 por snapshot', () => {
  it('lê via VACUUM INTO, insere com origem v2 e é idempotente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v2-'));
    const v2 = new Database(join(dir, 'openpcbot.db'));
    v2.exec(`CREATE TABLE memories (id INTEGER PRIMARY KEY, chat_id TEXT, topic_key TEXT, content TEXT, sector TEXT, salience REAL, created_at INTEGER, accessed_at INTEGER)`);
    v2.prepare('INSERT INTO memories VALUES (1,?,?,?,?,?,?,?)').run('7', null, 'eu prefiro respostas curtas', 'semantic', 1.2, 1_700_000_000_000, 1_700_000_000_000);
    v2.prepare('INSERT INTO memories VALUES (2,?,?,?,?,?,?,?)').run('7', null, 'ontem testei o kling', 'episodic', 0.4, 1_700_000_100, 1_700_000_100);
    v2.close();

    const v3 = new Database(':memory:');
    aplicarMigrations(v3, () => 1);
    const r1 = importarMemoriasV2(v3, join(dir, 'openpcbot.db'), () => 2, join(dir, 'tmp'));
    expect(r1).toMatchObject({ lidas: 2, inseridas: 2, puladas: 0 });
    const r2 = importarMemoriasV2(v3, join(dir, 'openpcbot.db'), () => 3, join(dir, 'tmp'));
    expect(r2).toMatchObject({ inseridas: 0, puladas: 2 });
    const l = v3.prepare('SELECT origem, created_at, sector FROM memories ORDER BY id').all() as { origem: string; created_at: number; sector: string }[];
    expect(l[0]).toEqual({ origem: 'v2', created_at: 1_700_000_000, sector: 'semantic' }); // ms normalizado para s
    expect(l[1].sector).toBe('episodic');
  });
});
