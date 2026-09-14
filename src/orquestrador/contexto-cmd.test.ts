import { describe, expect, it } from 'vitest';

import { formatarMedicao, type MedicaoContexto } from './contexto-cmd.js';

describe('formatarMedicao', () => {
  const m: MedicaoContexto = {
    consulta: 'oi',
    direto: [{ nome: 'identidade', tokens: 100 }, { nome: 'memória+insights', tokens: 20, itens: ['- fato (recente)'] }],
    agente: [{ nome: 'identidade', tokens: 100 }],
  };
  it('soma por bloco e só mostra itens no detail', () => {
    const curto = formatarMedicao(m, false);
    expect(curto).toContain('≈ 120 tokens');
    expect(curto).not.toContain('fato (recente)');
    expect(curto).toContain('/context detail');
    const longo = formatarMedicao(m, true);
    expect(longo).toContain('· - fato (recente)');
  });
});
