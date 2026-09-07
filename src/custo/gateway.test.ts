import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { aplicarMigrations } from '../db/migrations.js';
import { OLLAMA_DEFAULT, PRECOS_DEFAULT } from '../config/yaml.js';
import { GestorOllama } from '../ollama/gestor.js';
import type { Provedor } from '../provedores/tipos.js';
import { GatewayLLM } from './gateway.js';
import { Orcamento } from './orcamento.js';
import { calcularCusto } from './precos.js';
import { RegistroCusto } from './registro.js';

function fake(nome: Provedor['nome'], tokensOut = 10, custo?: number): Provedor & { chamadas: number } {
  const p = { nome, chamadas: 0, async chamar() { p.chamadas += 1; return { texto: `resp-${nome}`, tokensIn: 100, tokensOut, custoUsdInformado: custo }; } };
  return p;
}

function montar(o: { ram?: number; residente?: boolean; mensal?: number; gastoInicial?: number } = {}) {
  const db = new Database(':memory:');
  let t = 1_700_000_000;
  aplicarMigrations(db, () => t);
  const registro = new RegistroCusto(db, () => t);
  const orcamento = new Orcamento(registro, { mensal_usd: o.mensal ?? 50, aviso_pct: 70, trava_pct: 100 });
  const ps = o.residente === false ? [] : [{ name: 'qwen3.8:27b', size: 17e9 }];
  const ollama = new GestorOllama({ url: 'http://x', config: OLLAMA_DEFAULT, lerRamFn: () => ({ totalGb: 119, disponivelGb: o.ram ?? 60, swapUsadoGb: 0 }), fetchFn: (async () => new Response(JSON.stringify({ models: ps }))) as typeof fetch });
  if (o.gastoInicial) registro.gravar({ provedor: 'openrouter', modelo: 'x', tier: 'premium', tokensIn: 0, tokensOut: 0, custoUsd: o.gastoInicial, latenciaMs: 1, ok: true });
  const local = fake('ollama'); const barato = fake('openrouter', 10, 0.002);
  const gw = new GatewayLLM({ provedores: { ollama: local, openrouter: barato }, precos: PRECOS_DEFAULT, registro, orcamento, ollama });
  return { gw, registro, local, barato, avancar: (s: number) => { t += s; } };
}

describe('gateway — único ponto de chamada de LLM', () => {
  it('toda chamada é registrada, inclusive Ollama com custo 0', async () => {
    const { gw, registro, local } = montar();
    const r = await gw.chamar({ tier: 'local', mensagens: [{ role: 'user', content: 'oi' }], agente: 't' });
    expect(r.custoUsd).toBe(0);
    expect(local.chamadas).toBe(1);
    expect(registro.hoje()).toMatchObject({ chamadas: 1, tokensIn: 100, tokensOut: 10 });
  });

  it('usa o custo informado pelo OpenRouter quando existe', async () => {
    const { gw, registro } = montar();
    const r = await gw.chamar({ tier: 'barato', mensagens: [], motivoTier: 'teste' });
    expect(r.custoUsd).toBe(0.002);
    expect(registro.mes().custoUsd).toBeCloseTo(0.002);
  });

  it('trava dura: orçamento esgotado rebaixa barato → local', async () => {
    const { gw, local, barato } = montar({ mensal: 1, gastoInicial: 1.5 });
    const r = await gw.chamar({ tier: 'barato', mensagens: [] });
    expect(r.tier).toBe('local');
    expect(r.rebaixado).toMatch(/esgotado/);
    expect(barato.chamadas).toBe(0);
    expect(local.chamadas).toBe(1);
  });

  it('sem RAM para o modelo local não residente → cai para barato (nunca carrega)', async () => {
    const { gw, local, barato } = montar({ ram: 12, residente: false });
    const r = await gw.chamar({ tier: 'local', mensagens: [] });
    expect(r.tier).toBe('barato');
    expect(local.chamadas).toBe(0);
    expect(barato.chamadas).toBe(1);
  });

  it('sem RAM e orçamento travado → erro explícito, sem chamar ninguém', async () => {
    const { gw, local, barato } = montar({ ram: 12, residente: false, mensal: 1, gastoInicial: 2 });
    await expect(gw.chamar({ tier: 'local', mensagens: [] })).rejects.toThrow(/não pode carregar/);
    expect(local.chamadas + barato.chamadas).toBe(0);
  });

  it('falha do provedor fica registrada com ok=0 e propaga', async () => {
    const { gw, registro } = montar();
    const quebrado: Provedor = { nome: 'openrouter', async chamar() { throw new Error('502'); } };
    const gw2 = new GatewayLLM({ ...(gw as unknown as { o: ConstructorParameters<typeof GatewayLLM>[0] }).o, provedores: { openrouter: quebrado } });
    await expect(gw2.chamar({ tier: 'barato', mensagens: [] })).rejects.toThrow('502');
    expect(registro.hoje().chamadas).toBe(1);
  });
});

describe('orçamento — alertas por transição', () => {
  it('avisa a 70 % uma vez e trava a 100 % uma vez', () => {
    const { registro } = montar();
    const o = new Orcamento(registro, { mensal_usd: 10, aviso_pct: 70, trava_pct: 100 });
    expect(o.alertaPendente()).toBeNull();
    registro.gravar({ provedor: 'openrouter', modelo: 'x', tier: 'premium', tokensIn: 0, tokensOut: 0, custoUsd: 7.5, latenciaMs: 1, ok: true });
    expect(o.alertaPendente()?.chave).toBe('orcamento.aviso');
    expect(o.alertaPendente()).toBeNull();
    registro.gravar({ provedor: 'openrouter', modelo: 'x', tier: 'premium', tokensIn: 0, tokensOut: 0, custoUsd: 3, latenciaMs: 1, ok: true });
    expect(o.alertaPendente()?.chave).toBe('orcamento.trava');
    expect(o.avaliar('premium').permitido).toBe(false);
    expect(o.avaliar('local').permitido).toBe(true);
  });
});

describe('preços', () => {
  it('calcula por 1M tokens e Ollama é zero', () => {
    expect(calcularCusto(PRECOS_DEFAULT, 'openrouter', 'anthropic/claude-haiku-4.5', 1_000_000, 100_000)).toBeCloseTo(1.5);
    expect(calcularCusto(PRECOS_DEFAULT, 'ollama', 'qwen3.8:27b', 1e6, 1e6)).toBe(0);
    expect(calcularCusto(PRECOS_DEFAULT, 'anthropic', 'claude-sonnet-5', 1000, 1000)).toBeCloseTo(0.018);
  });
});
