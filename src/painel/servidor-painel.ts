// Servidor do painel em porta PRÓPRIA (PAINEL_PORT, padrão 3143), separado da
// 3142 — a 3142 tem o POST /mensagem (agente com permissão total) e NUNCA sai
// do loopback. Aqui só existem: /login, /logout, / e /painel, /api/painel*,
// POST /api/vagas. Qualquer outra rota → 404.
// Autenticação: sessão por senha (cookie HttpOnly, 365 dias deslizante: o aparelho
// fica lembrado) ou JWT do Cloudflare Access.
// Fora do loopback só sobe com senha definida.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { painelEmCache, tratarPainel } from './http-painel.js';
import { mudarVagas } from './fontes/vagas.js';
import { PAINEL_HTML } from './tela/pagina.js';
import type { DepsPainel } from './tipos.js';
import type { VerificadorAccess } from './auth/cf-access.js';
import { paginaLogin } from './auth/login-pagina.js';
import { arquivoSenha, conferirSenha, lerHash } from './auth/senha.js';
import { COOKIE, Limitador, lerCookie, Sessoes, VALIDADE_S } from './auth/sessoes.js';

export interface OpcoesServidor {
  deps: DepsPainel;
  sessoes: Sessoes;
  limitador?: Limitador;
  access?: VerificadorAccess | null;
  arqSenha?: string;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
export const ehLoopback = (h: string | undefined) => !!h && LOOPBACK.has(h);

/** Endereço que o servidor do painel pode usar: fora do loopback só com senha. */
export function bindEfetivo(pedido: string | undefined, temSenha: boolean): { bind: string; recusado: boolean } {
  const b = pedido?.trim() || '127.0.0.1';
  if (ehLoopback(b)) return { bind: b, recusado: false };
  return temSenha ? { bind: b, recusado: false } : { bind: '127.0.0.1', recusado: true };
}

const CSP = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com', "img-src 'self' https://i.ytimg.com data:", "connect-src 'self'",
  "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'",
].join('; ');

function seguranca(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // same-origin, não no-referrer: com no-referrer o navegador manda `Origin: null` no POST do
  // formulário e a checagem de origem recusava o próprio login (visto no teste com navegador).
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function html(res: ServerResponse, status: number, corpo: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(corpo);
}
function ir(res: ServerResponse, para: string, extra: Record<string, string> = {}): void {
  res.writeHead(303, { Location: para, ...extra }); res.end();
}

function corpo(req: IncomingMessage, max = 4096): Promise<string> {
  return new Promise((ok, erro) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > max) { erro(new Error('grande')); req.destroy(); } });
    req.on('end', () => ok(s)); req.on('error', erro);
  });
}

/** IP do cliente; cabeçalhos do túnel só valem quando a conexão vem do próprio loopback. */
export function ipCliente(req: IncomingMessage): string {
  const r = req.socket.remoteAddress ?? '?';
  if (!ehLoopback(r)) return r;
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return r;
}

const viaHttps = (req: IncomingMessage) => ehLoopback(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https';

/** Origin (se veio) tem de ser o próprio host. */
function mesmaOrigem(req: IncomingMessage): boolean {
  const o = req.headers.origin;
  if (o) { try { return new URL(o).host === req.headers.host; } catch { return false; } }
  const sfs = req.headers['sec-fetch-site'];
  return !sfs || sfs === 'same-origin' || sfs === 'none';
}

export function criarServidorPainel(o: OpcoesServidor): Server {
  const lim = o.limitador ?? new Limitador();
  const arq = o.arqSenha ?? arquivoSenha();

  const cookieSessao = (req: IncomingMessage, tok: string, maxAge = VALIDADE_S) =>
    `${COOKIE}=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${viaHttps(req) ? '; Secure' : ''}`;

  /** Quem está pedindo. Com `res`, a sessão renovada (1×/dia) regrava o cookie por mais 365 dias. */
  const autenticado = async (req: IncomingMessage, res?: ServerResponse): Promise<{ via: string; email?: string; aparelhos?: number } | null> => {
    if (o.access) {
      const jwt = req.headers['cf-access-jwt-assertion'];
      const email = await o.access.conferir(typeof jwt === 'string' ? jwt : undefined);
      if (email) return { via: 'google', email };
    }
    const h = lerHash(arq);
    if (!h) return null;
    const tok = lerCookie(req.headers.cookie, COOKIE);
    const c = o.sessoes.conferir(tok, h.salt);
    if (!c.ok || !tok) return null;
    if (c.renovar && res) res.setHeader('Set-Cookie', cookieSessao(req, tok));
    return { via: 'senha', aparelhos: o.sessoes.contar(h.salt) };
  };

  return createServer(async (req, res) => {
    seguranca(res);
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    const m = req.method ?? 'GET';
    try {
      if (p === '/login') {
        const h = lerHash(arq);
        if (m === 'GET') {
          if (await autenticado(req)) { ir(res, '/painel'); return; }
          html(res, h ? 200 : 503, paginaLogin({ semSenha: !h, google: !!o.access })); return;
        }
        if (m !== 'POST') { json(res, 405, { erro: 'método' }); return; }
        if (!mesmaOrigem(req)) { html(res, 403, paginaLogin({ mensagem: 'Pedido de outra origem recusado.', erro: true })); return; }
        if (!h) { html(res, 503, paginaLogin({ semSenha: true })); return; }
        const ip = ipCliente(req);
        const falta = lim.bloqueado(ip);
        if (falta) { res.setHeader('Retry-After', String(falta)); html(res, 429, paginaLogin({ mensagem: `Muitas tentativas erradas. Tente de novo em ${Math.ceil(falta / 60)} min.`, erro: true })); return; }
        let senha = '';
        try { senha = new URLSearchParams(await corpo(req)).get('senha') ?? ''; } catch { json(res, 413, { erro: 'grande' }); return; }
        if (!(await conferirSenha(senha, h))) {
          lim.errou(ip);
          html(res, 401, paginaLogin({ mensagem: 'Senha errada.', erro: true, google: !!o.access })); return;
        }
        lim.acertou(ip);
        ir(res, '/painel', { 'Set-Cookie': cookieSessao(req, o.sessoes.criar(h.salt)) }); return;
      }
      if (p === '/logout') {
        // Sair deste aparelho; com ?todos=1, sair de todos (exige sessão válida: um estranho não derruba as suas).
        if (m !== 'POST') { json(res, 405, { erro: 'use POST' }); return; }
        if (!mesmaOrigem(req)) { json(res, 403, { erro: 'origem' }); return; }
        if (url.searchParams.get('todos') === '1') {
          if (!(await autenticado(req))) { ir(res, '/login'); return; }
          o.sessoes.encerrarTodas();
        } else o.sessoes.encerrar(lerCookie(req.headers.cookie, COOKIE));
        ir(res, '/login', { 'Set-Cookie': cookieSessao(req, '', 0) }); return;
      }

      const ehTela = (p === '/' || p === '/painel') && m === 'GET';
      const ehApi = (p === '/api/painel' || p.startsWith('/api/painel/')) && m === 'GET';
      const ehVagas = p === '/api/vagas';
      if (!ehTela && !ehApi && !ehVagas) { json(res, 404, { erro: 'rota' }); return; }

      const quem = await autenticado(req, res);
      if (!quem) {
        if (ehTela) { ir(res, '/login'); return; }
        json(res, 401, { erro: 'entre no painel', login: true }); return;
      }
      if (ehTela) { html(res, 200, PAINEL_HTML); return; }
      if (ehVagas) {
        if (m !== 'POST') { json(res, 405, { erro: 'use POST' }); return; }
        if (req.headers['x-painel'] !== '1' || !mesmaOrigem(req)) { json(res, 403, { erro: 'pedido sem a marca do painel (CSRF)' }); return; }
        let bruto = '';
        try { bruto = await corpo(req); } catch { json(res, 413, { erro: 'grande' }); return; }
        const r = await mudarVagas(o.deps, undefined, bruto, true);
        json(res, r.status, r.corpo); return;
      }
      if (p === '/api/painel') { json(res, 200, { ...(await painelEmCache(o.deps)), sessao: quem }); return; }
      if (!(await tratarPainel(req, res, url, o.deps))) json(res, 404, { erro: 'rota' });
    } catch (e) {
      json(res, 500, { erro: (e as Error).message });
    }
  });
}

/** Sobe o servidor do painel; erro de porta só vira log (nunca derruba o bot). */
export function ligarServidorPainel(o: OpcoesServidor, porta: number, bindPedido: string | undefined, log: (m: string) => void): Server {
  const temSenha = !!lerHash(o.arqSenha ?? arquivoSenha());
  const { bind, recusado } = bindEfetivo(bindPedido, temSenha);
  if (recusado) log(`[painel] PAINEL_BIND=${bindPedido} recusado: sem senha definida (npm run painel-senha) — ficando em 127.0.0.1`);
  const srv = criarServidorPainel(o);
  srv.on('error', (e) => log(`[painel] servidor do painel não subiu na porta ${porta}: ${(e as Error).message}`));
  srv.listen(porta, bind, () => log(`[painel] ouvindo em ${bind}:${porta} (${temSenha ? 'com senha' : 'sem senha definida'}${o.access ? ', Cloudflare Access ligado' : ''})`));
  return srv;
}
