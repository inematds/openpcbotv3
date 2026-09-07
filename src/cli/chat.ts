// `npm run cli -- "mensagem"`: manda uma mensagem ao v3 no ar via HTTP e imprime a resposta.
import { carregarEnv, lerConfig } from '../config/env.js';

carregarEnv();
const cfg = lerConfig();
const texto = process.argv.slice(2).join(' ').trim();
if (!texto) { console.error('uso: npm run cli -- "sua mensagem"'); process.exit(2); }
const token = process.env.DASHBOARD_TOKEN_V3;
fetch(`http://127.0.0.1:${cfg.porta}/mensagem`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ texto, chatId: cfg.chatPermitido ?? 'http' }),
}).then(async (r) => {
  const d = (await r.json()) as { respostas?: string[]; erro?: string };
  if (d.erro) { console.error(d.erro); process.exit(1); }
  for (const s of d.respostas ?? []) console.log(s);
}).catch((e) => { console.error(`v3 não respondeu em :${cfg.porta} — ${(e as Error).message}`); process.exit(1); });
