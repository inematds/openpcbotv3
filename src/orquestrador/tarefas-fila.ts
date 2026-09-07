// Tarefas `kind=function` conhecidas pela fila: responder (chat enfileirado),
// agente-lead (junta consultas dos especialistas), consolidacao, indexar,
// cron:* (daily, lembretes, backup) e aoTerminar (entrega do resultado).
import { resolve } from 'node:path';

import type { App } from '../app.js';
import type { MensagemRecebida } from '../bus/bus.js';
import type { Tarefa } from '../fila/worker.js';
import type { Job } from '../fila/types.js';
import { consolidar } from '../cerebro/consolidacao.js';
import { indexarPendentes } from '../cerebro/contexto.js';
import { redigir } from '../canais/guarda.js';
import { backupSqlite } from '../db/backup.js';
import { RAIZ } from '../config/env.js';
import { executarComando } from './comandos.js';
import type { EntradaAgente } from './agente-cli.js';
import type { Orquestrador } from './orquestrador.js';

export function criarTarefas(app: App, orq: () => Orquestrador): Record<string, Tarefa> {
  return {
    /** Mensagem que chegou durante outra em curso: responde agora. */
    responder: async ({ job }) => {
      const m = JSON.parse(job.input) as MensagemRecebida;
      await orq().responder(m);
      return 'ok';
    },

    /** Espera as consultas dos especialistas e então enfileira o lead com o contexto delas. */
    'agente-lead': async ({ job, fila, aindaNao }) => {
      const { entrada, consultas } = JSON.parse(job.input) as { entrada: EntradaAgente; consultas: number[] };
      const jobs = consultas.map((id) => fila.obter(id)).filter((j): j is Job => !!j);
      const abertos = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
      if (abertos.length) aindaNao(`${abertos.length} consulta(s) em andamento`, 20);
      const ctx: Record<string, string> = {};
      for (const j of jobs) ctx[j.tarefa.replace(/^consulta:/, '')] = j.status === 'done' ? (j.resultado ?? '') : `(falhou: ${j.erro ?? '?'})`;
      const lead = fila.enfileirar({
        fila: 'agente', kind: 'agent', tarefa: `agente:${entrada.agente}`,
        input: JSON.stringify({ ...entrada, consultas: ctx } satisfies EntradaAgente),
        chat_id: job.chat_id, max_tentativas: 1, flow_ref: job.flow_ref,
      });
      return `lead enfileirado: #${lead.id}`;
    },

    consolidacao: async () => {
      const r = await consolidar(app.cerebro, app.gateway, { modelo: app.ollama.modeloDe('geral'), agora: app.agora });
      return `chats ${r.chats} · duplicatas ${r.duplicatas} · contradições ${r.contradicoes} · insights ${r.insights}${r.erro ? ` · erro: ${r.erro}` : ''}`;
    },

    indexar: async () => {
      const n = await indexarPendentes({ cerebro: app.cerebro, gateway: app.gateway, modeloEmbed: app.ollama.modeloDe('embed') });
      return `${n} memórias indexadas`;
    },

    decair: async () => {
      const r = app.cerebro.decair();
      const p = app.cerebro.podarConversa(500);
      return `decaídas ${r.decaidas} · removidas ${r.removidas} · conversa podada ${p}`;
    },

    backup: async () => {
      const dest = await backupSqlite(app.db, resolve(RAIZ, 'store/backups'), app.agora);
      return `backup em ${dest}`;
    },

    /** Cron genérico que roda um comando de barra e entrega no chat. */
    'cron:comando': async ({ job }) => {
      const { chatId, canal, input } = JSON.parse(job.input) as { chatId: string | null; canal: string; input: string };
      if (!chatId) return 'sem chat';
      const m: MensagemRecebida = { canal: canal as MensagemRecebida['canal'], chatId, texto: input, traceId: `cron-${job.id}`, recebidaEm: app.agora() };
      const r = await executarComando(app, m);
      if (r) app.bus.emit('mensagem.enviar', { canal: m.canal, chatId, texto: r, formato: 'markdown' });
      return r ?? 'comando desconhecido';
    },

    /** Cron que manda uma mensagem ao orquestrador como se fosse o usuário (sessão isolada). */
    'cron:mensagem': async ({ job }) => {
      const { chatId, canal, input } = JSON.parse(job.input) as { chatId: string | null; canal: string; input: string };
      if (!chatId) return 'sem chat';
      await orq().responder({ canal: canal as MensagemRecebida['canal'], chatId, texto: input, traceId: `cron-${job.id}`, recebidaEm: app.agora() });
      return 'ok';
    },

    lembretes: async () => {
      const l = app.tarefas.lembretesVencidos();
      for (const t of l) {
        const canal = app.canaisAtivos.includes('telegram') ? 'telegram' : 'cli';
        app.bus.emit('mensagem.enviar', { canal, chatId: t.chat_id, texto: `⏰ Lembrete: ${t.texto} (#${t.id}) — /tarefa feita ${t.id}` });
      }
      return `${l.length} lembrete(s)`;
    },
  };
}

/** `aoTerminar` do worker: entrega resultado/erro de job de agente no chat de origem. */
export function criarEntregador(app: App) {
  return async (job: Job): Promise<void> => {
    if (job.chat_id === null) return;
    if (!job.tarefa.startsWith('agente:')) return; // consultas e funções internas não avisam
    const entrada = JSON.parse(job.input) as EntradaAgente;
    const canal = (entrada.canal ?? 'telegram') as MensagemRecebida['canal'];
    let texto: string;
    if (job.status === 'done') {
      texto = (job.resultado ?? '').trim() || '(agente terminou sem texto)';
      app.cerebro.logarTurno(entrada.chatId, canal, 'assistant', texto, undefined, entrada.agente);
    } else {
      texto = `❌ Job #${job.id} (${entrada.agente}) falhou: ${(job.erro ?? '?').slice(0, 400)}`;
    }
    const { texto: limpo } = redigir(texto);
    app.bus.emit('mensagem.enviar', { canal, chatId: entrada.chatId, texto: limpo.slice(0, 3900), traceId: entrada.traceId, formato: 'markdown' });
  };
}
