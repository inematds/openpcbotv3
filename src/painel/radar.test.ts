import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { filaRadar, liberadoRadar } from './fontes/radar.js';

const ep = (s: string) => Math.floor(new Date(s).getTime() / 1000);
const CFG = { nichos: [
  { projeto: 'finviral', nome: 'Finanças', gera: '02:00', a_partir: '00:00' },
  { projeto: 'contaviral', nome: 'Contabilidade', gera: '10:00', a_partir: '12:00' },
  { projeto: 'futviral', nome: 'Futebol', gera: '09:00', a_partir: '14:00' },
] };

function marcar(raiz: string, proj: string, ed: string, quando: string, extra: string[] = []) {
  const d = join(raiz, proj, 'edicoes', ed); mkdirSync(d, { recursive: true });
  const f = join(d, 'PUBLICAR_PENDENTE.video'); writeFileSync(f, 'v\nr\n');
  utimesSync(f, ep(quando), ep(quando));
  for (const x of extra) writeFileSync(join(d, x), '');
}

describe('radar viral', () => {
  it('marcado hoje respeita o "a partir de"; marcado ontem já pode', () => {
    expect(liberadoRadar(ep('2026-11-11T10:30:00'), '12:00', ep('2026-11-11T11:00:00'))).toBe(false);
    expect(liberadoRadar(ep('2026-11-11T10:30:00'), '12:00', ep('2026-11-11T12:00:00'))).toBe(true);
    expect(liberadoRadar(ep('2026-11-10T23:00:00'), '14:00', ep('2026-11-11T01:00:00'))).toBe(true);
  });

  it('fila: mais antigo primeiro, ignora auxiliares e o que passou de 24 h, mostra SEGURAR', () => {
    const r = mkdtempSync(join(tmpdir(), 'radar-'));
    marcar(r, 'futviral', '2026-11-11-diario', '2026-11-11T10:25:00');
    marcar(r, 'contaviral', '2026-11-11-diario', '2026-11-11T11:18:00', ['SEGURAR']);
    marcar(r, 'finviral', '2026-11-11-diario', '2026-11-11T03:30:00', ['PUBLICAR_PENDENTE.video.sem-metricool']);
    marcar(r, 'contaviral', '2026-11-01-domingo-longo', '2026-11-01T13:00:00');
    const f = filaRadar(r, CFG, ep('2026-11-11T13:00:00'));
    expect(f.map((i) => [i.projeto, i.estado])).toEqual([['finviral', 'liberado'], ['futviral', 'espera'], ['contaviral', 'segurado']]);
  });
});
