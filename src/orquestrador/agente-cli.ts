// Execução de agente por CLI (`claude -p`) na lane `agente` (decisão 1 do
// plano: CLI na fila). Monta o prompt em camadas (identidade, memória, skills
// só-metadata, contexto dos especialistas), interpreta a saída JSON (resultado
// + session_id + custo real) e registra o custo em `chamadas_llm`.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

import type { ContextoExecucao } from '../fila/runner.js';
import type { Job } from '../fila/types.js';
import type { RegistroCusto } from '../custo/registro.js';
import { RAIZ } from '../config/env.js';
import { blocoSkills, skillsCacheadas } from './skills.js';
import { agentesCacheados, type Agente } from './agentes.js';

export interface EntradaAgente {
  chatId: string;
  canal: string;
  texto: string;
  agente: string;
  memoria?: string;
  /** Saídas dos especialistas read-only (id → texto), já coletadas. */
  consultas?: Record<string, string>;
  traceId?: string;
  /** Se true, o agente não pode escrever (especialista). */
  somenteLeitura?: boolean;
}

export interface SaidaCli {
  texto: string;
  sessionId?: string;
  custoUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export const TIMEOUT_AGENTE_MS = 20 * 60_000;

export function identidade(): string {
  const p = resolve(RAIZ, 'IDENTIDADE.md');
  if (existsSync(p)) return readFileSync(p, 'utf8').slice(0, 4000);
  return 'Você é o openpcbot v3, assistente pessoal do Nei (PT-BR). Seja direto, prático e honesto sobre o que não conseguiu fazer.';
}

export function montarPrompt(e: EntradaAgente, agente: Agente): string {
  const partes: string[] = [identidade()];
  if (agente.prompt) partes.push(`[Agente ${agente.nome}]\n${agente.prompt}`);
  if (e.somenteLeitura || agente.somenteLeitura) partes.push('MODO SOMENTE LEITURA: não crie, edite ou apague arquivos, não faça commit. Só leia e responda.');
  if (e.memoria) partes.push(e.memoria);
  if (e.consultas && Object.keys(e.consultas).length) {
    partes.push('[Contexto dos especialistas]\n' + Object.entries(e.consultas).map(([id, t]) => `## ${id}\n${t.slice(0, 3000)}`).join('\n\n'));
  }
  partes.push(blocoSkills(skillsCacheadas()).join('\n'));
  partes.push('Regras: nunca gere mídia paga (HeyGen, render) sem confirmação explícita; nunca rode `ollama serve`; nunca imprima valores de API keys. Responda em PT-BR, curto, com o resultado e onde ficou.');
  partes.push(`[Mensagem do usuário via ${e.canal}]\n${e.texto}`);
  return partes.filter(Boolean).join('\n\n');
}

export function argumentosCli(bin: string, ctx: ContextoExecucao): string[] {
  const sessao = ctx.vars.OPENPCBOT_SESSION;
  return [
    '--model', ctx.perfil.modelo,
    '--effort', ctx.perfil.esforco,
    '--dangerously-skip-permissions',
    '--output-format', 'json',
    ...(sessao ? ['--resume', sessao] : []),
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

export class Sessoes {
  constructor(private readonly db: Database.Database, private readonly agora: () => number) {}
  obter(chatId: string, agente: string): string | undefined {
    const l = this.db.prepare('SELECT session_id, ultimo_uso FROM sessions WHERE chat_id = ? AND agente = ?').get(chatId, agente) as { session_id: string; ultimo_uso: number } | undefined;
    // Sessão velha (> 6 h) não vale a pena retomar: cache do provedor já expirou (pruning ciente do TTL).
    if (!l || this.agora() - l.ultimo_uso > 6 * 3600) return undefined;
    return l.session_id;
  }
  gravar(chatId: string, agente: string, sessionId: string): void {
    this.db.prepare('INSERT INTO sessions (chat_id, agente, session_id, ultimo_uso) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, agente) DO UPDATE SET session_id = excluded.session_id, ultimo_uso = excluded.ultimo_uso').run(chatId, agente, sessionId, this.agora());
  }
  limpar(chatId: string): number {
    return this.db.prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId).changes;
  }
}

/**
 * `promptDe` do worker da lane `agente`: transforma o job (input JSON =
 * EntradaAgente) no ContextoExecucao do runner `claude`.
 */
export function criarPromptDe(o: { sessoes: Sessoes; registro: RegistroCusto; claudeBin: string }) {
  return async (job: Job): Promise<ContextoExecucao> => {
    const e = JSON.parse(job.input) as EntradaAgente;
    const agente = agentesCacheados().find((a) => a.id === e.agente) ?? agentesCacheados().find((a) => a.id === 'lead')!;
    const sessao = e.somenteLeitura ? undefined : o.sessoes.obter(e.chatId, agente.id);
    const t0 = Date.now();
    return {
      prompt: montarPrompt(e, agente),
      cwd: existsSync(agente.cwd) ? agente.cwd : RAIZ,
      perfil: { motor: 'claude', modelo: job.modelo ?? agente.modelo, esforco: job.esforco ?? agente.esforco },
      vars: { ...(sessao ? { OPENPCBOT_SESSION: sessao } : {}), OPENPCBOT_CHAT: e.chatId, OPENPCBOT_TRACE: e.traceId ?? '' },
      timeoutMs: TIMEOUT_AGENTE_MS,
      interpretarSaida: (bruto: string): string => {
        const s = interpretarSaidaCli(bruto);
        if (!e.chatId) throw new Error('EntradaAgente sem chatId — input do job malformado');
        o.registro.gravar({
          traceId: e.traceId, provedor: 'claude-cli', modelo: job.modelo ?? agente.modelo, tier: 'premium', agente: agente.id, jobId: job.id, chatId: e.chatId,
          tokensIn: s.tokensIn ?? 0, tokensOut: s.tokensOut ?? 0, custoUsd: s.custoUsd ?? 0, latenciaMs: Date.now() - t0, ok: true, motivoTier: 'agente CLI',
        });
        if (s.sessionId && !e.somenteLeitura) o.sessoes.gravar(e.chatId, agente.id, s.sessionId);
        return s.texto;
      },
    };
  };
}
