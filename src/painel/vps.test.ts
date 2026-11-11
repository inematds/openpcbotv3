// Quadros VPS e Outras APIs (10/11/2026): leitura do SSH, inventário e lista de APIs.
import { describe, expect, it } from 'vitest';

import { lerApis } from './fontes/apis.js';
import { lerInventario, lerMedida } from './fontes/vps.js';

describe('vps e apis', () => {
  it('lê a saída do SSH', () => {
    const m = lerMedida('26%\n9.1G/38G\n1400 3800\n0.31\n2\nup 3 weeks, 2 days\n4\n', 100);
    expect(m).toMatchObject({ ok: true, disco_pct: 26, disco: '9.1G/38G', ram_mb: 1400, ram_total_mb: 3800, carga: 0.31, cpus: 2, uptime: '3 weeks, 2 days', containers: 4 });
    expect(lerMedida('', 1).disco_pct).toBeNull();
  });

  it('inventário ignora item sem IP e corta o papel', () => {
    const l = lerInventario({ vps: [{ id: 'vps1', nome: 'a', ip: '1.1.1.1', roda: ['x'.repeat(300)] }, { id: 'sem-ip' }] });
    expect(l.map((v) => v.id)).toEqual(['vps1']);
    expect(l[0].papel[0].length).toBe(120);
    expect(lerInventario(null)).toEqual([]);
  });

  it('lista de APIs: situação desconhecida vira "pedir antes"', () => {
    const a = lerApis({ apis: [{ nome: 'GitHub', para: 'repos', situacao: 'liberada' }, { nome: 'X', situacao: 'qualquer' }, { para: 'sem nome' }] });
    expect(a.map((x) => [x.nome, x.situacao])).toEqual([['GitHub', 'liberada'], ['X', 'pedir antes']]);
  });
});
