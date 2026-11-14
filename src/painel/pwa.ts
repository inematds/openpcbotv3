// Painel instalável no celular (Nei, 14/11/2026: "no celular poderá ser instalado ou via web também").
// É a MESMA página: só manifesto + ícones + service worker mínimo. O SW não guarda nada em cache (o painel é
// dado ao vivo); sem rede, a navegação mostra uma tela "sem conexão" em vez do erro do Chrome.
// Rotas públicas (sem login): o manifesto, os ícones e o sw.js não têm dado nenhum.
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/painel');
const COR = '#0c0c10';

export const MANIFESTO = {
  name: 'Painel INEMA', short_name: 'Painel INEMA', lang: 'pt-BR',
  description: 'Painel da máquina, bots, produção, INEMA.PRO e portal.',
  start_url: '/', scope: '/', id: '/', display: 'standalone', orientation: 'portrait',
  background_color: COR, theme_color: COR,
  icons: [
    { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icone-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

export const SW_JS = `// Painel INEMA: sem cache (dado ao vivo); só a tela "sem conexão" quando a rede cai.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(function () {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Painel INEMA</title><body style="background:${COR};color:#e7e7ea;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><p style="color:#FACC15;font-weight:700;font-size:1.3rem">Sem conexão com o painel</p><p>Confira a internet e toque para tentar de novo.</p><button onclick="location.reload()" style="margin-top:1rem;padding:.7rem 1.4rem;border-radius:.6rem;border:0;background:#FACC15;color:#0c0c10;font-weight:700">Tentar de novo</button></div>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
`;

/** Tags do <head> (painel, Jarvis e login): manifesto com cookie (fica atrás do Cloudflare/login), ícone e cor. */
export const PWA_HEAD = `<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<meta name="theme-color" content="${COR}"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Painel INEMA"><link rel="icon" href="/icone-192.png"><link rel="apple-touch-icon" href="/icone-180.png">
<script>if('serviceWorker' in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})</script>`;

const ICONES = new Set(['/icone-180.png', '/icone-192.png', '/icone-512.png', '/icone-maskable.png']);
const cacheIcone = new Map<string, Buffer>();

/** Responde as rotas do app instalável; devolve false se não for uma delas. */
export function tratarPwa(p: string, res: ServerResponse): boolean {
  if (p === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(JSON.stringify(MANIFESTO)); return true;
  }
  if (p === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    res.end(SW_JS); return true;
  }
  if (ICONES.has(p)) {
    let b = cacheIcone.get(p);
    if (!b) { try { b = readFileSync(resolve(ASSETS, p.slice(1))); cacheIcone.set(p, b); } catch { res.writeHead(404); res.end(); return true; } }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    res.end(b); return true;
  }
  return false;
}
