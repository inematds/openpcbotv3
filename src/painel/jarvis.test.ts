// Versão JARVIS do painel: JS do cliente válido, sem interpolação perdida, e a rota /jarvis.
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { servidorPainel } from './http-painel.js';
import { JARVIS_HTML, JARVIS_JS } from './tela/jarvis.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';
import { Cache } from './util.js';

describe('tela JARVIS', () => {
  it('o JS do cliente compila e não tem crase nem ${ sobrando', () => {
    expect(() => new Function(JARVIS_JS)).not.toThrow();
    expect(JARVIS_JS).not.toContain('`');
    expect(JARVIS_JS).not.toContain('${');
  });

  it('a página lê /api/painel, volta ao clássico e só escreve pelo Assumir e pela conversa (com X-Painel)', () => {
    expect(JARVIS_HTML).toContain("fetch('/api/painel'");
    expect(JARVIS_HTML).toContain('href="/painel"');
    expect(JARVIS_JS).not.toContain('/api/vagas');
    expect(JARVIS_JS.match(/method:'POST'/g)?.length).toBe(2);
    expect(JARVIS_JS).toMatch(/fetch\('\/api\/painel\/chat',\{method:'POST'[^}]*'X-Painel':'1'/);
    expect(JARVIS_JS).toMatch(/fetch\('\/api\/painel\/terminal\/enviar',\{method:'POST'[^}]*'X-Painel':'1'/);
  });

  it('GET /jarvis responde a tela', async () => {
    const d: DepsPainel = { versao: 't', caminhos: caminhosPadrao(tmpdir(), tmpdir()), exec: async () => ({ ok: false, stdout: '', stderr: '', codigo: null }), agora: () => 1, cache: new Cache(), concorrenciaV3: {}, fetch: globalThis.fetch, sitesLigado: false };
    const srv = servidorPainel(d);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const p = (srv.address() as AddressInfo).port;
    const r = await fetch(`http://127.0.0.1:${p}/jarvis`);
    const t = await r.text();
    await new Promise((ok) => srv.close(ok));
    expect(r.status).toBe(200);
    expect(t).toContain('JARVIS · INEMA');
  });
});
