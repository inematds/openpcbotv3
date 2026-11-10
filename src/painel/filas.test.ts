// Filas num formato só: estado/status, txt, marcadores e continua vazio (o caso de 10/11 00:29).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { coletarFilas, itensContinua, itensJson, itensMarcadores, itensTxt, normalizar } from './fontes/filas.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';
import { Cache } from './util.js';

describe('filas', () => {
  it('normaliza os estados de todos os sistemas', () => {
    expect(['pendente', 'queued', 'esperando'].map(normalizar)).toEqual(['pendente', 'pendente', 'pendente']);
    expect(['feito', 'done', 'publicado'].map(normalizar)).toEqual(['feito', 'feito', 'feito']);
    expect(['erro', 'failed', 'falhou', 'parado'].map(normalizar)).toEqual(['erro', 'erro', 'erro', 'erro']);
    expect(['retirado', 'removido', 'canceled'].map(normalizar)).toEqual(['retirado', 'retirado', 'retirado']);
    expect(normalizar('rodando')).toBe('publicando');
  });

  it('lê fila com estado e com status; erro guarda o fim da mensagem', () => {
    const a = itensJson([{ id: 'x', estado: 'erro', erro: 'linha 1\nlinha 2\nquota excedida', tentativas: 2, arquivo: '/a/b/v.mp4', canal: 'lives3' }])!;
    expect(a[0]).toMatchObject({ id: 'x', estado: 'erro', tentativas: 2, arquivo: 'v.mp4', canal: 'lives3' });
    expect(a[0].erro).toContain('quota excedida');
    const b = itensJson([{ video_id: 'abc', titulo: 'T', status: 'feito', redes: ['tiktok', 'instagram'] }])!;
    expect(b[0]).toMatchObject({ id: 'abc', estado: 'feito', canal: 'tiktok+instagram', erro: null });
    expect(itensJson({ nada: 1 })).toBeNull();
  });

  it('txt das aventuras e marcadores PUBLICAR_PENDENTE', () => {
    expect(itensTxt('# c\n/x/memorias-a\n\n/x/memorias-b\n').map((i) => i.id)).toEqual(['memorias-a', 'memorias-b']);
    const raiz = mkdtempSync(join(tmpdir(), 'proj-'));
    mkdirSync(join(raiz, 'contaviral/edicoes/2026-11-01-x'), { recursive: true });
    writeFileSync(join(raiz, 'contaviral/edicoes/2026-11-01-x/PUBLICAR_PENDENTE.video-longo'), '');
    writeFileSync(join(raiz, 'contaviral/edicoes/2026-11-01-x/PUBLICAR_PENDENTE.video.feito'), '');
    const m = itensMarcadores(raiz, Date.now() / 1000);
    expect(m.find((i) => i.id.endsWith('video-longo'))?.estado).toBe('pendente');
    expect(m.find((i) => i.id.endsWith('/video'))?.estado).toBe('feito');
  });

  it('continua vazio vira problema (não "nenhuma espera")', () => {
    const d = mkdtempSync(join(tmpdir(), 'cont-'));
    writeFileSync(join(d, 'e.json'), '');
    expect(itensContinua(join(d, 'e.json')).problema).toMatch(/VAZIO/);
    writeFileSync(join(d, 'e.json'), JSON.stringify({ a: { estado: 'esperando', desde: '2026-11-10 00:24', msg: 4035 } }));
    const r = itensContinua(join(d, 'e.json'));
    expect(r.problema).toBeNull();
    expect(r.itens[0]).toMatchObject({ id: 'a', estado: 'pendente', canal: 'v3 msg 4035' });
  });

  it('coletarFilas: abertos primeiro, só 5 feitos, arquivo ausente vira problema', () => {
    const casa = mkdtempSync(join(tmpdir(), 'casa-'));
    const c = caminhosPadrao(casa, casa);
    mkdirSync(join(casa, 'projetos/r7ex/fila'), { recursive: true });
    const itens = [...Array.from({ length: 8 }, (_, i) => ({ id: 'f' + i, estado: 'feito', quando: `2026-11-0${i + 1}T10:00` })), { id: 'p', estado: 'pendente' }, { id: 'e', estado: 'erro', erro: 'x' }];
    writeFileSync(c.filaR7ex, JSON.stringify(itens));
    const d = { versao: 't', caminhos: c, exec: async () => ({ ok: false, stdout: '', stderr: '', codigo: null }), agora: () => Date.now() / 1000, cache: new Cache(), concorrenciaV3: {}, fetch: globalThis.fetch, sitesLigado: false } as DepsPainel;
    const fs = coletarFilas(d);
    const r = fs.find((f) => f.chave === 'r7ex')!;
    expect(r.total).toBe(10);
    expect(r.itens.map((i) => i.id).slice(0, 2)).toEqual(['e', 'p']);
    expect(r.itens.length).toBe(7);
    expect(r.itens[2].id).toBe('f7');
    expect(fs.find((f) => f.chave === 'espanhol')!.problema).toBeTruthy();
  });
});
