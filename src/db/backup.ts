// Backup noturno: `VACUUM INTO` (consistente com WAL) + cifra com `age` se
// existir, senão gzip. Mantém os últimos 14.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';

const run = promisify(execFile);

export async function backupSqlite(db: Database.Database, dir: string, agora: () => number, manter = 14): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(agora() * 1000).toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const bruto = resolve(dir, `openpcbotv3-${stamp}.db`);
  db.exec(`VACUUM INTO '${bruto.replace(/'/g, "''")}'`);
  let final = bruto;
  const recipient = process.env.AGE_RECIPIENT;
  try {
    if (recipient) {
      await run('age', ['-r', recipient, '-o', `${bruto}.age`, bruto]);
      final = `${bruto}.age`;
    } else {
      await run('gzip', ['-f', bruto]);
      final = `${bruto}.gz`;
    }
    if (final !== bruto && existsSync(bruto)) rmSync(bruto);
  } catch { /* fica o .db cru — melhor que nenhum backup */ }
  const arquivos = readdirSync(dir).filter((f) => f.startsWith('openpcbotv3-')).map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { f } of arquivos.slice(manter)) rmSync(resolve(dir, f));
  return final;
}
