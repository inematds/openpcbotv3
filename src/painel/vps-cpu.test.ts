import { describe, expect, it } from 'vitest';

import { cpuEntre, JANELA_HIST_S, lerMedida, somarHistorico, type MedidaVps } from './fontes/vps.js';

const AGORA = 1_795_200_000;

describe('CPU das VPS', () => {
  it('cpuEntre calcula o % ocupado entre duas leituras do /proc/stat', () => {
    // total sobe 100, ocioso (idle+iowait) sobe 25 → 75 % ocupado
    expect(cpuEntre('cpu  100 0 100 700 100 0 0 0 0 0', 'cpu  140 0 135 720 105 0 0 0 0 0')).toBe(75);
    expect(cpuEntre('cpu  1 1 1 1', 'cpu  1 1 1 1')).toBeNull(); // nada passou
    expect(cpuEntre('lixo', 'cpu  1 1 1 1')).toBeNull();
    expect(cpuEntre(undefined, undefined)).toBeNull();
  });

  it('lerMedida lê o % de CPU nas duas últimas linhas', () => {
    const out = ['42%', '10G/40G', '1500 4000', '0.50', '2', 'up 3 days', '5', 'cpu  100 0 100 700 100 0 0 0', 'cpu  140 0 135 720 105 0 0 0'].join('\n');
    const m = lerMedida(out, AGORA);
    expect(m).toMatchObject({ disco_pct: 42, cpus: 2, containers: 5, cpu_pct: 75 });
  });

  it('somarHistorico guarda 24 h, ignora falha e não repete o mesmo instante', () => {
    const ok = (t: number, c: number): MedidaVps => ({ ok: true, erro: null, disco_pct: 1, disco: null, ram_mb: null, ram_total_mb: null, carga: null, cpus: null, uptime: null, containers: null, medido_em: t, cpu_pct: c });
    let h = somarHistorico({ '1.1.1.1': [[AGORA - JANELA_HIST_S - 10, 50], [AGORA - 600, 20]] }, { '1.1.1.1': ok(AGORA, 30) }, AGORA);
    expect(h['1.1.1.1']).toEqual([[AGORA - 600, 20], [AGORA, 30]]);
    h = somarHistorico(h, { '1.1.1.1': ok(AGORA, 30), '2.2.2.2': { ...ok(AGORA, 9), ok: false } }, AGORA);
    expect(h['1.1.1.1']).toHaveLength(2);
    expect(h['2.2.2.2']).toBeUndefined();
    // segunda instância do painel mede 8 s depois: não duplica o ponto
    h = somarHistorico(h, { '1.1.1.1': ok(AGORA + 8, 31) }, AGORA + 8);
    expect(h['1.1.1.1']).toHaveLength(2);
  });
});

describe('CPU das VPS — desenho', async () => {
  const { JS_AJUDA } = await import('./tela/script-base.js');
  const { JS_GRUPOS } = await import('./tela/script-grupos.js');
  const { JARVIS_JS } = await import('./tela/jarvis.js');
  type Desenho = { tile: (d: unknown, g: unknown) => { frase: string; corpo: string }; detalhe: (d: unknown, g: unknown) => string };
  const G = (new Function(`${JS_AJUDA}\nvar NOMES={};function tok(){return'x'}\nfunction vpsNome(x){return x.nome}\n${JS_GRUPOS}\nreturn G;`)() as Record<string, Desenho>);
  const agora = Math.floor(Date.now() / 1000);
  const d = { vps: [{ id: 'vps1', nome: 'agente2', ip: '1.1.1.1', local: 'eu', plano: '', papel: [],
    medida: { ok: true, disco_pct: 40, disco: '10G/40G', ram_mb: 1, ram_total_mb: 4, cpus: 2, carga: 0.5, uptime: '3 days', containers: 2, cpu_pct: 37, medido_em: agora },
    cpu_hist: [[agora - 1200, 10], [agora - 600, 55], [agora, 37]] }] };

  it('quadro clássico mostra cpu no tile e o gráfico no detalhe', () => {
    expect(G.vps.tile(d, { ok: true }).corpo).toContain('cpu 37%');
    const det = G.vps.detalhe(d, { ok: true });
    expect(det).toContain('CPU nas últimas 24 h');
    expect(det).toMatch(/<polyline points="[\d.,\s]+"/);
  });

  it('o script do Jarvis continua compilando', () => {
    expect(() => new Function(JARVIS_JS)).not.toThrow();
    expect(JARVIS_JS).toContain('VPS · CPU nas últimas 24 h');
  });
});
