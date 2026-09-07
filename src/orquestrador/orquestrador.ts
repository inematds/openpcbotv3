// Orquestrador: recebe `mensagem.recebida` do bus, classifica, planeja e
// despacha. Resposta direta = Ollama residente com contexto de memória;
// agente = job na lane `agente` (CLI). Modo de chegada: `collect` (junta
// mensagens seguidas em 2 s) — o padrão do plano §4.1.
import type { App } from '../app.js';
import type { MensagemRecebida } from '../bus/bus.js';
import { montarContextoMemoria } from '../cerebro/contexto.js';
import { classificarSetor } from '../cerebro/memoria.js';
import { redigir } from '../canais/guarda.js';
import { agentesCacheados } from './agentes.js';
import { identidade, type EntradaAgente } from './agente-cli.js';
import { executarComando } from './comandos.js';
import { rotear, type Decisao } from './roteador.js';
import { skillsCacheadas } from './skills.js';

const JANELA_COLLECT_MS = 2000;
const MAX_CONTEXTO_TURNOS = 8;

export class Orquestrador {
  private readonly pendentes = new Map<string, { msgs: MensagemRecebida[]; timer: NodeJS.Timeout }>();
  private readonly emCurso = new Set<string>();

  constructor(private readonly app: App) {}

  ligar(): () => void {
    return this.app.bus.on('mensagem.recebida', (m) => this.receber(m));
  }

  /** Comandos passam direto; texto livre entra na janela `collect` por chat. */
  receber(m: MensagemRecebida): void {
    if (m.texto.startsWith('/')) { void this.tratar(m); return; }
    const chave = `${m.canal}:${m.chatId}`;
    const p = this.pendentes.get(chave);
    if (p) { p.msgs.push(m); clearTimeout(p.timer); }
    const msgs = p?.msgs ?? [m];
    const timer = setTimeout(() => {
      this.pendentes.delete(chave);
      const juntas: MensagemRecebida = { ...msgs[0], texto: msgs.map((x) => x.texto).join('\n'), traceId: msgs[msgs.length - 1].traceId };
      void this.tratar(juntas);
    }, JANELA_COLLECT_MS);
    timer.unref?.();
    this.pendentes.set(chave, { msgs, timer });
  }

  private enviar(origem: MensagemRecebida, texto: string, formato: 'texto' | 'markdown' = 'texto'): void {
    const { texto: limpo, redigiu } = redigir(texto);
    if (redigiu) this.app.log(`[guarda] segredo redigido na resposta para ${origem.canal}:${origem.chatId}`);
    this.app.bus.responder(origem, limpo, formato);
  }

  async tratar(m: MensagemRecebida): Promise<void> {
    const app = this.app;
    const chave = `${m.canal}:${m.chatId}`;
    try {
      if (m.texto.startsWith('/')) {
        const r = await executarComando(app, m);
        if (r !== null) { this.enviar(m, r, 'markdown'); return; }
      }
      if (this.emCurso.has(chave)) {
        this.enviar(m, '⏳ Ainda estou na sua mensagem anterior — esta entrou na fila.');
        // `steer` leve: enfileira como job direto para depois, sem colidir.
        app.fila.enfileirar({ fila: 'chat', kind: 'function', tarefa: 'responder', input: JSON.stringify(m), chat_id: numOuNull(m.chatId), max_tentativas: 1 });
        return;
      }
      this.emCurso.add(chave);
      try { await this.responder(m); } finally { this.emCurso.delete(chave); }
    } catch (e) {
      app.log(`[orq] erro em ${chave}: ${(e as Error).message}`);
      this.enviar(m, `❌ ${(e as Error).message.slice(0, 300)}`);
    }
  }

  async responder(m: MensagemRecebida): Promise<void> {
    const app = this.app;
    const agentes = agentesCacheados();
    const decisao = await rotear(app.gateway, app.ollama.modeloDe('roteador'), m.texto, agentes, skillsCacheadas(), { chatId: m.chatId, traceId: m.traceId });
    app.log(`[orq] ${m.canal}:${m.chatId} → ${decisao.rota}${decisao.agente ? '/' + decisao.agente : ''} tier=${decisao.tier} (${decisao.motivo})`);

    const memoria = await montarContextoMemoria(
      { cerebro: app.cerebro, gateway: app.gateway, modeloEmbed: app.ollama.modeloDe('embed'), tetoTokens: 600 },
      m.chatId, m.texto, m.traceId,
    );

    if (decisao.rota === 'agente') { await this.despacharAgente(m, decisao, memoria); return; }

    const historico = app.cerebro.ultimosTurnos(m.chatId, MAX_CONTEXTO_TURNOS);
    const sistema = [identidade(), app.vault.ler('USER.md', 800), memoria].filter(Boolean).join('\n\n');
    const r = await app.gateway.chamar({
      tier: decisao.tier, agente: 'direto', chatId: m.chatId, traceId: m.traceId, motivoTier: decisao.tier !== 'local' ? decisao.motivo : undefined,
      temperatura: 0.4, maxTokens: 1200, timeoutMs: 180_000, keepAlive: app.ollama.papel('geral').keep_alive,
      mensagens: [{ role: 'system', content: sistema }, ...historico, { role: 'user', content: m.texto }],
    });
    const texto = r.texto.trim() || '(sem resposta)';
    this.enviar(m, texto);
    this.aprender(m, texto);
  }

  private async despacharAgente(m: MensagemRecebida, d: Decisao, memoria: string): Promise<void> {
    const app = this.app;
    const agente = d.agente ?? 'lead';
    const entrada: EntradaAgente = { chatId: m.chatId, canal: m.canal, texto: m.texto, agente, memoria, traceId: m.traceId };
    // Especialistas read-only em paralelo: cada um vira job próprio; o lead
    // recebe as saídas via `consultas` quando a tarefa `agente-lead` rodar.
    const consultas = (d.consultar ?? []).map((id) => app.fila.enfileirar({
      fila: 'agente', kind: 'agent', tarefa: `consulta:${id}`, input: JSON.stringify({ ...entrada, agente: id, somenteLeitura: true } satisfies EntradaAgente),
      chat_id: numOuNull(m.chatId), max_tentativas: 1, prioridade: 1,
    }).id);
    const job = app.fila.enfileirar({
      fila: consultas.length ? 'io' : 'agente',
      kind: consultas.length ? 'function' : 'agent',
      tarefa: consultas.length ? 'agente-lead' : `agente:${agente}`,
      input: JSON.stringify({ entrada, consultas, origem: m }),
      chat_id: numOuNull(m.chatId), max_tentativas: 1, flow_ref: `${m.canal}:${m.chatId}`,
    });
    const fila = app.fila.listar({ fila: 'agente', status: 'queued' }).length;
    this.enviar(m, `🧠 ${agente}${consultas.length ? ` (+${consultas.length} especialista${consultas.length > 1 ? 's' : ''})` : ''} — job #${job.id}${fila > 1 ? ` · ${fila - 1} na frente` : ''}. /status ${job.id} acompanha.`);
    app.cerebro.logarTurno(m.chatId, m.canal, 'user', m.texto, undefined, agente);
  }

  /** Grava turno + memória (sinais PT-BR) e propõe entrada no vault quando é fato durável. */
  aprender(m: MensagemRecebida, resposta: string, agente = 'direto'): void {
    const app = this.app;
    try {
      app.cerebro.logarTurno(m.chatId, m.canal, 'user', m.texto, undefined, agente);
      app.cerebro.logarTurno(m.chatId, m.canal, 'assistant', resposta, undefined, agente);
      if (m.texto.length <= 20 || m.texto.startsWith('/')) return;
      const setor = classificarSetor(m.texto);
      const mem = app.cerebro.salvar(m.chatId, m.texto, setor, 'v3');
      if (mem && setor === 'semantic' && m.texto.length <= 300 && /\b(meu nome|moro em|trabalho|prefiro|sempre|nunca|lembr)/i.test(m.texto)) {
        const p = app.vault.propor(m.chatId, /\b(meu|minha|eu sou|moro|trabalho)\b/i.test(m.texto) ? 'USER.md' : 'MEMORY.md', m.texto.slice(0, 300));
        app.bus.responder(m, `📝 Guardar no vault? "${p.texto.slice(0, 80)}${p.texto.length > 80 ? '…' : ''}" → /memoria aprovar ${p.id} ou /memoria descartar ${p.id}`);
      }
    } catch (e) {
      app.log(`[orq] aprender falhou: ${(e as Error).message}`);
    }
  }
}

export function numOuNull(chatId: string): number | null {
  return /^-?\d+$/.test(chatId) ? Number(chatId) : null;
}
