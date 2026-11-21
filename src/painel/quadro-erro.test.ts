import { describe, expect, it } from 'vitest';

import { REGRAS, type GruposColetados } from './alertas.js';

// Nei, 21/11: falha de vídeo/job/rodada vai à lista de erros; o quadro só fica vermelho se o sistema cai ou trava.
const regra = (id: string) => REGRAS.find((r) => r.id === id)!;
const g = {
  bots: { ok: true, dados: { servicos: { inemaccbot: 'failed' }, inemaccbot: { falhas_24h: [{ id: 7, tarefa: 'r7ex', quando: 1 }] } } },
  producao: { ok: true, dados: { falhas: [{ unidade: 'clima', fim: 1, motivo: 'vídeo rejeitado' }], presas: [{ unidade: 'r7ex', inicio: 1, aberta_min: 90 }], interrompidas: [], esperas: [] } },
} as unknown as GruposColetados;

describe('o que pinta o quadro', () => {
  it('job que falhou e rodada que falhou não pintam o quadro', () => {
    expect(regra('job-falhou-inemaccbot').avaliar(g, 0).every((a) => a.quadro === false)).toBe(true);
    expect(regra('rodada-falhou').avaliar(g, 0).every((a) => a.quadro === false)).toBe(true);
  });
  it('serviço fora do ar e rodada travada pintam', () => {
    const s = regra('servico-inemaccbot').avaliar(g, 0);
    expect(s).toHaveLength(1);
    expect(s[0].quadro).toBeUndefined();
    expect(regra('rodada-presa').avaliar(g, 0)[0].quadro).toBeUndefined();
  });
});
