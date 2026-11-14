import { describe, expect, it } from 'vitest';

import { alertasPay, normalizarPay } from './fontes/pay.js';
import { montarEsperando } from './agregador.js';

const AGORA = 1_794_700_000;
const robo = (estado: string, motivo: string | null = null) => ({ nome: 'PIX Nubank', onde: 'VPS1 agente2', estado, motivo, pix_7d: 4, valor_7d: 720 });

describe('Pay e bancos (pay-monitor)', () => {
  it('robô ok: sem alerta; dados normalizados', () => {
    const p = normalizarPay({ atualizado: AGORA - 60, robos: [robo('ok')] }, AGORA);
    expect(p.parado).toBe(false);
    expect(p.robos[0].valor_7d).toBe(720);
    expect(alertasPay(p)).toEqual([]);
  });
  it('robô em erro vira alerta e item vermelho em Esperando você', () => {
    const p = normalizarPay({ atualizado: AGORA - 60, robos: [robo('erro', '3 falhas seguidas — HTTPError: HTTP Error 400')] }, AGORA);
    expect(alertasPay(p)).toEqual([{ chave: 'pay:PIX Nubank:erro', nivel: 'erro', texto: 'PIX Nubank (VPS1 agente2): 3 falhas seguidas — HTTPError: HTTP Error 400' }]);
    const g = { bots: {}, producao: {}, creditos: {}, terminais: {}, pay: { ok: true, gerado_em: AGORA, dados: p } } as never;
    const it0 = montarEsperando(g, [], [])[0];
    expect(it0.nivel).toBe('erro');
    expect(it0.grupo).toBe('pay');
  });
  it('arquivo velho (> 30 min) = monitor parado (erro); estado desconhecido vira erro', () => {
    const p = normalizarPay({ atualizado: AGORA - 3600, robos: [robo('xyz')] }, AGORA);
    expect(p.parado).toBe(true);
    expect(p.robos[0].estado).toBe('erro');
    expect(alertasPay(p).map((a) => a.chave)).toContain('pay:monitor-parado');
  });
});

describe('Pay e bancos — desenho do quadro', async () => {
  const { JS_AJUDA } = await import('./tela/script-base.js');
  const { JS_GRUPOS } = await import('./tela/script-grupos.js');
  type Desenho = { tile: (d: unknown, g: unknown) => { frase: string; corpo: string }; detalhe: (d: unknown, g: unknown) => string };
  const G = (new Function(`${JS_AJUDA}\nvar NOMES={};function tok(){return'x'}\n${JS_GRUPOS}\nreturn G;`)() as Record<string, Desenho>);
  it('robô parado aparece em vermelho no quadro e no detalhe', () => {
    const d = normalizarPay({ atualizado: AGORA - 60, robos: [{ ...robo('erro', '190 falhas seguidas'), token_vence: AGORA + 86400 }] }, AGORA);
    const t = G.pay.tile(d, { ok: true });
    expect(t.frase).toContain('PARADO');
    expect(t.corpo).toContain('190 falhas seguidas');
    expect(G.pay.detalhe(d, { ok: true })).toContain('Token do Gmail vence');
  });
  it('sem arquivo: aviso de sem leitura', () => {
    expect(G.pay.tile({ robos: [] }, { ausentes: ['pay.json'] }).frase).toContain('sem leitura');
  });
});
