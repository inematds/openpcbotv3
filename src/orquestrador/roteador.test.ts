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
