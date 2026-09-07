// Importa `memories` do v2 SEM abrir o banco dele para escrita: snapshot com
// `VACUUM INTO` (leitura consistente com WAL), depois INSERT no v3 marcando
// `origem='v2'` e `hash` para dedupe. Idempotente: pula o que já existe.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

import { hashConteudo } from './memoria.js';

export interface ResultadoImportacao {
  lidas: number;
  inseridas: number;
  puladas: number;
  snapshot: string;
}

export function importarMemoriasV2(dbV3: Database.Database, dbV2Path: string, agora: () => number, dirTmp: string): ResultadoImportacao {
  if (!existsSync(dbV2Path)) throw new Error(`banco do v2 não encontrado: ${dbV2Path}`);
  mkdirSync(dirTmp, { recursive: true });
  const snapshot = resolve(dirTmp, `v2-memories-${agora()}.db`);
  const origem = new Database(dbV2Path, { readonly: true });
  try {
    origem.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  } finally { origem.close(); }

  const snap = new Database(snapshot, { readonly: true });
  const linhas = snap.prepare(
    'SELECT chat_id, topic_key, content, sector, salience, created_at, accessed_at FROM memories ORDER BY id',
  ).all() as { chat_id: string; topic_key: string | null; content: string; sector: string; salience: number; created_at: number; accessed_at: number }[];
  snap.close();

  const existe = dbV3.prepare('SELECT 1 FROM memories WHERE chat_id = ? AND hash = ? LIMIT 1');
  const ins = dbV3.prepare(
    `INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at, origem, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'v2', ?)`,
  );
  let inseridas = 0, puladas = 0;
  dbV3.transaction(() => {
    for (const l of linhas) {
      const h = hashConteudo(l.content);
      if (existe.get(l.chat_id, h)) { puladas += 1; continue; }
      const setor = l.sector === 'semantic' || l.sector === 'procedural' ? l.sector : 'episodic';
      // v2 guardava ms em alguns registros e s em outros; normaliza para segundos.
      const norm = (t: number): number => (t > 1e12 ? Math.floor(t / 1000) : t);
      ins.run(l.chat_id, l.topic_key, l.content, setor, l.salience, norm(l.created_at), norm(l.accessed_at), h);
      inseridas += 1;
    }
  })();
  try { rmSync(snapshot); rmSync(dirname(snapshot), { recursive: false }); } catch { /* dir pode ter outros arquivos */ }
  return { lidas: linhas.length, inseridas, puladas, snapshot };
}
