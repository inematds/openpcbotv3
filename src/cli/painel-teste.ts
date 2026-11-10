// Servidor SÓ do painel, para testar sem ligar o bot (sem Telegram, sem fila,
// sem segunda instância de polling). Banco do v3 aberto só para leitura.
//   npx tsx src/cli/painel-teste.ts [porta]      (padrão 3199, só 127.0.0.1)
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { RAIZ, carregarEnv, lerConfig } from '../config/env.js';
import { CONCORRENCIAS } from '../fila/filas.js';
import { abrirSomenteLeitura } from '../painel/fontes/bots.js';
import { servidorPainel } from '../painel/http-painel.js';
import { caminhosPadrao, depsPadrao } from '../painel/tipos.js';

carregarEnv();
const cfg = lerConfig();
const porta = Number(process.argv[2] ?? process.env.PAINEL_PORTA ?? 3199);
let db: ReturnType<typeof abrirSomenteLeitura> | undefined;
try { db = abrirSomenteLeitura(process.env.DB_PATH_V3 ?? resolve(RAIZ, 'store/openpcbotv3.db')); } catch (e) { console.error('[painel-teste] banco do v3 indisponível:', (e as Error).message); }
const caminhos = caminhosPadrao(homedir(), RAIZ);
// O teste nunca grava o estado de "já avisado" do bot de produção.
caminhos.estadoTelegram = resolve(RAIZ, 'store/painel-avisados.teste.json');
const deps = depsPadrao({ db, versao: cfg.versao, concorrenciaV3: { ...CONCORRENCIAS }, caminhos, token: process.env.PAINEL_TOKEN_TESTE || process.env.DASHBOARD_TOKEN_V3 || undefined });
const srv = servidorPainel(deps);
srv.listen(porta, '127.0.0.1', () => console.log(`[painel-teste] http://127.0.0.1:${porta}/painel (pid ${process.pid})`));
const sair = () => { srv.close(); db?.close(); process.exit(0); };
process.on('SIGTERM', sair); process.on('SIGINT', sair);
