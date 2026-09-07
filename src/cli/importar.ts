// `npx tsx src/cli/importar.ts`: importa as memórias do v2 por snapshot.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { carregarEnv, lerConfig, RAIZ, RAIZ_V2 } from '../config/env.js';
import { abrirDb } from '../db/abrir.js';
import { aplicarMigrations } from '../db/migrations.js';
import { importarMemoriasV2 } from '../cerebro/importar-v2.js';

carregarEnv();
const cfg = lerConfig();
mkdirSync(dirname(cfg.dbPath), { recursive: true });
const db = abrirDb(cfg.dbPath);
aplicarMigrations(db, () => Math.floor(Date.now() / 1000));
const r = importarMemoriasV2(db, process.argv[2] ?? resolve(RAIZ_V2, 'store/openpcbot.db'), () => Math.floor(Date.now() / 1000), resolve(RAIZ, 'store/tmp'));
db.close();
console.log(`memórias do v2: lidas ${r.lidas} · inseridas ${r.inseridas} · já existiam ${r.puladas}`);
