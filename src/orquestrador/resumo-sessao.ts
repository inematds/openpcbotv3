// Resumo de retomada (3.12.6). O cache do provedor dura ~1 h: retomar sessão
// grande depois disso relê tudo sem cache (job #89966: 154 mil tokens, e o hook
// ainda barrou). Então: aos ~45 min parada, uma CÓPIA da sessão (--fork-session,
// cache ainda quente) escreve um resumo curto; depois de 1 h o bot abre sessão
// nova com esse resumo e as últimas mensagens do chat no prompt.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import type Database from 'better-sqlite3';

import { RAIZ } from '../config/env.js';
import { agentesCacheados } from './agentes.js';
import { bloqueadoPorHook, interpretarSaidaCli } from './agente-cli.js';

/** Até aqui a sessão é retomada com cache quente. */
export const CACHE_SEG = 55 * 60;
/** Janela em que o resumo é escrito: parada há 40–52 min (cache ainda vale). */
export const RESUMO_DE_SEG = 40 * 60;
export const RESUMO_ATE_SEG = 52 * 60;
/** Resumo e mensagens antigas só entram se a sessão parou há menos disso. */
export const RETOMADA_MAX_SEG = 24 * 3600;

export const PROMPT_RESUMO = [
  'TAREFA ÚNICA, sem usar ferramentas: a conversa vai ficar parada e a próxima mensagem do Nei vai abrir uma sessão NOVA,',
  'que só vai ver o que você escrever agora. Escreva um resumo de retomada em PT-BR, até 300 palavras, sem preâmbulo:',
  '1) Pedido em andamento (o que o Nei quer, com as palavras dele quando importar).',
  '2) O que já foi feito: caminhos de arquivos, links, ids de jobs, canais.',
  '3) O que falta e o próximo passo exato.',
  '4) Decisões e restrições que o Nei deu nesta conversa.',
  'Se não houver trabalho em andamento, diga isso em uma linha e resuma o último assunto.',
].join('\n');

export interface Candidato { chat_id: string; agente: string; session_id: string; ultimo_uso: number }

/** Executa a cópia da sessão e devolve o texto. Trocável nos testes. */
export type Resumidor = (c: Candidato, cwd: string, modelo: string) => Promise<string>;

export function sessoesParaResumir(db: Database.Database, agora: number): Candidato[] {
  return db.prepare(
    `SELECT chat_id, agente, session_id, ultimo_uso FROM sessions
      WHERE ultimo_uso BETWEEN ? AND ? AND (resumo_de IS NULL OR resumo_de != session_id)`,
  ).all(agora - RESUMO_ATE_SEG, agora - RESUMO_DE_SEG) as Candidato[];
}

/** Tem job de agente aberto neste chat? Então a sessão não está parada de verdade. */
function chatOcupado(db: Database.Database, chatId: string): boolean {
  return !!db.prepare(
    `SELECT 1 FROM jobs WHERE fila = 'agente' AND chat_id = ? AND status IN ('queued', 'running') LIMIT 1`,
  ).get(chatId);
}

export function claudeResumidor(bin: string, timeoutMs = 150_000): Resumidor {
  return (c, cwd, modelo) => new Promise((resolve, reject) => {
    // Ferramentas que escrevem/rodam ficam fora: a cópia só escreve texto. Prompt por último
    // (o --disallowedTools é variádico e engoliria o que viesse depois).
    const args = ['--resume', c.session_id, '--fork-session', '--model', modelo, '--output-format', 'json',
      '--permission-mode', 'default', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,Agent,WebFetch,WebSearch',
      '-p', PROMPT_RESUMO];
    const filho = spawn(bin, args, {
      cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, LONGRUN_PAUSA_TOKENS: '0', LONGRUN_OCIOSO_TOKENS: '0' },
    });
    let out = '';
    filho.stdout?.on('data', (d) => { if (out.length < 200_000) out += String(d); });
    const t = setTimeout(() => { try { process.kill(-(filho.pid ?? 0), 'SIGKILL'); } catch { /* já saiu */ } }, timeoutMs);
    t.unref?.();
    filho.on('error', (e) => { clearTimeout(t); reject(e); });
    filho.on('close', (code) => {
      clearTimeout(t);
      const texto = interpretarSaidaCli(out).texto.trim();
      if (code !== 0 || !texto || bloqueadoPorHook(texto)) return reject(new Error(`resumo falhou (code ${code}): ${texto.slice(0, 200)}`));
      resolve(texto);
    });
  });
}

/**
 * Tarefa do cron (1/min). Marca a tentativa ANTES de rodar: se falhar, não
 * tenta de novo a cada minuto (a retomada cai nas últimas mensagens).
 */
export async function resumirSessoesParadas(db: Database.Database, agora: number, resumir: Resumidor): Promise<string> {
  const feitos: string[] = [];
  for (const c of sessoesParaResumir(db, agora)) {
    if (chatOcupado(db, c.chat_id)) continue;
    db.prepare('UPDATE sessions SET resumo_de = ?, resumo = NULL, resumo_em = ? WHERE chat_id = ? AND agente = ?')
      .run(c.session_id, agora, c.chat_id, c.agente);
    const ag = agentesCacheados().find((a) => a.id === c.agente);
    const cwd = ag && existsSync(ag.cwd) ? ag.cwd : RAIZ;
    try {
      const texto = await resumir(c, cwd, ag?.modelo ?? 'opus');
      // Só grava se a sessão ainda for a mesma (uma mensagem nova pode ter chegado no meio).
      db.prepare('UPDATE sessions SET resumo = ? WHERE chat_id = ? AND agente = ? AND session_id = ?')
        .run(texto.slice(0, 4000), c.chat_id, c.agente, c.session_id);
      feitos.push(`${c.agente}@${c.chat_id}`);
    } catch (e) {
      feitos.push(`${c.agente}@${c.chat_id} falhou: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return feitos.length ? `resumos: ${feitos.join('; ')}` : 'nada a resumir';
}

/**
 * Bloco do prompt da sessão NOVA que substitui a sessão fria: resumo (se houve)
 * + últimas mensagens do chat antes deste pedido. `undefined` = nada a retomar
 * (sem sessão anterior, ainda quente, velha demais ou /novo depois dela).
 */
export function blocoRetomada(db: Database.Database, chatId: string, agente: string, criadoEm: number, novoEm: number, agora: number = criadoEm): string | undefined {
  const l = db.prepare('SELECT session_id, ultimo_uso, resumo, resumo_de FROM sessions WHERE chat_id = ? AND agente = ?')
    .get(chatId, agente) as { session_id: string; ultimo_uso: number; resumo: string | null; resumo_de: string | null } | undefined;
  if (!l) return undefined;
  const parada = agora - l.ultimo_uso; // mesmo relógio de Sessoes.obter
  if (parada <= CACHE_SEG || parada > RETOMADA_MAX_SEG) return undefined;
  if (novoEm > l.ultimo_uso) return undefined; // o Nei pediu /novo: começa limpo de verdade
  const turnos = (db.prepare(
    'SELECT role, content FROM conversation_log WHERE chat_id = ? AND created_at < ? ORDER BY id DESC LIMIT 6',
  ).all(chatId, criadoEm) as { role: string; content: string }[]).reverse();
  const resumo = l.resumo_de === l.session_id && l.resumo ? l.resumo : undefined;
  if (!resumo && !turnos.length) return undefined;
  const h = Math.floor(parada / 3600), m = Math.floor((parada % 3600) / 60);
  const partes = [`[Retomada: a conversa ficou parada ${h}h${String(m).padStart(2, '0')} e esta é uma sessão nova. Continue de onde parou sem pedir para o Nei repetir.]`];
  if (resumo) partes.push(`Resumo escrito pela sessão anterior:\n${resumo}`);
  if (turnos.length) partes.push('Últimas mensagens do chat:\n' + turnos.map((t) => `${t.role === 'user' ? 'Nei' : 'Bot'}: ${t.content.slice(0, 700)}`).join('\n'));
  return partes.join('\n\n');
}
