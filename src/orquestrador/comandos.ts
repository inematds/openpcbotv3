// Comandos de barra. Devolve texto (markdown simples) ou `null` quando o
// comando não existe (cai para conversa normal).
import type { App } from '../app.js';
import type { MensagemRecebida } from '../bus/bus.js';
import { FILAS } from '../fila/filas.js';
import { rssMb } from '../ollama/ram.js';
import { parsearQuando } from '../tarefas/usuario.js';
import { agentesCacheados } from './agentes.js';
import { skillsCacheadas } from './skills.js';

const AJUDA = `*openpcbot v3* — comandos
/status [id] — fila por lane, ou um job
/cancelar <id> · /prioridade <id> <n>
/usage — custo hoje/semana/mês por tier e agente
/health — Ollama, RAM, fila, heartbeat, canais
/ollama status|descarregar <modelo>
/memoria [lista|buscar <termo>|esquecer <id>|aprovar <id>|descartar <id>|propostas]
/tarefa add <quando?> <texto> · /tarefa lista · /tarefa feita <id>
/daily — resumo do dia (tarefas, custo, fila)
/fontes — chats observados e o que já virou memória (/fontes ingerir roda agora)
/cron lista|on <nome>|off <nome>
/agentes · /skills · /novo (limpa sessão e conversa) · /compress
/consolidar — roda a consolidação de memória agora`;

function fmtUsd(v: number): string { return `US$ ${v.toFixed(3)}`; }
function fmtDur(seg: number): string { return seg < 3600 ? `${Math.round(seg / 60)} min` : `${(seg / 3600).toFixed(1)} h`; }

export async function executarComando(app: App, m: MensagemRecebida): Promise<string | null> {
  const [cmdBruto, ...args] = m.texto.trim().split(/\s+/);
  const cmd = cmdBruto.replace(/^\//, '').replace(/@\w+$/, '').toLowerCase();
  const resto = args.join(' ');
  const chat = m.chatId;

  switch (cmd) {
    case 'start':
    case 'ajuda':
    case 'help':
      return AJUDA;

    case 'status': {
      if (args[0]) {
        const j = app.fila.obter(Number(args[0]));
        if (!j) return `Job #${args[0]} não existe.`;
        const dur = j.iniciado_em ? fmtDur((j.terminado_em ?? app.agora()) - j.iniciado_em) : '-';
        return `*Job #${j.id}* ${j.fila}/${j.tarefa}\nstatus: ${j.status} · tentativas ${j.tentativas}/${j.max_tentativas} · ${dur}` +
          (j.erro ? `\nerro: ${j.erro.slice(0, 300)}` : '') + (j.resultado && j.status === 'done' ? `\n\n${j.resultado.slice(0, 1500)}` : '');
      }
      const linhas = FILAS.map((f) => {
        const q = app.fila.listar({ fila: f, status: 'queued' }).length;
        const r = app.fila.listar({ fila: f, status: 'running' }).length;
        return `${f}: ${r} rodando · ${q} na fila`;
      });
      const recentes = app.fila.listar({ limite: 5 }).map((j) => `#${j.id} ${j.fila}/${j.tarefa} ${j.status}`);
      return `*Fila*\n${linhas.join('\n')}\n\n*Recentes*\n${recentes.join('\n') || '-'}`;
    }

    case 'cancelar': {
      const id = Number(args[0]);
      if (!id) return 'Uso: /cancelar <id>';
      return app.fila.cancelar(id) ? `Job #${id} cancelado.` : `Job #${id} não é cancelável (terminado ou inexistente).`;
    }

    case 'prioridade': {
      const id = Number(args[0]); const n = Number(args[1]);
      if (!id || Number.isNaN(n)) return 'Uso: /prioridade <id> <n>';
      return app.fila.priorizar(id, n) ? `Job #${id} com prioridade ${n}.` : `Job #${id} não está na fila (só queued muda de prioridade).`;
    }

    case 'usage': {
      const h = app.registro.hoje(), s = app.registro.semana(), me = app.registro.mes();
      const desdeMes = app.agora() - 30 * 86400;
      const tiers = app.registro.porTier(desdeMes).map((t) => `${t.tier}: ${t.chamadas} chamadas · ${t.tokensIn + t.tokensOut} tok · ${fmtUsd(t.custoUsd)}`);
      const ag = app.registro.porAgente(desdeMes).slice(0, 6).map((a) => `${a.agente}: ${fmtUsd(a.custoUsd)} (${a.chamadas})`);
      return `*Uso*\nhoje: ${h.chamadas} chamadas · ${fmtUsd(h.custoUsd)}\nsemana: ${s.chamadas} · ${fmtUsd(s.custoUsd)}\nmês: ${me.chamadas} · ${fmtUsd(me.custoUsd)}\n${app.orcamento.resumo()}\n\n*Por tier (30 d)*\n${tiers.join('\n') || '-'}\n\n*Por agente (30 d)*\n${ag.join('\n') || '-'}`;
    }

    case 'health': {
      const e = app.ollama.estado ?? (await app.ollama.probe());
      const hb = app.heartbeat.ultimo();
      const emVoo = app.fila.listar({ status: 'running' }).length;
      const pend = app.fila.listar({ status: 'queued' }).length;
      return `*Health*\n${app.ollama.resumo()}\nprocesso: ${rssMb()} MB RSS · up ${fmtDur(app.agora() - app.iniciadoEm)}\nfila: ${emVoo} em voo · ${pend} pendentes\nheartbeat: ${hb ? fmtDur(app.agora() - hb.ultimo_em) + ' atrás' : 'nunca'}\ncanais: ${app.canaisAtivos.join(', ') || 'nenhum'}\n${app.orcamento.resumo()}` + (e.online ? '' : `\n⚠️ ${e.erro}`);
    }

    case 'ollama': {
      const sub = args[0] ?? 'status';
      if (sub === 'status') { await app.ollama.probe(); return app.ollama.resumo(); }
      if (sub === 'descarregar' && args[1]) { const r = await app.ollama.descarregar(args[1], args[2] === 'forcar'); return r.ok ? `✅ ${args[1]} ${r.motivo}` : `⛔ ${r.motivo}`; }
      if (sub === 'preflight' && args[1]) { const p = await app.ollama.preflight(args[1]); return `${p.ok ? '✅' : '⛔'} ${args[1]}: ${p.motivo} (RAM livre ${p.ram.disponivelGb} GB)`; }
      return 'Uso: /ollama status | descarregar <modelo> [forcar] | preflight <modelo>';
    }

    case 'memoria':
    case 'memory': {
      const sub = args[0] ?? 'lista';
      if (sub === 'lista') {
        const c = app.cerebro.contagem(chat);
        const l = app.cerebro.listar(chat, 15).map((x) => `#${x.id} [${x.sector[0]}·${x.salience.toFixed(2)}] ${x.content.slice(0, 90)}`);
        return `*Memória* (${c.total} · ${c.semanticas} semânticas)\n${l.join('\n') || '-'}`;
      }
      if (sub === 'buscar') return app.cerebro.buscar(chat, args.slice(1).join(' '), 8).map((x) => `#${x.id} ${x.content.slice(0, 120)}`).join('\n') || 'Nada encontrado.';
      if (sub === 'esquecer') return app.cerebro.esquecer(Number(args[1])) ? `Memória #${args[1]} apagada.` : 'Não encontrei.';
      if (sub === 'aprovar') { const p = app.vault.aprovar(Number(args[1])); return p ? `✅ Gravado em ${p.arquivo}.` : 'Proposta não encontrada ou já decidida.'; }
      if (sub === 'descartar') return app.vault.descartar(Number(args[1])) ? 'Descartada.' : 'Proposta não encontrada.';
      if (sub === 'propostas') return app.vault.pendentes(chat).map((p) => `#${p.id} → ${p.arquivo}: ${p.texto.slice(0, 100)}`).join('\n') || 'Nenhuma proposta pendente.';
      if (sub === 'salvar' || sub === 'brain') { const t = args.slice(1).join(' '); if (!t) return 'Uso: /memoria salvar <texto>'; app.cerebro.salvar(chat, t, 'semantic', 'manual'); const p = app.vault.propor(chat, 'MEMORY.md', t); return `Guardado. Também no vault? /memoria aprovar ${p.id}`; }
      return 'Uso: /memoria lista|buscar <termo>|esquecer <id>|salvar <texto>|propostas|aprovar <id>|descartar <id>';
    }

    case 'tarefa':
    case 'tarefas': {
      const sub = args[0] ?? 'lista';
      if (sub === 'add' || sub === 'nova') {
        const { quando, resto: texto } = parsearQuando(args.slice(1).join(' '), app.agora());
        if (!texto) return 'Uso: /tarefa add [amanhã 9h|em 2h|15/09 14h] <texto>';
        const t = app.tarefas.adicionar(chat, texto, quando);
        return `Tarefa #${t.id} criada${quando ? ` · lembrete ${new Date(quando * 1000).toLocaleString('pt-BR')}` : ''}.`;
      }
      if (sub === 'feita' || sub === 'done') return app.tarefas.concluir(chat, Number(args[1])) ? `✅ #${args[1]} feita.` : 'Não encontrei essa tarefa pendente.';
      if (sub === 'remover') return app.tarefas.remover(chat, Number(args[1])) ? 'Removida.' : 'Não encontrei.';
      return `*Tarefas*\n${app.tarefas.formatar(app.tarefas.pendentes(chat))}`;
    }

    case 'daily': {
      const h = app.registro.hoje();
      const pend = app.tarefas.pendentes(chat);
      const ontem = app.agora() - 86400;
      const fila = app.fila.listar({ status: 'queued' }).length;
      const vault = app.vault.ler('MEMORY.md', 500);
      return `*Bom dia — ${new Date(app.agora() * 1000).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}*\n\n*Tarefas (${pend.length})*\n${app.tarefas.formatar(pend.slice(0, 8))}\nfeitas nas últimas 24 h: ${app.tarefas.feitasDesde(chat, ontem)}\n\n*Sistema*\ncusto hoje ${fmtUsd(h.custoUsd)} · ${fila} jobs pendentes\n${app.ollama.resumo()}` + (vault ? `\n\n*MEMORY.md*\n${vault}` : '');
    }

    case 'cron': {
      const sub = args[0] ?? 'lista';
      if (sub === 'on' && args[1]) return app.cron.ativar(args[1], true) ? `Cron ${args[1]} ligado.` : 'Não existe.';
      if (sub === 'off' && args[1]) return app.cron.ativar(args[1], false) ? `Cron ${args[1]} desligado.` : 'Não existe.';
      return `*Cron*\n${app.cron.listar().map((c) => `${c.ativo ? '🟢' : '⚪'} ${c.nome} · ${c.expressao} · ${c.tarefa} · próx ${c.proxima_em ? new Date(c.proxima_em * 1000).toLocaleString('pt-BR') : '-'}`).join('\n') || '-'}`;
    }

    case 'agentes':
    case 'agents':
      return `*Agentes*\n${agentesCacheados().map((a) => `${a.id} (${a.modelo}${a.somenteLeitura ? ', só leitura' : ''}) — ${a.descricao}`).join('\n')}`;

    case 'skills':
      return `*Skills*\n${skillsCacheadas().map((s) => `${s.rascunho ? '📝 ' : ''}${s.id} — ${s.description.slice(0, 80)}`).join('\n')}`;

    case 'novo':
    case 'newchat':
    case 'compress': {
      const s = app.sessoes.limpar(chat);
      const c = cmd === 'compress' ? 0 : app.cerebro.limparConversa(chat);
      return `Sessões limpas: ${s}${cmd === 'compress' ? ' (histórico mantido; próximo turno começa sessão nova)' : ` · histórico apagado: ${c} turnos`}.`;
    }

    case 'consolidar': {
      const j = app.fila.enfileirar({ fila: 'ollama', kind: 'function', tarefa: 'consolidacao', input: '{}', chat_id: /^-?\d+$/.test(chat) ? Number(chat) : null, max_tentativas: 1 });
      return `Consolidação enfileirada (job #${j.id}).`;
    }

    case 'fontes': {
      if (args[0] === 'ingerir') {
        const j = app.fila.enfileirar({ fila: 'ollama', kind: 'function', tarefa: 'ingestao', input: '{}', chat_id: /^-?\d+$/.test(chat) ? Number(chat) : null, max_tentativas: 1 });
        return `Ingestão enfileirada (job #${j.id}).`;
      }
      const est = app.ingestao.estado();
      const obs = app.cfg.chatsObservar.length ? app.cfg.chatsObservar.join(', ') : '(nenhum)';
      const linhas = est.map((e) => `${e.fonte}: ${e.itens} itens · último ${new Date(e.ultimo_em * 1000).toLocaleString('pt-BR')}`);
      return `*Fontes do cérebro*\nresponde em: ${app.cfg.chatsResponder.join(', ') || '(qualquer)'}\nobserva: ${obs}\n\n*Ingerido*\n${linhas.join('\n') || '-'}\n\n\`/fontes ingerir\` roda agora.`;
    }

    case 'chatid':
      return `chat_id: \`${chat}\` (${m.canal})`;

    case 'versao':
    case 'version':
      return `openpcbot v${app.cfg.versao} · instância ${app.cfg.instancia}`;

    default:
      return null;
  }
}
