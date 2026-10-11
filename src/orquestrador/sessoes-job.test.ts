// 3.8.5 — /novo em ordem, sessão por job (/job N), teto por tipo de pedido,
// vigia de sessão retomada muda e aviso de "ainda rodando" (incidente 11/10/2026).
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { App } from '../app.js';
import type { MensagemRecebida } from '../bus/bus.js';
import { aplicarMigrations } from '../db/migrations.js';
import { ClaudeRunner } from '../fila/runner-claude.js';
import { FilaSqlite } from '../fila/store.js';
import { Sessoes, TIMEOUT_CONVERSA_MS, TIMEOUT_PRODUCAO_MS, timeoutDoPedido, transcriptDe } from './agente-cli.js';
import { executarComando } from './comandos.js';
import { avisosAindaRodando } from './situacao.js';

function montar() {
  const db = new Database(':memory:');
  let t = 1000;
  const relogio = { agora: () => t, avancar: (s: number) => { t += s; } };
  aplicarMigrations(db, () => t);
  const fila = new FilaSqlite(db, relogio.agora);
  const sessoes = new Sessoes(db, relogio.agora);
  const app = {
    db, fila, sessoes, agora: relogio.agora,
    cerebro: { logarTurno: () => {}, limparConversa: () => 0 },
  } as unknown as App;
  return { db, fila, sessoes, relogio, app };
}

const CHAT = '42';
const msg = (texto: string): MensagemRecebida => ({ canal: 'telegram', chatId: CHAT, texto } as MensagemRecebida);
const jobAgente = (fila: FilaSqlite, texto: string, chat = CHAT) => fila.enfileirar({
  fila: 'agente', kind: 'agent', tarefa: 'agente:lead',
  input: JSON.stringify({ chatId: chat, canal: 'telegram', agente: 'lead', texto }),
  chat_id: Number(chat), max_tentativas: 1, flow_ref: `telegram:${chat}`,
});

describe('timeoutDoPedido', () => {
  it('produção (vídeo, 9:16, publicar, refazer) ganha horas; conversa fica em 20 min', () => {
    expect(timeoutDoPedido('quero que refaça esse vídeo, 16 por 9 e 9 por 16')).toBe(TIMEOUT_PRODUCAO_MS);
    expect(timeoutDoPedido('faça um vídeo 9 por 16 viral')).toBe(TIMEOUT_PRODUCAO_MS);
    expect(timeoutDoPedido('publique no portal')).toBe(TIMEOUT_PRODUCAO_MS);
    expect(timeoutDoPedido('quantos arquivos .md tem na pasta docs?')).toBe(TIMEOUT_CONVERSA_MS);
    expect(timeoutDoPedido('pode fazer os dois')).toBe(TIMEOUT_CONVERSA_MS);
  });
});

describe('transcriptDe', () => {
  it('segue o slug do claude (não-alfanumérico vira -)', () => {
    expect(transcriptDe('/home/n/projetos', 'abc', '/home/n')).toBe('/home/n/.claude/projects/-home-n-projetos/abc.jsonl');
  });
});

describe('Sessoes com /novo em ordem', () => {
  it('job de antes segue na velha e não grava por cima; job de depois começa nova e passa a ser retomado', () => {
    const { sessoes, relogio } = montar();
    sessoes.gravar(CHAT, 'lead', 'velha', 1000);
    const criadoAntes = relogio.agora();
    relogio.avancar(10);
    sessoes.marcarNovo(CHAT);
    relogio.avancar(10);
    const criadoDepois = relogio.agora();

    expect(sessoes.obter(CHAT, 'lead', criadoAntes)).toBe('velha');
    expect(sessoes.obter(CHAT, 'lead', criadoDepois)).toBeUndefined();
    // O job em voo de antes termina: não regrava a velha.
    expect(sessoes.gravar(CHAT, 'lead', 'velha-continuada', criadoAntes)).toBe(false);
    expect(sessoes.obter(CHAT, 'lead', criadoDepois)).toBeUndefined();
    // O primeiro job de depois grava a nova; o seguinte a retoma.
    expect(sessoes.gravar(CHAT, 'lead', 'nova', criadoDepois)).toBe(true);
    relogio.avancar(5);
    expect(sessoes.obter(CHAT, 'lead', relogio.agora())).toBe('nova');
  });

  it('último job do agente morto por timeout/vigia descarta a sessão do chat', () => {
    const { db, fila, sessoes, relogio } = montar();
    sessoes.gravar(CHAT, 'lead', 'gigante');
    relogio.avancar(60);
    const j = jobAgente(fila, 'oi');
    db.prepare("UPDATE jobs SET status='failed', erro='claude: timeout de 1200s — execução encerrada', terminado_em=? WHERE id=?").run(relogio.agora(), j.id);
    relogio.avancar(60);
    expect(sessoes.obter(CHAT, 'lead')).toBeUndefined();
  });

  it('falha comum (não travamento) mantém a sessão', () => {
    const { db, fila, sessoes, relogio } = montar();
    sessoes.gravar(CHAT, 'lead', 's1');
    relogio.avancar(60);
    const j = jobAgente(fila, 'oi');
    db.prepare("UPDATE jobs SET status='failed', erro='claude saiu com código 1: x', terminado_em=? WHERE id=?").run(relogio.agora(), j.id);
    expect(sessoes.obter(CHAT, 'lead')).toBe('s1');
  });

  it('doJob devolve a sessão do job, menos a que não respondeu', () => {
    const { db, fila, sessoes } = montar();
    const a = jobAgente(fila, 'a');
    const b = jobAgente(fila, 'b');
    sessoes.gravarDoJob(a.id, 'sa');
    sessoes.gravarDoJob(b.id, 'sb');
    db.prepare("UPDATE jobs SET erro='claude: sessão retomada não respondeu em 600s — descartada' WHERE id=?").run(b.id);
    expect(sessoes.doJob(a.id)).toBe('sa');
    expect(sessoes.doJob(b.id)).toBeUndefined();
  });
});

describe('comandos /novo, /status e /job', () => {
  it('/novo não cancela o job aberto', async () => {
    const { app, fila } = montar();
    const j = jobAgente(fila, 'faz um vídeo');
    const r = await executarComando(app, msg('/novo'));
    expect(r).toContain('Conversa nova');
    expect(r).toContain('1 job(s)');
    expect(fila.obter(j.id)?.status).toBe('queued');
  });

  it('/status lista primeiro o seu job e esconde o cron dos recentes', async () => {
    const { app, fila } = montar();
    jobAgente(fila, 'faça um vídeo 9 por 16 viral do JARVIS');
    for (let i = 0; i < 60; i++) fila.enfileirar({ fila: 'cron', kind: 'function', tarefa: 'lembretes', input: '', max_tentativas: 1 });
    const r = (await executarComando(app, msg('/status')))!;
    expect(r).toContain('JARVIS');
    expect(r.split('Recentes')[1]).not.toContain('lembretes');
    expect(r.split('Recentes')[1]).toContain('JARVIS');
  });

  it('/job N texto vira job de agente que continua o N; recusa job de outro chat', async () => {
    const { app, fila, sessoes } = montar();
    const pai = jobAgente(fila, 'refaça o reel');
    sessoes.gravarDoJob(pai.id, 'sessao-pai');
    const r = (await executarComando(app, msg(`/job ${pai.id} agora em 9:16 também`)))!;
    expect(r).toContain(`Continuação do #${pai.id}`);
    const filho = fila.listar({ fila: 'agente' }).at(-1)!;
    const e = JSON.parse(filho.input) as { continuaJob: number; texto: string };
    expect(e.continuaJob).toBe(pai.id);
    expect(e.texto).toContain('refaça o reel');
    expect(e.texto).toContain('agora em 9:16 também');

    const outro = jobAgente(fila, 'segredo', '99');
    expect(await executarComando(app, msg(`/job ${outro.id} oi`))).toContain('não é deste chat');
  });
});

describe('avisosAindaRodando', () => {
  it('avisa só agente:* rodando há mais que o mínimo, no chat do pedido', () => {
    const { db, fila } = montar();
    const longo = jobAgente(fila, 'faça um vídeo');
    const curto = jobAgente(fila, 'oi');
    db.prepare("UPDATE jobs SET status='running', iniciado_em=? WHERE id=?").run(100, longo.id);
    db.prepare("UPDATE jobs SET status='running', iniciado_em=? WHERE id=?").run(3000, curto.id);
    const avisos = avisosAindaRodando(fila.listar({ status: 'running' }), 3600);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ canal: 'telegram', chatId: CHAT });
    expect(avisos[0].texto).toContain(`#${longo.id} ainda rodando há 58 min`);
  });
});

describe('vigia do runner', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const runner = new ClaudeRunner({ binario: '/bin/sh', montarArgs: (c) => ['-c', c.prompt] });
  const ctx = (prompt: string, arquivo: string, prazoMs: number) => ({
    prompt, cwd: '/tmp', perfil: { motor: 'claude', modelo: 'x', esforco: 'low' }, vars: {},
    timeoutMs: 10_000, vigia: { arquivo, prazoMs },
  });

  it('mata a sessão retomada que não escreve nada no prazo', async () => {
    const d = mkdtempSync(join(tmpdir(), 'vigia-')); dirs.push(d);
    const f = join(d, 's.jsonl'); writeFileSync(f, 'x');
    const ini = Date.now();
    await expect(runner.iniciar(ctx('sleep 5', f, 200)).aguardar()).rejects.toThrow(/não respondeu/);
    expect(Date.now() - ini).toBeLessThan(3000);
  });

  it('desliga quando o transcript é escrito e deixa o job terminar', async () => {
    const d = mkdtempSync(join(tmpdir(), 'vigia-')); dirs.push(d);
    const f = join(d, 's.jsonl'); writeFileSync(f, 'x');
    utimesSync(f, new Date(2000, 0, 1), new Date(2000, 0, 1));
    await expect(runner.iniciar(ctx(`echo y >> ${f}; sleep 0.6; echo ok`, f, 300)).aguardar()).resolves.toBe('ok');
  });
});
