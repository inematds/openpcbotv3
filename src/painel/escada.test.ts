import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { coletarEscada } from './fontes/escada.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';

const EXEMPLO = {
  gerado_em: '2026-11-12T09:00:00-03:00',
  periodo: { inicio: '2026-10-13', fim: '2026-11-12', dias: 30 },
  fontes: { claude_sessoes: 9986, codex_sessoes: 3250, conversas: 1916, automaticas: 8070, acoes: 111863 },
  parcela_ia: 64.1,
  parcela_anterior: 60.2,
  anthropic_ref: 26,
  projecao: [{ meses: 3, pct: 91.2 }, { meses: 0, pct: 64.1 }, { meses: 1, pct: 76.3 }, { meses: 6, pct: 98.4 }],
  tarefas: [{ tarefa: 'Produzir vídeos', horas_semana: 78.3, nivel: 'AL4', critico: false, mix: { AL4: 44, AL3: 41, AL5: 14, AL2: 1 }, proximo: 'AL5' }],
  acoes: ['frase curta 1', 'frase curta 2', 'frase curta 3'],
  missao_do_dia: { titulo: 'frase curta', texto: '2-3 frases' },
  relatorio_md: '/home/x/.local/share/minha-escada/relatorio-executivo.md',
  motor: 'codex gpt-6-luna (low)',
};

function deps(arquivo: string): DepsPainel {
  const dir = mkdtempSync(join(tmpdir(), 'escada-'));
  return { caminhos: { ...caminhosPadrao(dir, dir), escada: arquivo }, agora: () => 1_794_000_000 } as unknown as DepsPainel;
}

describe('minha escada', () => {
  it('lê o escada.json: parcela, variação contra o anterior, projeção em ordem, missão e fontes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'escada-'));
    const arq = join(dir, 'escada.json');
    writeFileSync(arq, JSON.stringify(EXEMPLO));
    const { dados, ausentes } = coletarEscada(deps(arq));
    expect(ausentes).toEqual([]);
    expect(dados.parcela_ia).toBe(64.1);
    expect(dados.variacao).toBe(3.9);
    expect(dados.anthropic_ref).toBe(26);
    expect(dados.gerado_em).toBe(Math.floor(Date.parse('2026-11-12T12:00:00Z') / 1000));
    expect(dados.projecao.map((p) => p.meses)).toEqual([0, 1, 3, 6]);
    expect(dados.tarefas[0]).toMatchObject({ tarefa: 'Produzir vídeos', nivel: 'AL4', proximo: 'AL5', critico: false });
    expect(dados.acoes).toHaveLength(3);
    expect(dados.missao?.titulo).toBe('frase curta');
    expect(dados.fontes.acoes).toBe(111863);
    expect(dados.motor).toBe('codex gpt-6-luna (low)');
  });

  it('parcela_anterior null: sem variação', () => {
    const dir = mkdtempSync(join(tmpdir(), 'escada-'));
    const arq = join(dir, 'escada.json');
    writeFileSync(arq, JSON.stringify({ ...EXEMPLO, parcela_anterior: null }));
    const { dados } = coletarEscada(deps(arq));
    expect(dados.parcela_anterior).toBeNull();
    expect(dados.variacao).toBeNull();
  });

  it('sem o arquivo: ausente, sem inventar número', () => {
    const { dados, ausentes } = coletarEscada(deps('/caminho/que/nao/existe/escada.json'));
    expect(ausentes).toEqual(['escada.json']);
    expect(dados.parcela_ia).toBeNull();
    expect(dados.missao).toBeNull();
  });
});
