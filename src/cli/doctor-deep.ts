// `npm run doctor -- --deep` (openclaw `doctor --deep`): probes sintéticos que
// EXERCITAM o sistema, não só checam config. Cada um é marcado como probe:
// a mensagem no Telegram começa com 🩺, a chamada ao Ollama vai num banco em
// memória (não entra em `chamadas_llm`), e o job `doctor-probe` não toca
// memória nem notifica ninguém (chat_id null). Roda por último no doctor.
import Database from 'better-sqlite3';

import { lerConfig } from '../config/env.js';
import { lerConfigOllama, lerConfigOrcamento, lerConfigPrecos } from '../config/yaml.js';
import { abrirDb } from '../db/abrir.js';
import { aplicarMigrations } from '../db/migrations.js';
import { FilaSqlite } from '../fila/store.js';
import { GatewayLLM } from '../custo/gateway.js';
import { RegistroCusto } from '../custo/registro.js';
import { Orcamento } from '../custo/orcamento.js';
import { GestorOllama } from '../ollama/gestor.js';
import { ProvedorOllama } from '../provedores/ollama.js';

export type ItemDeep = { nome: string; ok: boolean; critico: boolean; detalhe: string };

const agora = (): number => Math.floor(Date.now() / 1000);
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function doctorDeep(): Promise<ItemDeep[]> {
  const cfg = lerConfig();
  const itens: ItemDeep[] = [];
  const add = (nome: string, ok: boolean, detalhe: string, critico = false): void => { itens.push({ nome, ok, critico, detalhe }); };

  // 1. Serviço no ar: GET /health (loopback)
  let servico = false;
  try {
    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:${cfg.porta}/health`, { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { ok?: boolean; versao?: string };
    servico = r.ok;
    add('deep: serviço /health', r.ok, `${r.status} em ${Date.now() - t0} ms · v${j.versao ?? '?'}`, true);
  } catch (e) { add('deep: serviço /health', false, `porta ${cfg.porta}: ${(e as Error).message}`, true); }

  // 2. Telegram: sendMessage (nunca getUpdates: token em uso pelo serviço)
  if (cfg.telegramToken && cfg.chatPermitido) {
    try {
      const t0 = Date.now();
      const r = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.chatPermitido, text: `🩺 doctor --deep ${new Date().toLocaleTimeString('pt-BR')} (probe, ignore)` }),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await r.json()) as { ok?: boolean; description?: string };
      add('deep: Telegram sendMessage', !!j.ok, j.ok ? `entregue em ${Date.now() - t0} ms` : (j.description ?? `HTTP ${r.status}`));
    } catch (e) { add('deep: Telegram sendMessage', false, (e as Error).message); }
  } else add('deep: Telegram sendMessage', false, 'sem token ou ALLOWED_CHAT_ID');

  // 3. Ollama pelo gateway (regra: toda chamada de LLM passa por ele), em banco de memória
  try {
    const mem = new Database(':memory:');
    aplicarMigrations(mem, agora);
    const registro = new RegistroCusto(mem, agora);
    const cfgOllama = lerConfigOllama();
    const ollama = new GestorOllama({ url: cfg.ollamaUrl, config: cfgOllama });
    const gateway = new GatewayLLM({ provedores: { ollama: new ProvedorOllama() }, precos: lerConfigPrecos(), registro, orcamento: new Orcamento(registro, lerConfigOrcamento()), ollama });
    const t0 = Date.now();
    const r = await gateway.chamar({ tier: 'local', modelo: ollama.modeloDe('roteador'), agente: 'doctor', chatId: 'doctor', maxTokens: 8, temperatura: 0, timeoutMs: 60_000, mensagens: [{ role: 'user', content: 'Responda só: ok' }] });
    add('deep: Ollama via gateway', r.texto.trim().length > 0, `${ollama.modeloDe('roteador')} respondeu "${r.texto.trim().slice(0, 20)}" em ${Date.now() - t0} ms`, true);
  } catch (e) { add('deep: Ollama via gateway', false, (e as Error).message, true); }

  // 4. Fila: job sintético que o worker do serviço precisa pegar e concluir
  if (servico) {
    const db = abrirDb(cfg.dbPath);
    try {
      const fila = new FilaSqlite(db, agora);
      const j = fila.enfileirar({ fila: 'io', kind: 'function', tarefa: 'doctor-probe', input: '{}', chat_id: null, max_tentativas: 1, prioridade: 9 });
      const t0 = Date.now();
      let fim = fila.obter(j.id);
      while (fim && (fim.status === 'queued' || fim.status === 'running') && Date.now() - t0 < 30_000) { await dormir(500); fim = fila.obter(j.id); }
      const ok = fim?.status === 'done';
      if (!ok && fim && fim.status !== 'done') fila.cancelar(j.id);
      add('deep: fila (worker pega e conclui)', ok, ok ? `job #${j.id} done em ${Date.now() - t0} ms` : `job #${j.id} ficou ${fim?.status ?? '?'} após 30 s${fim?.erro ? `: ${fim.erro.slice(0, 120)}` : ' (serviço antigo sem a tarefa doctor-probe? reinstale)'}`, true);
    } finally { db.close(); }
  } else add('deep: fila (worker pega e conclui)', false, 'pulado: serviço fora do ar', true);

  return itens;
}
