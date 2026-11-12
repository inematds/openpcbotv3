import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { coletarTendencias } from './fontes/tendencias.js';
import { servirBombando } from './http-painel.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';

const EXEMPLO = {
  gerado_em: '2026-11-12T10:15:00+00:00',
  nichos: ['claude code', 'chatgpt'],
  rodada: { erros: ['x'] },
  assuntos: { geral: [{ termo: 'claude', peso: 17065.4 }, { termo: 'fable', peso: 13626 }] },
  porque: { geral: { conclusao: 'No geral, 56% das views vêm de vídeos com 3× o normal.' } },
  videos: [
    { id: 'aaa', titulo: 'A', canal: 'Canal A', views: 1000, velocidade: 10, nichos: ['claude code'], notas: { 'claude code': 1 } },
    { id: 'bbb', titulo: 'B', canal: 'Canal B', views: 5000, velocidade: 50, nichos: ['claude code', 'chatgpt'], notas: { 'claude code': 3, chatgpt: 0.5 } },
    { id: 'ccc', titulo: 'C', canal: 'Canal C', views: 9000, velocidade: 90, indisponivel: 1, nichos: ['chatgpt'], notas: { chatgpt: 9 } },
  ],
};

function pasta(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bombando-'));
  writeFileSync(join(dir, 'dados.json'), JSON.stringify(EXEMPLO));
  writeFileSync(join(dir, 'index.html'), '<h1>YouTube bombando</h1>');
  mkdirSync(join(dir, 'historico'));
  writeFileSync(join(dir, 'historico', '2026-11-12.html'), 'dia');
  return dir;
}

function deps(dir: string): DepsPainel {
  return { caminhos: { ...caminhosPadrao(dir, dir), bombando: dir }, agora: () => 1_794_000_000 } as unknown as DepsPainel;
}

function resposta() {
  const r = { status: 0, headers: {} as Record<string, string>, corpo: '' };
  const res = {
    writeHead(s: number, h: Record<string, string>) { r.status = s; r.headers = h ?? {}; return res; },
    end(c?: unknown) { r.corpo = c == null ? '' : String(c); },
  } as unknown as ServerResponse;
  return { r, res };
}

describe('tendências de rede (youtube-bombando)', () => {
  it('resume o dados.json: vídeos, erros, assuntos, conclusão e o mais quente de cada nicho (sem indisponível)', () => {
    const { dados, ausentes } = coletarTendencias(deps(pasta()));
    expect(ausentes).toEqual([]);
    expect(dados.videos).toBe(3);
    expect(dados.erros).toBe(1);
    expect(dados.assuntos.map((t) => t.termo)).toEqual(['claude', 'fable']);
    expect(dados.conclusao).toContain('56%');
    expect(dados.quentes.map((q) => [q.nicho, q.id])).toEqual([['claude code', 'bbb'], ['chatgpt', 'bbb']]);
    expect(dados.link).toBe('/bombando/');
  });

  it('sem arquivo: vazio e ausente marcado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bombando-vazio-'));
    const { dados, ausentes } = coletarTendencias(deps(dir));
    expect(dados.videos).toBe(0);
    expect(ausentes.length).toBe(1);
  });

  it('serve só index, dados.json e histórico; recusa caminho livre', () => {
    const dir = pasta();
    const casos: [string, number][] = [
      ['/bombando/', 200], ['/bombando/index.html', 200], ['/bombando/dados.json', 200],
      ['/bombando/historico/2026-11-12.html', 200], ['/bombando/../tipos.ts', 404],
      ['/bombando/historico/../../x', 404], ['/bombando/.env', 404],
    ];
    for (const [p, st] of casos) {
      const { r, res } = resposta();
      servirBombando(res, p, dir);
      expect([p, r.status]).toEqual([p, st]);
    }
    const { r, res } = resposta();
    servirBombando(res, '/bombando', dir);
    expect(r.status).toBe(302);
    expect(r.headers.Location).toBe('/bombando/');
  });
});
