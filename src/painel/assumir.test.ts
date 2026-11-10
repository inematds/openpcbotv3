// Assumir (em teste): só com PAINEL_ASSUMIR=1, só teclas da lista, texto + Enter pelo tmux "inema".
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { enviarAoPane, paneDaSessao } from './fontes/assumir.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';
import { Cache } from './util.js';

function deps(chamadas: string[][]): DepsPainel {
  const casa = mkdtempSync(join(tmpdir(), 'assumir-'));
  return { versao: 't', caminhos: caminhosPadrao(casa, casa), exec: async (c, a) => { chamadas.push([c, ...a]); return { ok: true, stdout: '', stderr: '', codigo: 0 }; }, agora: () => 1, cache: new Cache(), concorrenciaV3: {}, fetch: globalThis.fetch, sitesLigado: false };
}

describe('assumir', () => {
  afterEach(() => { delete process.env.PAINEL_ASSUMIR; });

  it('desligado sem PAINEL_ASSUMIR=1', async () => {
    const ch: string[][] = [];
    const r = await enviarAoPane(deps(ch), '%3', JSON.stringify({ texto: 'oi' }), 't', 'abcdefgh');
    expect(r.status).toBe(403);
    expect(ch).toEqual([]);
  });

  it('digita o texto literal e depois Enter; recusa tecla fora da lista', async () => {
    process.env.PAINEL_ASSUMIR = '1';
    const ch: string[][] = [];
    const d = deps(ch);
    expect((await enviarAoPane(d, '%3', JSON.stringify({ texto: 'rm -rf; echo $HOME' }), 't', 'abcdefgh')).status).toBe(200);
    expect(ch[0]).toEqual(['tmux', '-L', 'inema', 'send-keys', '-t', '%3', '-l', '--', 'rm -rf; echo $HOME']);
    expect(ch[1]).toEqual(['tmux', '-L', 'inema', 'send-keys', '-t', '%3', 'Enter']);
    expect((await enviarAoPane(d, '%3', JSON.stringify({ tecla: 'C-d' }), 't', 'abcdefgh')).status).toBe(400);
    expect((await enviarAoPane(d, '%3', JSON.stringify({ tecla: 'Escape' }), 't', 'abcdefgh')).status).toBe(200);
  });

  it('acha o pane pelo processo pai', () => {
    const proc = mkdtempSync(join(tmpdir(), 'proc-'));
    const p = (pid: number, ppid: number) => { mkdirSync(join(proc, String(pid))); writeFileSync(join(proc, String(pid), 'stat'), `${pid} (x) S ${ppid} 0`); };
    p(500, 400); p(400, 300); p(300, 1);
    expect(paneDaSessao(500, [{ pane: '%7', pid: 400 }], proc)).toBe('%7');
    expect(paneDaSessao(500, [{ pane: '%7', pid: 999 }], proc)).toBeNull();
  });
});
