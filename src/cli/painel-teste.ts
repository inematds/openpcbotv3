// Servidor SÓ do painel, para testar sem ligar o bot (sem Telegram, sem fila,
// sem segunda instância de polling). Banco do v3 aberto só para leitura.
//   npx tsx src/cli/painel-teste.ts [porta]           painel aberto (como na 3142), padrão 3199
//   npx tsx src/cli/painel-teste.ts [porta] --login   como a 3143: login por senha (PAINEL_SENHA_ARQ),
//                                                     sessões em arquivo temporário, só 127.0.0.1
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { RAIZ, carregarEnv, lerConfig } from '../config/env.js';
import { CONCORRENCIAS } from '../fila/filas.js';
import { configAccess, VerificadorAccess } from '../painel/auth/cf-access.js';
import { Sessoes } from '../painel/auth/sessoes.js';
import { abrirSomenteLeitura } from '../painel/fontes/bots.js';
import { servidorPainel } from '../painel/http-painel.js';
import { criarServidorPainel } from '../painel/servidor-painel.js';
import { caminhosPadrao, depsPadrao } from '../painel/tipos.js';

carregarEnv();
const cfg = lerConfig();
const porta = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? process.env.PAINEL_PORTA ?? 3199);
const comLogin = process.argv.includes('--login');
let db: ReturnType<typeof abrirSomenteLeitura> | undefined;
try { db = abrirSomenteLeitura(process.env.DB_PATH_V3 ?? resolve(RAIZ, 'store/openpcbotv3.db')); } catch (e) { console.error('[painel-teste] banco do v3 indisponível:', (e as Error).message); }
const caminhos = caminhosPadrao(homedir(), RAIZ);
// O teste nunca grava o estado de "já avisado" do bot de produção.
caminhos.estadoTelegram = resolve(RAIZ, 'store/painel-avisados.teste.json');
const deps = depsPadrao({ db, versao: cfg.versao, concorrenciaV3: { ...CONCORRENCIAS }, caminhos, token: process.env.PAINEL_TOKEN_TESTE || process.env.DASHBOARD_TOKEN_V3 || undefined, porSessao: comLogin });
const cfa = configAccess();
const srv = comLogin
  ? criarServidorPainel({ deps, sessoes: new Sessoes(join(mkdtempSync(join(tmpdir(), 'painel-sessoes-')), 's.json')), access: cfa ? new VerificadorAccess(cfa) : null })
  : servidorPainel(deps);
srv.listen(porta, '127.0.0.1', () => console.log(`[painel-teste] http://127.0.0.1:${porta}/painel ${comLogin ? '(com login) ' : ''}(pid ${process.pid})`));
const sair = () => { srv.close(); db?.close(); process.exit(0); };
process.on('SIGTERM', sair); process.on('SIGINT', sair);
