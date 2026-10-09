import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { abrirDb } from '../db/abrir.js';
import { MIGRATIONS, aplicarMigrations } from '../db/migrations.js';
import { FilaSqlite } from '../fila/store.js';
import { CONSULTA_RE } from './roteador.js';
import { MARCA_ESCALAR, deveEscalar, ehPerguntaStatus, jobsAbertos, textoSituacao } from './situacao.js';

// Frases reais de 2026-10-09 (18:41/18:53) que caíram na rota direta.
const PERGUNTAS_DE_HOJE = ['qual situação do alerta do norte com avatar?', 'e a situação do projeto do avatar?'];

describe('pergunta de status', () => {
  it('reconhece as perguntas de andamento', () => {
    for (const p of [...PERGUNTAS_DE_HOJE, 'e aí, terminou?', 'como está o vídeo?', 'status']) expect(ehPerguntaStatus(p)).toBe(true);
  });
  it('não pega pedido comum nem texto longo', () => {
    expect(ehPerguntaStatus('me explica o que é RAG')).toBe(false);
    expect(ehPerguntaStatus('situação '.repeat(30))).toBe(false);
  });
});

describe('roteador: consulta vai ao agente', () => {
  it('as perguntas de hoje casam com CONSULTA_RE', () => {
    for (const p of PERGUNTAS_DE_HOJE) expect(CONSULTA_RE.test(p)).toBe(true);
  });
  it('conversa simples não casa', () => {
    for (const p of ['bom dia', 'traduz isso pro inglês: obrigado', 'me dá uma ideia de nome pra gato']) expect(CONSULTA_RE.test(p)).toBe(false);
  });
});

describe('trava da rota direta', () => {
  it('promessa sem ação escala', () => {
    for (const r of [
      'Vou verificar a situação do projeto do avatar com alerta do norte.',
      'Deixa eu dar uma olhada e já te retorno.',
      'Um momento, vou conferir.',
      MARCA_ESCALAR,
    ]) expect(deveEscalar(r)).toBe(true);
  });
  it('resposta de verdade passa', () => {
    for (const r of ['RAG é recuperar trechos relevantes antes de gerar a resposta.', 'Vou explicar em três passos: 1) ...']) expect(deveEscalar(r)).toBe(false);
  });
});

describe('situação lida da fila', () => {
  let dir: string;
  let t = 10_000;
  let fila: FilaSqlite;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'situacao-'));
    const db = abrirDb(join(dir, 'f.db'));
    aplicarMigrations(db, () => t, MIGRATIONS);
    fila = new FilaSqlite(db, () => t);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('sem job aberto → null (segue o fluxo normal)', () => {
    expect(textoSituacao(jobsAbertos(fila, 'telegram:1'), t)).toBeNull();
  });

  it('lista só os jobs deste chat, com pedido e tempo', () => {
    fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'agente:lead', input: JSON.stringify({ texto: 'enviar o video-avatar ao bot' }), chat_id: 1, max_tentativas: 1, flow_ref: 'telegram:1' });
    fila.enfileirar({ fila: 'agente', kind: 'agent', tarefa: 'agente:ops', input: '{}', chat_id: 2, max_tentativas: 1, flow_ref: 'telegram:2' });
    t += 360;
    const s = textoSituacao(jobsAbertos(fila, 'telegram:1'), t) ?? '';
    expect(s).toContain('lead — na fila há 6 min');
    expect(s).toContain('enviar o video-avatar');
    expect(s).not.toContain('ops');
  });
});
