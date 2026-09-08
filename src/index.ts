// Ponto de entrada: monta o App, liga canais, workers da fila, timers
// (probe do Ollama, cron, heartbeat) e o desligamento gracioso (drain com
// lease renovado, timeout, abort). Nenhuma lógica de domínio aqui.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { App } from './app.js';
import { Bus } from './bus/bus.js';
import { carregarEnv, lerConfig, RAIZ, RAIZ_V2 } from './config/env.js';
import { lerConfigOllama, lerConfigOrcamento, lerConfigPrecos } from './config/yaml.js';
import { abrirDb } from './db/abrir.js';
import { aplicarMigrations } from './db/migrations.js';
import { FilaSqlite } from './fila/store.js';
import { Worker } from './fila/worker.js';
import { CONCORRENCIAS, FILAS } from './fila/filas.js';
import { ClaudeRunner } from './fila/runner-claude.js';
import { GestorOllama } from './ollama/gestor.js';
import { GatewayLLM } from './custo/gateway.js';
import { RegistroCusto } from './custo/registro.js';
import { Orcamento } from './custo/orcamento.js';
import { ProvedorOllama } from './provedores/ollama.js';
import { ProvedorOpenRouter } from './provedores/openrouter.js';
import { ProvedorAnthropic } from './provedores/anthropic.js';
import { Cerebro } from './cerebro/memoria.js';
import { Ingestao } from './cerebro/ingestao.js';
import { Vault } from './cerebro/vault.js';
import { Alertas } from './telemetria/alertas.js';
import { logger } from './telemetria/logger.js';
import { Cron } from './tarefas/cron.js';
import { TarefasUsuario } from './tarefas/usuario.js';
import { Heartbeat } from './tarefas/heartbeat.js';
import { Sessoes, argumentosCli, criarPromptDe, TIMEOUT_AGENTE_MS } from './orquestrador/agente-cli.js';
import { Orquestrador } from './orquestrador/orquestrador.js';
import { criarEntregador, criarTarefas } from './orquestrador/tarefas-fila.js';
import { redigir } from './canais/guarda.js';
import { ligarTelegram } from './canais/telegram.js';
import { ligarHttp } from './canais/http.js';
import { ligarCli } from './canais/cli.js';
import { ligarSlack } from './canais/slack.js';
import { ligarWhatsApp } from './canais/whatsapp.js';
import { montarCronPadrao } from './tarefas/padrao.js';

const agora = (): number => Math.floor(Date.now() / 1000);

export function montarApp(): App {
  carregarEnv();
  const cfg = lerConfig();
  const log = (m: string): void => { logger.info(m); };
  mkdirSync(dirname(cfg.dbPath), { recursive: true });
  const db = abrirDb(cfg.dbPath);
  const n = aplicarMigrations(db, agora);
  if (n) log(`[db] ${n} migration(s) aplicada(s)`);

  const bus = new Bus();
  const fila = new FilaSqlite(db, agora);
  const cfgOllama = lerConfigOllama();
  const cfgPrecos = lerConfigPrecos();
  const cfgOrcamento = { ...lerConfigOrcamento(), mensal_usd: cfg.orcamentoMensalUsd };
  cfgOllama.piso_ram_gb = cfg.pisoRamGb;
  const ollama = new GestorOllama({ url: cfg.ollamaUrl, config: cfgOllama, log });
  const registro = new RegistroCusto(db, agora);
  const orcamento = new Orcamento(registro, cfgOrcamento);
  const gateway = new GatewayLLM({
    provedores: {
      ollama: new ProvedorOllama(),
      ...(cfg.openrouterKey ? { openrouter: new ProvedorOpenRouter(cfg.openrouterKey) } : {}),
      ...(cfg.anthropicKey ? { anthropic: new ProvedorAnthropic(cfg.anthropicKey) } : {}),
    },
    precos: cfgPrecos, registro, orcamento, ollama, log,
  });
  const cerebro = new Cerebro(db, agora);
  const ingestao = new Ingestao(db, cerebro, gateway, agora);
  const vault = new Vault(db, cfg.vaultPath, agora);
  const alertas = new Alertas(bus, cfg.chatPermitido ? { canal: 'telegram', chatId: cfg.chatPermitido } : null, log, agora);
  const cron = new Cron(db, fila, agora);
  const tarefas = new TarefasUsuario(db, agora);
  const heartbeat = new Heartbeat(db, fila, agora, TIMEOUT_AGENTE_MS / 1000);
  const sessoes = new Sessoes(db, agora);

  return {
    cfg, cfgOllama, cfgPrecos, cfgOrcamento, agora, iniciadoEm: agora(), db, bus, fila, ollama, gateway, registro, orcamento,
    cerebro, ingestao, vault, alertas, cron, tarefas, heartbeat, sessoes, log, canaisAtivos: [],
  };
}

function v2Ativo(): boolean {
  try { return execSync('systemctl --user is-active openpcbot', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'active'; } catch { return false; }
}

async function main(): Promise<void> {
  const app = montarApp();
  const { log, bus, fila, cfg } = app;
  log(`openpcbot v${cfg.versao} subindo · instância ${cfg.instancia} · db ${cfg.dbPath} · v2 em ${RAIZ_V2}`);

  // Orquestrador + tarefas da fila
  let orq!: Orquestrador;
  const tarefas = criarTarefas(app, () => orq);
  orq = new Orquestrador(app);
  orq.ligar();

  // Workers: um por lane, com o runner claude configurado para o v3.
  const runnerClaude = new ClaudeRunner({ binario: cfg.claudeBin, montarArgs: (ctx) => argumentosCli(cfg.claudeBin, ctx) });
  const promptDe = criarPromptDe({ sessoes: app.sessoes, registro: app.registro, claudeBin: cfg.claudeBin });
  const entregar = criarEntregador(app);
  const workers = FILAS.map((f) => new Worker(fila, {
    fila: f, dono: cfg.instancia, concorrencia: CONCORRENCIAS[f], leaseSegundos: 120,
    tarefas, runners: { claude: runnerClaude }, promptDe, log,
    aoTerminar: entregar,
    redigir: (t) => redigir(t).texto,
    guardarSaidaBruta: (job, bruto) => { try { const p = resolve(RAIZ, 'store/saidas'); mkdirSync(p, { recursive: true }); const arq = resolve(p, `job-${job.id}.txt`); writeFileSync(arq, bruto); return arq; } catch { return undefined; } },
  }, agora));

  let encerrando = false;
  const lacos = workers.map(async (w) => {
    while (!encerrando) {
      let pegou = false;
      try { pegou = await w.passo(); } catch (e) { log(`[worker ${w['opts'].fila}] passo falhou: ${(e as Error).message}`); }
      if (!pegou) await new Promise((r) => setTimeout(r, 1000));
    }
  });
  const batidas = setInterval(() => { for (const w of workers) void w.bater(); }, 30_000);

  // Canais
  const tg = await ligarTelegram({ token: cfg.telegramToken, chatsResponder: cfg.chatsResponder, chatsObservar: cfg.chatsObservar, bus, log, agora });
  if (tg) app.canaisAtivos.push('telegram');
  const http = ligarHttp(app);
  app.canaisAtivos.push('http');
  let desligarCli: (() => void) | null = null;
  if (process.stdin.isTTY || process.argv.includes('--cli')) { desligarCli = ligarCli(bus, agora); app.canaisAtivos.push('cli'); }
  const slackOff = cfg.slackAtivo ? ligarSlack({ token: process.env.SLACK_USER_TOKEN, canais: (process.env.SLACK_CHANNELS ?? '').split(',').filter(Boolean), bus, log, agora }) : null;
  if (slackOff) app.canaisAtivos.push('slack');
  const wa = ligarWhatsApp({ ativo: cfg.whatsappAtivo, v2Ativo, bus, log });
  log(`[whatsapp] ${wa.ligado ? 'ligado' : 'desligado'}: ${wa.motivo}`);

  // Timers: probe do Ollama, cron, heartbeat, orçamento
  montarCronPadrao(app);
  const probe = async (): Promise<void> => {
    const e = await app.ollama.probe();
    for (const a of app.ollama.avaliar(e)) app.alertas.disparar(a);
    if (e.online) app.alertas.resolver('ollama.fora');
    const o = app.orcamento.alertaPendente();
    if (o) app.alertas.disparar(o);
  };
  void probe();
  const tProbe = setInterval(() => { void probe(); }, app.cfgOllama.probe_segundos * 1000);
  const tCron = setInterval(() => { try { app.cron.tick(); } catch (e) { log(`[cron] ${(e as Error).message}`); } }, 30_000);
  const bater = (): void => { const r = app.heartbeat.bater(`emVoo=${workers.reduce((s, w) => s + w.emVoo, 0)}`); for (const a of r.alertas) app.alertas.disparar(a); };
  bater();
  const tHb = setInterval(bater, 30 * 60_000);
  const tNotif = setInterval(() => { for (const j of fila.pendentesDeNotificacao()) void entregar(j).then(() => fila.marcarNotificado(j.id)).catch(() => {}); }, 20_000);

  log(`openpcbot v3 online · canais: ${app.canaisAtivos.join(', ')} · porta ${cfg.porta}`);
  if (!tg) log('[telegram] aguardando TELEGRAM_BOT_TOKEN_V3 no .env do v3 (crie o bot no BotFather) — HTTP e CLI ativos');

  const desligar = async (sinal: string): Promise<void> => {
    if (encerrando) return;
    encerrando = true;
    log(`[main] ${sinal}: drenando…`);
    for (const t of [batidas, tProbe, tCron, tHb, tNotif]) clearInterval(t);
    desligarCli?.(); slackOff?.();
    await tg?.parar().catch(() => {});
    http.close();
    const prazo = new Promise<'prazo'>((r) => setTimeout(() => r('prazo'), 110_000));
    const fim = await Promise.race([Promise.all(workers.map((w) => w.drenar())).then(() => 'ok' as const), prazo]);
    if (fim === 'prazo') { log('[main] drain estourou 110 s — abortando o que sobrou'); await Promise.all(workers.map((w) => w.abortar())); }
    await Promise.race([Promise.all(lacos), new Promise((r) => setTimeout(r, 3000))]);
    app.db.close();
    log('[main] encerrado');
    process.exit(0);
  };
  process.on('SIGTERM', () => void desligar('SIGTERM'));
  process.on('SIGINT', () => void desligar('SIGINT'));
  process.on('unhandledRejection', (e) => log(`[main] unhandledRejection: ${(e as Error)?.message ?? e}`));
  process.on('uncaughtException', (e) => { log(`[main] uncaughtException: ${e.message}`); });
}

const ehMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (ehMain) main().catch((e) => { logger.error(e); process.exit(1); });
