import { comandoJev } from './jev.js';
// Comandos de barra. Devolve texto (markdown simples) ou `null` quando o
// comando não existe (cai para conversa normal).
import type { App } from '../app.js';
import type { MensagemRecebida } from '../bus/bus.js';
import { FILAS } from '../fila/filas.js';
import { rssMb } from '../ollama/ram.js';
import { parsearQuando } from '../tarefas/usuario.js';
import { agentesCacheados } from './agentes.js';
import { cancelarEmVoo, filtroDoAlvo, parsearAlvo } from './interruptores.js';
import { DESCRICAO, MODOS, gravarModo, lerModo, parsearModo } from './modo-fila.js';
import { formatarMedicao, medirContexto } from './contexto-cmd.js';
import { definirPersonalidade, lerPersonalidade, listarPersonalidades, personalidadeDoChat } from './personalidade.js';
import { skillsCacheadas } from './skills.js';

const AJUDA = `*openpcbot v3* — comandos
/status [id] — fila por lane, ou um job
/cancelar <id> · /prioridade <id> <n>
/usage — custo hoje/semana/mês por tier e agente
/jev [observar|off] — comparar com Jev sem mudar a rota
/health — Ollama, RAM, fila, heartbeat, canais
/ollama status|descarregar <modelo>
/memoria [lista|buscar <termo>|esquecer <id>|aprovar <id>|descartar <id>|propostas]
/tarefa add <quando?> <texto> · /tarefa lista · /tarefa feita <id>
/daily — resumo do dia (tarefas, custo, fila)
/fontes — chats observados e o que já virou memória (/fontes ingerir [gmail|agenda])
/cron lista|on <nome>|off <nome>
/agentes · /skills · /novo (limpa sessão e conversa) · /compress
/consolidar — roda a consolidação de memória agora

*Controle da conversa*
/parar [tudo|agentes|<agente>] [motivo] — interruptor persistente; cancela o que está em voo; sozinho lista
/retomar [alvo] — libera (sem alvo: todos)
/fila [collect|followup|steer|interrupt] — mensagem que chega com outra em curso: junta 2 s | enfileira | substitui a fila | cancela tudo e responde à nova
/personality [nome|off] — persona deste chat (personalidades/*.md, somada a IDENTIDADE.md); trocar reinicia sessões
/context [detail] [texto] — tokens por camada do prompt (direto e agente), sem mexer na memória
/ajuda <comando> — detalhe de um comando`;

const DETALHE: Record<string, string> = {
  jev: '/jev observar ativa comparação neste chat pelo OpenRouter. /jev mostra a última sugestão e custo; /jev off desliga. Não altera rotas nem executa skills. Critérios e mensagem atual são enviados ao provedor, sem memória/histórico. Limiar didático não comprova calibração.',
  parar: `*/parar [tudo|agentes|<agente>] [motivo]*
tudo: nenhuma resposta nem agente (comandos e manutenção no Ollama seguem).
agentes: nenhum claude -p; resposta direta no Ollama continua.
<agente>: só aquele (ex.: /parar ops quebrou).
Cancela o que está em voo nas lanes chat/agente/io; processo em execução morre na batida seguinte (até 30 s). Job enfileirado antes falha ao ser pego, sem gastar token. Persiste no banco; /retomar libera.`,
  retomar: `*/retomar [alvo]*\nDesliga um interruptor (tudo, agentes ou <agente>). Sem alvo desliga todos.`,
  fila: `*/fila [modo]* (por chat, padrão collect)
collect: junta mensagens seguidas por 2 s e responde uma vez.
followup: sem janela; ocupado → entra na fila.
steer: ocupado → substitui o que estava na fila deste chat, prioridade alta. NÃO injeta no agente em execução (limite do claude -p).
interrupt: cancela fila e agentes deste chat e responde à nova agora. Resposta direta já em voo termina e é descartada.`,
  personality: `*/personality [nome|off]*
Camadas somadas: IDENTIDADE.md (base) + agents/<id>/SOUL.md (agente) + personalidades/<nome>.md (este chat).
Trocar apaga as sessões retomadas do chat para a voz nova valer. Sem argumento: lista as disponíveis.`,
  context: `*/context [detail] [texto]*
Mede tokens por camada do prompt (identidade, persona, USER.md, memória+insights, histórico, skills, regras, mensagem) para resposta direta e agente. detail lista os itens. Sem texto usa sua última mensagem. Não toca saliência.`,
};


function fmtUsd(v: number): string { return `US$ ${v.toFixed(3)}`; }
function fmtDur(seg: number): string { return seg < 3600 ? `${Math.round(seg / 60)} min` : `${(seg / 3600).toFixed(1)} h`; }

export async function executarComando(app: App, m: MensagemRecebida): Promise<string | null> {
  const [cmdBruto, ...args] = m.texto.trim().split(/\s+/);
  const cmd = cmdBruto.replace(/^\//, '').replace(/@\w+$/, '').toLowerCase();
  const resto = args.join(' ');
  const chat = m.chatId;

  switch (cmd) {
    case 'jev': return comandoJev(app, chat, resto);
    case 'start':
    case 'ajuda':
    case 'help': {
      const d = args[0]?.replace(/^\//, '').toLowerCase();
      if (d) return DETALHE[d === 'personalidade' ? 'personality' : d === 'contexto' ? 'context' : d === 'queue' ? 'fila' : d] ?? `Sem detalhe para /${d}. Comandos: ${Object.keys(DETALHE).map((k) => '/' + k).join(' ')}`;
      return AJUDA;
    }

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
        // `ingerir` = chats observados; `ingerir gmail|agenda` = conectores Google.
        const alvo = args[1] === 'gmail' ? 'ingestao:gmail' : args[1] === 'agenda' ? 'ingestao:agenda' : 'ingestao';
        const j = app.fila.enfileirar({ fila: 'ollama', kind: 'function', tarefa: alvo, input: '{}', chat_id: /^-?\d+$/.test(chat) ? Number(chat) : null, max_tentativas: 1 });
        return `Ingestão enfileirada (job #${j.id}).`;
      }
      const est = app.ingestao.estado();
      const obs = app.cfg.chatsObservar.length ? app.cfg.chatsObservar.join(', ') : '(nenhum)';
      const linhas = est.map((e) => `${e.fonte}: ${e.itens} itens · último ${new Date(e.ultimo_em * 1000).toLocaleString('pt-BR')}`);
      return `*Fontes do cérebro*\nresponde em: ${app.cfg.chatsResponder.join(', ') || '(qualquer)'}\nobserva: ${obs}\n\n*Ingerido*\n${linhas.join('\n') || '-'}\n\n\`/fontes ingerir\` roda agora (\`gmail\`/\`agenda\` para os conectores).`;
    }

    case 'parar':
    case 'stop': {
      const ids = agentesCacheados().map((a) => a.id);
      if (!args[0]) {
        const l = app.interruptores.listar();
        return l.length ? `*Interruptores ligados*\n${l.map((i) => `⛔ ${i.alvo}: ${i.motivo}`).join('\n')}\n\n/retomar <alvo> libera.` : 'Nenhum interruptor ligado. Uso: /parar [tudo|agentes|<agente>] [motivo]';
      }
      const alvo = parsearAlvo(args[0], ids);
      if (!alvo) return `Alvo desconhecido. Use tudo, agentes ou um de: ${ids.join(', ')}`;
      app.interruptores.ligar(alvo, args.slice(1).join(' '));
      const n = cancelarEmVoo(app.fila, filtroDoAlvo(alvo));
      return `⛔ ${alvo} parado.${n ? ` ${n} job(s) cancelado(s); processo em execução morre na próxima batida (até 30 s).` : ''} /retomar ${alvo === 'tudo' ? '' : alvo} libera.`;
    }

    case 'retomar':
    case 'resume': {
      if (!args[0] || args[0] === 'tudo') { const n = app.interruptores.desligarTodos(); return n ? `✅ ${n} interruptor(es) desligado(s).` : 'Nenhum interruptor ligado.'; }
      const alvo = parsearAlvo(args[0], agentesCacheados().map((a) => a.id));
      if (!alvo) return 'Alvo desconhecido.';
      return app.interruptores.desligar(alvo) ? `✅ ${alvo} liberado.` : `${alvo} não estava parado.`;
    }

    case 'fila':
    case 'queue': {
      if (!args[0]) {
        const atual = lerModo(app.prefs, chat);
        return `*Modo de fila deste chat: ${atual}*\n${MODOS.map((x) => `${x === atual ? '▶️' : '▫️'} ${x}: ${DESCRICAO[x]}`).join('\n')}\n\n/fila <modo> muda.`;
      }
      const modo = parsearModo(args[0]);
      if (!modo) return `Modo desconhecido. Use: ${MODOS.join(', ')}`;
      gravarModo(app.prefs, chat, modo);
      return `Modo de fila: ${modo}. ${DESCRICAO[modo]}.`;
    }

    case 'personality':
    case 'personalidade': {
      const nomes = listarPersonalidades();
      if (!args[0] || args[0] === 'lista') {
        const atual = personalidadeDoChat(app.prefs, chat);
        return `*Personalidade deste chat: ${atual ?? 'padrão (IDENTIDADE.md)'}*\ndisponíveis: ${nomes.join(', ') || 'nenhuma em personalidades/'}\n\n/personality <nome> liga · /personality off volta ao padrão.`;
      }
      if (args[0] === 'off' || args[0] === 'padrao') { definirPersonalidade(app.prefs, chat, null); app.sessoes.limpar(chat); return 'Personalidade padrão. Sessões de agente reiniciadas.'; }
      const t = lerPersonalidade(args[0]);
      if (!t) return `Não existe. Disponíveis: ${nomes.join(', ') || 'nenhuma'}`;
      definirPersonalidade(app.prefs, chat, args[0]);
      app.sessoes.limpar(chat);
      return `Personalidade: ${args[0]}. Sessões de agente reiniciadas para a voz nova valer.\n\n${t.split('\n').slice(0, 4).join('\n')}`;
    }

    case 'context':
    case 'contexto': {
      const detalhe = args[0] === 'detail' || args[0] === 'detalhe';
      const texto = (detalhe ? args.slice(1) : args).join(' ');
      return formatarMedicao(await medirContexto(app, chat, texto), detalhe);
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
