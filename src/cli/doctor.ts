// `npm run doctor`: checa env, banco, Ollama, tokens, binários, RAM, v2, unit.
// Não muda nada. Sai com 1 se algo crítico falhar.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { carregarEnv, lerConfig, RAIZ, RAIZ_V2, validarTokenTelegram } from '../config/env.js';
import { lerConfigOllama } from '../config/yaml.js';
import { GestorOllama } from '../ollama/gestor.js';
import { lerRam } from '../ollama/ram.js';
import { probeOAuthSlack } from '../canais/slack.js';
import { contasConfiguradas } from '../cerebro/google.js';

type Item = { nome: string; ok: boolean; critico: boolean; detalhe: string };

function sh(cmd: string): string | null {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

export async function doctor(): Promise<Item[]> {
  carregarEnv();
  const cfg = lerConfig();
  const itens: Item[] = [];
  const add = (nome: string, ok: boolean, detalhe: string, critico = false): void => { itens.push({ nome, ok, critico, detalhe }); };

  add('.env v3', existsSync(resolve(RAIZ, '.env')), resolve(RAIZ, '.env'));
  add('.env v2 (keys compartilhadas)', existsSync(resolve(RAIZ_V2, '.env')), resolve(RAIZ_V2, '.env'), true);
  const tg = validarTokenTelegram(cfg.telegramToken);
  add('TELEGRAM_BOT_TOKEN_V3', tg.ok, tg.ok ? `bot id ${(cfg.telegramToken as string).split(':')[0]}` : (tg.motivo ?? ''));
  add('ALLOWED_CHAT_ID', !!cfg.chatPermitido, cfg.chatPermitido ? 'definido' : 'ausente — alertas no Telegram desligados');
  add('OPENROUTER_API_KEY', !!cfg.openrouterKey, cfg.openrouterKey ? 'presente' : 'ausente — tier barato/premium indisponível');
  add('ANTHROPIC_API_KEY', !!cfg.anthropicKey, cfg.anthropicKey ? 'presente' : 'ausente');

  const ram = lerRam();
  add('RAM', ram.disponivelGb >= 20, `${ram.disponivelGb} GB disponíveis de ${ram.totalGb} · swap ${ram.swapUsadoGb} GB · piso p/ carregar modelo grande: ${cfg.pisoRamGb} GB`, ram.disponivelGb < 10);

  const cfgOllama = lerConfigOllama();
  const g = new GestorOllama({ url: cfg.ollamaUrl, config: cfgOllama });
  try {
    const tags = await g.tags();
    add('Ollama', true, `${tags.length} modelos em ${cfg.ollamaUrl}`, true);
    for (const p of ['roteador', 'geral', 'embed'] as const) {
      const m = cfgOllama.papeis[p].modelo;
      add(`modelo ${p}`, tags.some((t) => GestorOllama.mesmoModelo(t, m)), m, p !== 'embed');
    }
    const ps = await g.carregados();
    add('Ollama carregados', true, ps.length ? ps.map((m) => `${m.name} ${Math.round(m.size / 1e9)} GB`).join(', ') : 'nenhum');
    const v2Model = process.env.OLLAMA_MODEL;
    add('mesmo modelo geral que o v2', !v2Model || GestorOllama.mesmoModelo(v2Model, cfgOllama.papeis.geral.modelo), `v2=${v2Model ?? '?'} v3=${cfgOllama.papeis.geral.modelo}`);
  } catch (e) {
    add('Ollama', false, (e as Error).message, true);
  }
  add('ollama serve paralelo', !(sh('pgrep -c -x ollama') && Number(sh('pgrep -c -x ollama')) > 1), `${sh('pgrep -c -x ollama') ?? 0} processo(s)`);

  add('claude CLI', !!sh(`${cfg.claudeBin} --version`), sh(`${cfg.claudeBin} --version`) ?? 'não encontrado', true);
  add('codex CLI', !!sh(`${cfg.codexBin} --version`), sh(`${cfg.codexBin} --version`) ?? 'não encontrado');
  add('age (backup cifrado)', !!sh('age --version'), sh('age --version') ?? 'ausente — backup cai para gzip');
  add('v2 ativo', sh('systemctl --user is-active openpcbot') === 'active', sh('systemctl --user is-active openpcbot') ?? '?');
  add('v3 unit', sh('systemctl --user is-active openpcbotv3') === 'active', sh('systemctl --user is-active openpcbotv3') ?? 'não instalado');
  const mm = sh('systemctl --user show openpcbotv3 -p MemoryMax --value');
  add('v3 MemoryMax', !!mm && mm !== 'infinity', mm ?? '-');
  add('porta livre/ocupada', true, `${cfg.porta}: ${(sh(`ss -ltn | grep -c ':${cfg.porta} ' || true`) ?? '0') === '0' ? 'livre' : 'em uso (v3 rodando?)'}`);
  add('banco v3', existsSync(cfg.dbPath), cfg.dbPath);
  add('banco v2 (importação)', existsSync(resolve(RAIZ_V2, 'store/openpcbot.db')), resolve(RAIZ_V2, 'store/openpcbot.db'));
  const contas = await contasConfiguradas();
  add('conectores Google (contas)', contas !== null && contas.length > 0,
      contas === null ? 'contas.json ausente — ver docs/CONECTORES.md' : contas.join(', ') || 'nenhuma');
  for (const servico of ['gmail', 'gcal'] as const) {
    for (const c of contas ?? []) {
      const tp = resolve(process.env.GOOGLE_CONFIG_DIR ?? resolve(process.env.HOME ?? '', '.config/google'), `token_${servico}_${c}.json`);
      add(`token ${servico}/${c}`, existsSync(tp), existsSync(tp) ? 'ok' : `rode: python3 conectores/google/${servico}.py --conta ${c} auth`);
    }
  }
  const slack = await probeOAuthSlack(process.env.SLACK_USER_TOKEN);
  add('Slack OAuth', slack.ok, slack.ok ? `user ${slack.user}` : (slack.erro ?? ''));
  for (const arq of ['ollama.yaml', 'precos.yaml', 'orcamento.yaml']) add(`config/${arq}`, existsSync(resolve(RAIZ, 'config', arq)), existsSync(resolve(RAIZ, 'config', arq)) ? 'ok' : 'ausente (defaults embutidos)');
  return itens;
}

const ehMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (ehMain) {
  doctor().then((itens) => {
    for (const i of itens) console.log(`${i.ok ? '✅' : i.critico ? '❌' : '⚠️ '} ${i.nome.padEnd(32)} ${i.detalhe}`);
    const falhas = itens.filter((i) => !i.ok && i.critico);
    console.log(falhas.length ? `\n${falhas.length} falha(s) crítica(s)` : '\nTudo crítico OK');
    process.exit(falhas.length ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
