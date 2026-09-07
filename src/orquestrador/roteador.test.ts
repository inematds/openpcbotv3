import { describe, expect, it } from 'vitest';

import type { Agente } from './agentes.js';
import { parsearDecisao } from './roteador.js';
import { argumentosCli, interpretarSaidaCli } from './agente-cli.js';

const agentes: Agente[] = [
  { id: 'lead', nome: 'Lead', descricao: '', modelo: 'sonnet', esforco: 'medium', somenteLeitura: false, cwd: '/tmp', dir: '/tmp', prompt: '' },
  { id: 'research', nome: 'Research', descricao: '', modelo: 'opus', esforco: 'high', somenteLeitura: true, cwd: '/tmp', dir: '/tmp', prompt: '' },
  { id: 'ops', nome: 'Ops', descricao: '', modelo: 'sonnet', esforco: 'medium', somenteLeitura: false, cwd: '/tmp', dir: '/tmp', prompt: '' },
];

describe('parsearDecisao', () => {
  it('lixo → direto local', () => {
    expect(parsearDecisao('não sei', agentes)).toMatchObject({ rota: 'direto', tier: 'local' });
  });

  it('agente inválido cai para lead; rota agente força tier premium', () => {
    const d = parsearDecisao('{"rota":"agente","agente":"hacker","tier":"local","motivo":"x"}', agentes);
    expect(d).toMatchObject({ rota: 'agente', agente: 'lead', tier: 'premium' });
  });

  it('consultar filtra ids desconhecidos e o próprio agente, máx 2', () => {
    const d = parsearDecisao('{"rota":"agente","agente":"ops","consultar":["ops","research","zzz","lead","research"]}', agentes);
    expect(d.consultar).toEqual(['research', 'lead']);
  });

  it('premium nunca por conta própria em rota direta', () => {
    expect(parsearDecisao('{"rota":"direto","tier":"premium"}', agentes).tier).toBe('local');
    expect(parsearDecisao('{"rota":"direto","tier":"barato"}', agentes).tier).toBe('barato');
  });

  it('aceita JSON cercado de texto', () => {
    expect(parsearDecisao('claro! {"rota":"direto","tier":"local","motivo":"papo"} ok', agentes).motivo).toBe('papo');
  });
});

describe('agente CLI', () => {
  it('monta args com resume quando há sessão', () => {
    const args = argumentosCli('claude', { prompt: 'oi', cwd: '/tmp', perfil: { motor: 'claude', modelo: 'sonnet', esforco: 'medium' }, vars: { OPENPCBOT_SESSION: 'abc' } });
    expect(args).toContain('--resume');
    expect(args.slice(-2)).toEqual(['-p', 'oi']);
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('interpreta JSON do claude -p e cai para texto cru', () => {
    expect(interpretarSaidaCli('{"result":"feito","session_id":"s1","total_cost_usd":0.12,"usage":{"input_tokens":5,"output_tokens":7}}'))
      .toEqual({ texto: 'feito', sessionId: 's1', custoUsd: 0.12, tokensIn: 5, tokensOut: 7 });
    expect(interpretarSaidaCli('texto solto')).toEqual({ texto: 'texto solto' });
  });
});

describe('promptDe do job de agente', () => {
  it('lê a EntradaAgente do input, registra custo e grava sessão com o chatId certo', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { aplicarMigrations } = await import('../db/migrations.js');
    const { RegistroCusto } = await import('../custo/registro.js');
    const { Sessoes, criarPromptDe } = await import('./agente-cli.js');
    const db = new Database(':memory:');
    aplicarMigrations(db, () => 1);
    const sessoes = new Sessoes(db, () => 1);
    const registro = new RegistroCusto(db, () => 1);
    const promptDe = criarPromptDe({ sessoes, registro, claudeBin: 'claude' });
    const entrada = { chatId: '77', canal: 'http', texto: 'conta linhas', agente: 'lead', traceId: 't' };
    const ctx = await promptDe({ id: 9, fila: 'agente', kind: 'agent', tarefa: 'agente:lead', input: JSON.stringify(entrada), prioridade: 0, status: 'running', tentativas: 1, max_tentativas: 1, lease_ate: null, lease_owner: 'w', disponivel_em: 0, idem_key: null, flow_ref: null, chat_id: null, motor: null, modelo: null, esforco: null, resultado: null, erro: null, notificado_em: null, criado_em: 1, iniciado_em: 1, terminado_em: null });
    expect(ctx.prompt).toContain('conta linhas');
    expect(ctx.perfil.motor).toBe('claude');
    const texto = ctx.interpretarSaida!('{"result":"419","session_id":"sess-1","total_cost_usd":0.03}');
    expect(texto).toBe('419');
    expect(sessoes.obter('77', 'lead')).toBe('sess-1');
    expect(registro.hoje()).toMatchObject({ chamadas: 1, custoUsd: 0.03 });
  });
});
