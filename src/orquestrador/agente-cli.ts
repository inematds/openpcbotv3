// Execução de agente por CLI (`claude -p`) na lane `agente` (decisão 1 do
// plano: CLI na fila). Monta o prompt em camadas (identidade, memória, skills
// só-metadata, contexto dos especialistas), interpreta a saída JSON (resultado
// + session_id + custo real) e registra o custo em `chamadas_llm`.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

import type { ContextoExecucao, Execucao, Runner } from '../fila/runner.js';
import type { Job } from '../fila/types.js';
import type { RegistroCusto } from '../custo/registro.js';
import { RAIZ } from '../config/env.js';
import { blocoSkills, skillsCacheadas } from './skills.js';
import { agentesCacheados, type Agente } from './agentes.js';
import { CACHE_SEG, blocoRetomada } from './resumo-sessao.js';

export interface EntradaAgente {
  chatId: string;
  canal: string;
  texto: string;
  agente: string;
  memoria?: string;
  /** Bloco `[Personalidade: x]` do chat, já lido (o worker não tem prefs). */
  personalidade?: string;
  /** Saídas dos especialistas read-only (id → texto), já coletadas. */
  consultas?: Record<string, string>;
  traceId?: string;
  /** Se true, o agente não pode escrever (especialista). */
  somenteLeitura?: boolean;
  /** `/job N texto`: retoma a sessão DO JOB N, não a do chat (3.8.5). */
  continuaJob?: number;
}

export interface SaidaCli {
  texto: string;
  sessionId?: string;
  custoUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

/** Conversa, consulta, pergunta: 20 min bastam e seguram pouco a fila (concorrência 1). */
export const TIMEOUT_CONVERSA_MS = 20 * 60_000;
/**
 * Produção (vídeo, render, publicação, curso): refazer um reel passa de 20 min —
 * em 11/10/2026 o job 54178 foi morto no meio, com o reel já baixado.
 */
export const TIMEOUT_PRODUCAO_MS = 3 * 3600_000;
/** Maior teto possível; o heartbeat só chama de zumbi o que passar de 2× isto. */
export const TIMEOUT_AGENTE_MS = TIMEOUT_PRODUCAO_MS;
/** Sessão retomada que não escreve nada no transcript neste prazo é dada como travada. */
export const VIGIA_RETOMADA_MS = 10 * 60_000;

const PRODUCAO_RE = /(?<![\p{L}\p{N}])(v[íi]deos?|reels?|shorts?|render\w*|refa[zç]\w*|dubl\w*|legend\w*|publi(?:c|qu)\w*|post\w*|curso|guia|thumbs?|capa|avatar|heygen|explicavideo|docflow|anima\w*|traduz\w*|baix\w*|9\s*(?:por|x|:|\/)\s*16|16\s*(?:por|x|:|\/)\s*9)(?![\p{L}\p{N}])/iu;

/** Teto de parede do pedido: produção ganha horas, o resto fica nos 20 min. */
export function timeoutDoPedido(texto: string): number {
  return PRODUCAO_RE.test(texto) ? TIMEOUT_PRODUCAO_MS : TIMEOUT_CONVERSA_MS;
}

/** Transcript que o `claude` grava para a sessão (`~/.claude/projects/<cwd com - no lugar de não-alfanum>/<id>.jsonl`). */
export function transcriptDe(cwd: string, sessao: string, home = process.env.HOME ?? ''): string {
  return resolve(home, '.claude/projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessao}.jsonl`);
}

export function identidade(): string {
  const p = resolve(RAIZ, 'IDENTIDADE.md');
  if (existsSync(p)) return readFileSync(p, 'utf8').slice(0, 4000);
  return 'Você é o openpcbot v3, assistente pessoal do Nei (PT-BR). Seja direto, prático e honesto sobre o que não conseguiu fazer.';
}

export function montarPrompt(e: EntradaAgente, agente: Agente, quadro?: string, retomada?: string): string {
  const partes: string[] = [identidade()];
  if (agente.soul) partes.push(`[Persona do agente ${agente.nome}]\n${agente.soul}`);
  if (e.personalidade) partes.push(e.personalidade);
  if (agente.prompt) partes.push(`[Agente ${agente.nome}]\n${agente.prompt}`);
  if (e.somenteLeitura || agente.somenteLeitura) partes.push('MODO SOMENTE LEITURA: não crie, edite ou apague arquivos, não faça commit. Só leia e responda.');
  if (quadro) partes.push(quadro);
  if (retomada) partes.push(retomada);
  if (e.memoria) partes.push(e.memoria);
  if (e.consultas && Object.keys(e.consultas).length) {
    partes.push('[Contexto dos especialistas]\n' + Object.entries(e.consultas).map(([id, t]) => `## ${id}\n${t.slice(0, 3000)}`).join('\n\n'));
  }
  partes.push(blocoSkills(skillsCacheadas()).join('\n'));
  partes.push('Regras: avatar do Nei = SEMPRE pelo estúdio HeyGen (assinatura), sem pedir confirmação (regra do Nei, 12/11/2026); vídeo explicativo/de projeto = explicavideos v2 com esse avatar; a skill video-explicativo (sem avatar) só se o Nei pedir pelo nome. Criar vídeo pela API do HeyGen ou gerar mídia paga por API (Magnific, Kling etc.) só com confirmação explícita. Nunca rode `ollama serve`; nunca imprima valores de API keys. Responda em PT-BR, curto, com o resultado e onde ficou.');
  partes.push(`[Mensagem do usuário via ${e.canal}]\n${e.texto}`);
  return partes.filter(Boolean).join('\n\n');
}

export function argumentosCli(bin: string, ctx: ContextoExecucao): string[] {
  const sessao = ctx.vars.OPENPCBOT_SESSION;
  // `--strict-mcp-config`: sem ele o JSON do agente SOMA aos MCP do usuário em
  // vez de restringir; um especialista só-leitura veria tudo (Magnific etc.).
  const mcp = ctx.vars.OPENPCBOT_MCP;
  return [
    '--model', ctx.perfil.modelo,
    '--effort', ctx.perfil.esforco,
    '--dangerously-skip-permissions',
    '--output-format', 'json',
    ...(sessao ? ['--resume', sessao] : []),
    ...(mcp ? ['--mcp-config', mcp, '--strict-mcp-config'] : []),
    '-p', ctx.prompt,
  ].filter((a) => a !== bin);
}

/** Saída JSON do `claude -p --output-format json`; cai para texto se não for JSON. */
export function interpretarSaidaCli(bruto: string): SaidaCli {
  const t = bruto.trim();
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const texto = typeof j.result === 'string' ? j.result : t;
    const usage = (j.usage ?? {}) as Record<string, number>;
    return {
      texto,
      sessionId: typeof j.session_id === 'string' ? j.session_id : undefined,
      custoUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined,
      tokensIn: usage.input_tokens ?? undefined,
      tokensOut: usage.output_tokens ?? undefined,
    };
  } catch {
    return { texto: t };
  }
}

/**
 * Saída de um `claude -p` barrado por hook (05/11/2026, job #89966: o aviso de
 * "cache venceu" do hook-longrun saiu como resposta e o pedido morreu). Vem como
 * texto cru ou no `result` do JSON.
 */
export function bloqueadoPorHook(texto: string): boolean {
  return /^\s*\w+ operation blocked by hook\b/.test(texto);
}

/**
 * Runner que repete UMA vez, sem `--resume`, quando um hook barra o prompt.
 * Sessão retomada é o caso comum (sessão grande e fria); sessão nova não tem o
 * que barrar. Se barrar de novo, `interpretarSaida` lança e o job falha.
 */
export function comRepeticaoSemBloqueio(base: Runner, log: (m: string) => void = () => {}): Runner {
  return {
    nome: base.nome,
    iniciar(ctx: ContextoExecucao): Execucao {
      let atual = base.iniciar(ctx);
      let cancelado = false;
      return {
        aguardar: async () => {
          const bruto = await atual.aguardar();
          if (cancelado || !ctx.vars.OPENPCBOT_SESSION || !bloqueadoPorHook(interpretarSaidaCli(bruto).texto)) return bruto;
          log(`[agente] hook barrou a sessão ${ctx.vars.OPENPCBOT_SESSION}; repetindo em sessão nova`);
          await atual.limpar();
          const { OPENPCBOT_SESSION: _velha, ...vars } = ctx.vars;
          const { vigia: _v, ...resto } = ctx;
          atual = base.iniciar({ ...resto, vars });
          return atual.aguardar();
        },
        cancelar: async () => { cancelado = true; await atual.cancelar(); },
        limpar: () => atual.limpar(),
      };
    },
  };
}

/** Chave em `prefs`: momento do último `/novo` do chat. */
export const CHAVE_NOVO = 'sessao_novo_em';

/** Erros que marcam a sessão como travada (timeout de parede ou vigia). */
/**
 * Sessões do `claude` por (chat, agente), com `/novo` EM ORDEM (3.8.5):
 * `/novo` não apaga nem cancela nada — grava o momento. Job criado antes dele
 * segue na sessão velha e, ao terminar, não grava por cima; job criado depois
 * começa sessão nova. Antes, `/novo` apagava a linha e o job em voo, ao
 * terminar, regravava a sessão velha (agente-cli.ts:141 da 3.7.5).
 */
export class Sessoes {
  constructor(private readonly db: Database.Database, private readonly agora: () => number) {}

  novoEm(chatId: string): number {
    const l = this.db.prepare('SELECT valor FROM prefs WHERE chat_id = ? AND chave = ?').get(chatId, CHAVE_NOVO) as { valor: string } | undefined;
    return l ? Number(l.valor) || 0 : 0;
  }

  /** `/novo`: daqui para frente, sessão nova; o que já existe termina em paz. */
  marcarNovo(chatId: string): void {
    this.db.prepare('INSERT INTO prefs (chat_id, chave, valor, em) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, chave) DO UPDATE SET valor = excluded.valor, em = excluded.em')
      .run(chatId, CHAVE_NOVO, String(this.agora()), this.agora());
  }

  obter(chatId: string, agente: string, criadoEm: number = this.agora()): string | undefined {
    const l = this.db.prepare('SELECT session_id, ultimo_uso FROM sessions WHERE chat_id = ? AND agente = ?').get(chatId, agente) as { session_id: string; ultimo_uso: number } | undefined;
    // Sessão fria (> 55 min) não é retomada: o cache do provedor venceu e ela releria tudo (job #89966).
    // A sessão nova recebe o resumo de retomada + últimas mensagens (resumo-sessao.ts).
    if (!l || this.agora() - l.ultimo_uso > CACHE_SEG) return undefined;
    const novo = this.novoEm(chatId);
    // Job de depois do /novo não herda sessão de antes; job de antes não pega a nova.
    if (novo > 0 && (criadoEm >= novo) !== (l.ultimo_uso >= novo)) return undefined;
    if (this.travouDepois(chatId, agente, l.ultimo_uso)) {
      this.db.prepare('DELETE FROM sessions WHERE chat_id = ? AND agente = ?').run(chatId, agente);
      return undefined;
    }
    return l.session_id;
  }

  /** Grava a sessão do chat; job anterior ao último `/novo` não grava (devolve false). */
  gravar(chatId: string, agente: string, sessionId: string, criadoEm: number = this.agora()): boolean {
    const novo = this.novoEm(chatId);
    if (novo > 0 && criadoEm < novo) return false;
    this.db.prepare('INSERT INTO sessions (chat_id, agente, session_id, ultimo_uso) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, agente) DO UPDATE SET session_id = excluded.session_id, ultimo_uso = excluded.ultimo_uso').run(chatId, agente, sessionId, this.agora());
    return true;
  }

  /** Bloco de retomada para a sessão nova (ver resumo-sessao.ts). */
  retomada(chatId: string, agente: string, criadoEm: number = this.agora()): string | undefined {
    return blocoRetomada(this.db, chatId, agente, criadoEm, this.novoEm(chatId), this.agora());
  }

  limpar(chatId: string): number {
    return this.db.prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId).changes;
  }

  /** Último job deste agente no chat, terminado depois de `desde`, morreu travado? */
  private travouDepois(chatId: string, agente: string, desde: number): boolean {
    const j = this.db.prepare(
      `SELECT status, erro FROM jobs WHERE tarefa = ? AND (flow_ref = ? OR flow_ref LIKE ?) AND terminado_em IS NOT NULL AND terminado_em > ?
       ORDER BY terminado_em DESC, id DESC LIMIT 1`,
    ).get(`agente:${agente}`, chatId, `%:${chatId}`, desde) as { status: string; erro: string | null } | undefined;
    if (!j || j.status !== 'failed' || !j.erro) return false;
    return /timeout de|não respondeu/.test(j.erro);
  }

  gravarDoJob(jobId: number, sessionId: string): void {
    this.db.prepare('UPDATE jobs SET sessao = ? WHERE id = ?').run(sessionId, jobId);
  }

  /** Sessão para continuar o job; a que travou ("não respondeu") não volta. */
  doJob(jobId: number): string | undefined {
    const l = this.db.prepare('SELECT sessao, erro FROM jobs WHERE id = ?').get(jobId) as { sessao: string | null; erro: string | null } | undefined;
    if (!l?.sessao || (l.erro && l.erro.includes('não respondeu'))) return undefined;
    return l.sessao;
  }
}

/**
 * `promptDe` do worker da lane `agente`: transforma o job (input JSON =
 * EntradaAgente) no ContextoExecucao do runner `claude`.
 */
export function criarPromptDe(o: { sessoes: Sessoes; registro: RegistroCusto; claudeBin: string; bloqueiaAgente?: (id: string) => string | null; quadro?: (job: Job) => string }) {
  return async (job: Job): Promise<ContextoExecucao> => {
    const e = JSON.parse(job.input) as EntradaAgente;
    // Job enfileirado ANTES do /parar: falha aqui, sem gastar tokens.
    const bloqueio = o.bloqueiaAgente?.(e.agente);
    if (bloqueio) throw new Error(`interruptor ligado (${bloqueio}); /retomar libera`);
    const agente = agentesCacheados().find((a) => a.id === e.agente) ?? agentesCacheados().find((a) => a.id === 'lead')!;
    const sessao = e.somenteLeitura ? undefined
      : e.continuaJob !== undefined ? o.sessoes.doJob(e.continuaJob)
      : o.sessoes.obter(e.chatId, agente.id, job.criado_em);
    // Gravada já na largada: se este job morrer no timeout, `/job N` ainda acha a conversa.
    if (sessao) o.sessoes.gravarDoJob(job.id, sessao);
    // Sem sessão para retomar porque esfriou: o resumo e as últimas mensagens seguram o fio.
    const retomada = !sessao && !e.somenteLeitura && e.continuaJob === undefined
      ? o.sessoes.retomada(e.chatId, agente.id, job.criado_em) : undefined;
    const cwd = existsSync(agente.cwd) ? agente.cwd : RAIZ;
    const transcript = sessao ? transcriptDe(cwd, sessao) : undefined;
    const t0 = Date.now();
    return {
      prompt: montarPrompt(e, agente, o.quadro?.(job), retomada),
      cwd,
      perfil: { motor: 'claude', modelo: job.modelo ?? agente.modelo, esforco: job.esforco ?? agente.esforco },
      vars: { ...(sessao ? { OPENPCBOT_SESSION: sessao } : {}), ...(agente.mcpConfig && existsSync(agente.mcpConfig) ? { OPENPCBOT_MCP: agente.mcpConfig } : {}), OPENPCBOT_CHAT: e.chatId, OPENPCBOT_TRACE: e.traceId ?? '', LONGRUN_PAUSA_TOKENS: '0' },
      timeoutMs: timeoutDoPedido(e.texto),
      // Só vigia sessão RETOMADA cujo transcript existe: caminho errado não pode matar job sadio.
      ...(transcript && existsSync(transcript) ? { vigia: { arquivo: transcript, prazoMs: VIGIA_RETOMADA_MS } } : {}),
      interpretarSaida: (bruto: string): string => {
        const s = interpretarSaidaCli(bruto);
        if (!e.chatId) throw new Error('EntradaAgente sem chatId — input do job malformado');
        // Texto de hook não é resposta: falha o job (o Nei recebe o erro) e não grava a sessão.
        if (bloqueadoPorHook(s.texto)) throw new Error(`hook barrou o pedido mesmo em sessão nova: ${s.texto.slice(0, 300)}`);
        o.registro.gravar({
          traceId: e.traceId, provedor: 'claude-cli', modelo: job.modelo ?? agente.modelo, tier: 'premium', agente: agente.id, jobId: job.id, chatId: e.chatId,
          tokensIn: s.tokensIn ?? 0, tokensOut: s.tokensOut ?? 0, custoUsd: s.custoUsd ?? 0, latenciaMs: Date.now() - t0, ok: true, motivoTier: 'agente CLI',
        });
        if (s.sessionId && !e.somenteLeitura) {
          o.sessoes.gravarDoJob(job.id, s.sessionId);
          // Continuação de job antigo não sequestra a sessão atual do chat.
          if (e.continuaJob === undefined) o.sessoes.gravar(e.chatId, agente.id, s.sessionId, job.criado_em);
        }
        return s.texto;
      },
    };
  };
}
