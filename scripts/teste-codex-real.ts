// Teste manual pela assinatura: banco isolado, entrega no bus HTTP, sem publicar.
// Executar: timeout 300s node_modules/.bin/tsx scripts/teste-codex-real.ts
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { aplicarMigrations } from '../src/db/migrations.js';
import { FilaSqlite } from '../src/fila/store.js';
import { Worker } from '../src/fila/worker.js';
import { CodexRunner } from '../src/fila/runner-codex.js';
import { criarPromptDe, Sessoes } from '../src/orquestrador/agente-cli.js';
import { criarEntregador } from '../src/orquestrador/tarefas-fila.js';
import { RegistroCusto } from '../src/custo/registro.js';
import { GatewayLLM } from '../src/custo/gateway.js';
import { Orcamento } from '../src/custo/orcamento.js';
import { OLLAMA_DEFAULT, PRECOS_DEFAULT } from '../src/config/yaml.js';
import { perfilAgente } from '../src/config/agentes-ia.js';
import { Prefs } from '../src/config/prefs.js';
import { GestorOllama } from '../src/ollama/gestor.js';
import { Cerebro } from '../src/cerebro/memoria.js';
import { Bus } from '../src/bus/bus.js';
import type { App } from '../src/app.js';

const pasta = resolve(homedir(), 'projetos/output/openpcbotv3-codex', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(pasta, { recursive: true });
const agora = () => Math.floor(Date.now() / 1000);
const db = new Database(resolve(pasta, 'teste.db'));
aplicarMigrations(db, agora);
const fila = new FilaSqlite(db, agora), sessoes = new Sessoes(db, agora), prefs = new Prefs(db, agora);
const registro = new RegistroCusto(db, agora), cerebro = new Cerebro(db, agora), bus = new Bus();
const gateway = new GatewayLLM({
  registro, provedores: {}, precos: PRECOS_DEFAULT,
  orcamento: new Orcamento(registro, { mensal_usd: 0, aviso_pct: 70, trava_pct: 100 }),
  ollama: new GestorOllama({ url: 'http://127.0.0.1:11434', config: OLLAMA_DEFAULT }),
});
const respostas: string[] = [];
bus.on('mensagem.enviar', m => { assert.equal(m.canal, 'http'); respostas.push(m.texto); });
const entregar = criarEntregador({ db, cerebro, bus } as App);
const p = perfilAgente(prefs, 'teste-codex', { modelo: 'sonnet', esforco: 'medium' });
assert.equal(p.motor, 'codex');
const promptDe = criarPromptDe({ sessoes, claudeBin: 'claude' });
const worker = new Worker(fila, {
  fila: 'agente', dono: 'teste-isolado', concorrencia: 1, leaseSegundos: 240, tarefas: {},
  runners: { codex: gateway.runnerAssinatura(new CodexRunner(resolve(homedir(), '.npm-global/bin/codex'), '4G')) },
  promptDe: async job => ({ ...await promptDe(job), timeoutMs: 120_000 }), aoTerminar: entregar,
}, agora);
const codigo = randomUUID();
const arquivo = resolve(pasta, 'prova.txt');
async function rodar(texto: string) {
  const job = fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'agente:lead', perfil: p, max_tentativas: 1,
    input: JSON.stringify({ chatId: 'teste-codex', canal: 'http', agente: 'lead', texto }), flow_ref: 'http:teste-codex' });
  await worker.passo();
  const fim = fila.obter(job.id)!;
  assert.equal(fim.status, 'done', fim.erro ?? 'job não concluiu');
  return fim;
}
try {
  const primeiro = await rodar(`Teste técnico isolado, sem outras ações. Use uma ferramenta de shell para gravar ${arquivo} com o texto exato CODEx-OK. Não publique, não use rede, não abra outros projetos nem leia credenciais. Memorize somente nesta conversa o código ${codigo}; não grave esse código em arquivo. Responda apenas arquivo criado.`);
  assert.equal(readFileSync(arquivo, 'utf8').trim(), 'CODEx-OK');
  assert.ok(primeiro.sessao);
  const segundo = await rodar('Teste técnico: sem ferramentas, responda somente o código que pedi para memorizar na mensagem anterior.');
  assert.equal(segundo.sessao, primeiro.sessao, 'retomada precisa preservar thread');
  assert.equal(segundo.resultado?.trim(), codigo, 'retomada precisa recuperar conteúdo não reenviado no prompt');
  assert.equal(respostas.length, 2);
  assert.ok(respostas[1].includes(codigo));
  const uso = registro.hoje();
  assert.equal(uso.chamadas, 2);
  assert.ok(uso.tokensIn > 0);
  assert.equal(registro.mesPago().custoUsd, 0);
  writeFileSync(resolve(pasta, 'resultado.json'), JSON.stringify({ ok: true, modelo: p.modelo, esforco: p.esforco,
    provas: ['ferramenta shell gravou arquivo', 'sessão retomada recuperou código não reenviado', 'duas entregas no bus HTTP', 'duas chamadas registradas pelo gateway', 'nenhuma API de modelo habilitada'],
    jobs: [primeiro.id, segundo.id], tokensIn: uso.tokensIn, tokensOut: uso.tokensOut, em: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ ok: true, pasta, modelo: p.modelo, chamadas: uso.chamadas }));
} finally { db.close(); }
