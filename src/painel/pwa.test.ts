import { describe, expect, it } from 'vitest';

import { MANIFESTO, PWA_HEAD, tratarPwa } from './pwa.js';
import { PAINEL_HTML } from './tela/pagina.js';
import { JARVIS_HTML } from './tela/jarvis.js';

const resFalsa = () => { const r = { status: 0, headers: {} as Record<string, string>, corpo: null as unknown, writeHead(s: number, h: Record<string, string>) { r.status = s; r.headers = h ?? {}; }, end(b?: unknown) { r.corpo = b ?? null; } }; return r; };

describe('painel instalável (PWA)', () => {
  it('manifesto com ícones 192/512 e maskable, standalone, início em /', () => {
    expect(MANIFESTO.display).toBe('standalone');
    expect(MANIFESTO.start_url).toBe('/');
    expect(MANIFESTO.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
  });
  it('serve manifesto, sw.js e ícone; outras rotas seguem adiante', () => {
    const m = resFalsa(); expect(tratarPwa('/manifest.webmanifest', m as never)).toBe(true); expect(m.headers['Content-Type']).toContain('manifest+json');
    const s = resFalsa(); expect(tratarPwa('/sw.js', s as never)).toBe(true); expect(String(s.corpo)).toContain("addEventListener('fetch'");
    const i = resFalsa(); expect(tratarPwa('/icone-192.png', i as never)).toBe(true); expect(i.status).toBe(200); expect((i.corpo as Buffer).length).toBeGreaterThan(1000);
    expect(tratarPwa('/api/painel', resFalsa() as never)).toBe(false);
  });
  it('painel e Jarvis trazem o manifesto no head', () => {
    expect(PAINEL_HTML).toContain(PWA_HEAD);
    expect(JARVIS_HTML).toContain('rel="manifest"');
  });
});
