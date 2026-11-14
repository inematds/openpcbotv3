import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { alertasUso, coletarInemapro, coletarPortal } from './fontes/uso.js';
import { montarEsperando } from './agregador.js';

const AGORA = 1_794_700_000;
const deps = (arq: string) => ({ caminhos: { uso: arq }, agora: () => AGORA }) as never;
const grava = (o: unknown) => { const d = mkdtempSync(join(tmpdir(), 'uso-')); const f = join(d, 'uso.json'); writeFileSync(f, JSON.stringify(o)); return f; };

describe('INEMA.PRO e Portal (uso-inema)', () => {
  it('lê cada lado do arquivo; sem arquivo = ausente', () => {
    const f = grava({ atualizado: AGORA - 3600, erros: [], pro: { acessos_7d: { pessoas: 93 }, rotinas: [{ nome: 'sync-cerebro', estado: 'ok' }] }, portal: { visitas_24h: { visitas: 222 } } });
    const pro = coletarInemapro(deps(f)), po = coletarPortal(deps(f));
    expect(pro.ausentes).toEqual([]);
    expect((pro.dados.acessos_7d as { pessoas: number }).pessoas).toBe(93);
    expect((po.dados.visitas_24h as { visitas: number }).visitas).toBe(222);
    expect(pro.dados.parado).toBe(false);
    expect(alertasUso(pro.dados)).toEqual([]);
    expect(coletarPortal(deps('/nao/existe.json')).ausentes.length).toBe(1);
  });
  it('rotina com erro e arquivo de mais de 30 h viram aviso em Esperando você', () => {
    const f = grava({ atualizado: AGORA - 31 * 3600, pro: { rotinas: [{ nome: 'gera-embeddings', estado: 'erro' }] } });
    const p = coletarInemapro(deps(f)).dados;
    expect(alertasUso(p).map((a) => a.texto)).toEqual(['INEMA.PRO e Portal: o uso-inema não atualiza há mais de 30 h', 'INEMA.PRO: a rotina gera-embeddings falhou na última execução']);
    const g = { bots: {}, producao: {}, creditos: {}, terminais: {}, inemapro: { ok: true, gerado_em: AGORA, dados: p } } as never;
    const itens = montarEsperando(g, [], []);
    expect(itens.filter((i) => i.grupo === 'inemapro').length).toBe(2);
  });
});
