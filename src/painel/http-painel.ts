// Rotas do painel. Chamado pelo `http.ts` DEPOIS do portão de token que já
// existe (não mexe nele) e pelo servidor de teste isolado (`src/cli/painel-teste.ts`).
//   GET  /painel                     tela (HTML/CSS/JS inline)
//   GET  /api/painel                 todos os grupos + alertas
//   GET  /api/painel/<grupo>         um grupo
//   GET  /api/painel/falha?bot=&id=  resultado completo de uma falha (aberto no clique)
//   POST /api/vagas {classe, valor}  única escrita: exige Bearer SEMPRE (sem token = 403)
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { montarPainel, type Painel } from './agregador.js';
import { falhaCompletaAccbot, falhaCompletaV3 } from './fontes/bots.js';
import { mudarVagas } from './fontes/vagas.js';
import { PAINEL_HTML } from './tela/pagina.js';
import type { DepsPainel } from './tipos.js';

const GRUPOS = new Set(['maquina', 'bots', 'producao', 'publicacao', 'creditos', 'sites', 'vagas', 'terminais', 'esperando']);

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function corpo(req: IncomingMessage, max = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > max) { reject(new Error('corpo grande demais')); req.destroy(); } });
    req.on('end', () => resolve(s)); req.on('error', reject);
  });
}

/** Painel inteiro com cache de 5 s (várias telas abertas dividem a mesma coleta). */
export function painelEmCache(d: DepsPainel): Promise<Painel> {
  return d.cache.obter('painel', 5000, () => montarPainel(d));
}

/** Trata as rotas do painel. Devolve `true` se a rota era dele. */
export async function tratarPainel(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsPainel): Promise<boolean> {
  const p = url.pathname;
  if (p === '/painel' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(PAINEL_HTML);
    return true;
  }
  if (p === '/api/vagas') {
    if (req.method !== 'POST') { json(res, 405, { erro: 'use POST' }); return true; }
    let bruto = '';
    try { bruto = await corpo(req); } catch { json(res, 413, { erro: 'corpo grande demais' }); return true; }
    const r = await mudarVagas(d, req.headers.authorization, bruto);
    json(res, r.status, r.corpo);
    return true;
  }
  if (p === '/api/painel/falha') {
    const id = Number(url.searchParams.get('id'));
    const bot = url.searchParams.get('bot');
    if (!Number.isInteger(id) || id < 1) { json(res, 400, { erro: 'id inválido' }); return true; }
    try {
      const f = bot === 'inemaccbot' ? falhaCompletaAccbot(d.caminhos.inemaccbotDb, id) : d.db ? falhaCompletaV3(d.db, id) : null;
      if (f) json(res, 200, f); else json(res, 404, { erro: 'não achei esse job' });
    } catch (e) { json(res, 200, { erro: 'sem dados', detalhe: (e as Error).message }); }
    return true;
  }
  if (p === '/api/painel' || p.startsWith('/api/painel/')) {
    const painel = await painelEmCache(d);
    if (p === '/api/painel') { json(res, 200, painel); return true; }
    const nome = p.slice('/api/painel/'.length);
    if (nome === 'alertas') { json(res, 200, painel.alertas); return true; }
    if (!GRUPOS.has(nome)) { json(res, 404, { erro: 'grupo' }); return true; }
    json(res, 200, painel.grupos[nome as keyof Painel['grupos']]);
    return true;
  }
  return false;
}

/** Servidor SÓ do painel (teste isolado, sem bot nem Telegram). */
export function servidorPainel(d: DepsPainel): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (url.pathname === '/') { res.writeHead(302, { Location: '/painel' }); res.end(); return; }
      if (!(await tratarPainel(req, res, url, d))) json(res, 404, { erro: 'rota' });
    } catch (e) { json(res, 500, { erro: (e as Error).message }); }
  });
}
