// Teste REAL do worker instalado: job em chat HTTP isolado, sem Telegram/WhatsApp.
// Não carrega .env nem lê credenciais. Não roda se houver agente aberto.
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { FilaSqlite } from '../src/fila/store.js';
import { Prefs } from '../src/config/prefs.js';
import { perfilAgente } from '../src/config/agentes-ia.js';
const agora = () => Math.floor(Date.now() / 1000);
const db = new Database(resolve('store/openpcbotv3.db'));
const pasta = resolve(homedir(), 'projetos/output/openpcbotv3-codex', `servico-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(pasta, { recursive: true });
try {
  assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE kind='agent' AND status IN ('queued','running')").get() as { n: number }).n, 0, 'aguarde os agentes existentes');
  const fila = new FilaSqlite(db, agora), prefs = new Prefs(db, agora);
  const chatId = `validacao-codex-${Date.now()}`;
  const perfil = perfilAgente(prefs, chatId, { modelo: 'sonnet', esforco: 'medium' });
  assert.equal(perfil.motor, 'codex');
  const { id } = fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'agente:lead', perfil,
    max_tentativas: 1, flow_ref: `http:${chatId}`,
    input: JSON.stringify({ chatId, canal: 'http', agente: 'lead', texto: 'Teste técnico isolado do worker instalado. Sem ferramentas, sem publicar ou enviar mensagens externas, responda exatamente: CODEX_V3_OPERACIONAL' }) });
  console.log(JSON.stringify({ job: id, estado: 'enfileirado', pasta }));
  const prazo = Date.now() + 150_000;
  let fim = fila.obter(id)!;
  while (Date.now() < prazo && ['queued', 'running'].includes(fim.status)) {
    await new Promise(r => setTimeout(r, 1000)); fim = fila.obter(id)!;
  }
  assert.equal(fim.status, 'done', fim.erro ?? 'prazo excedido');
  assert.equal(fim.resultado?.trim(), 'CODEX_V3_OPERACIONAL');
  assert.ok(fim.sessao);
  const uso = db.prepare('SELECT provedor, modelo, tokens_in, tokens_out, ok FROM chamadas_llm WHERE job_id = ?').get(id) as Record<string, unknown>;
  assert.equal(uso.provedor, 'codex-cli'); assert.equal(uso.ok, 1);
  const evidencia = { ok: true, versao: '3.36.17', job: id, status: fim.status, perfil, uso, notificado: fim.notificado_em !== null,
    saida: fim.resultado, canal: 'http isolado', em: new Date().toISOString() };
  writeFileSync(resolve(pasta, 'resultado.json'), JSON.stringify(evidencia, null, 2));
  console.log(JSON.stringify(evidencia));
} finally { db.close(); }
