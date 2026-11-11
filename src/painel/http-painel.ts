// Rotas do painel. Chamado pelo `http.ts` DEPOIS do portão de token que já
// existe (não mexe nele) e pelo servidor de teste isolado (`src/cli/painel-teste.ts`).
//   GET  /painel                     tela (HTML/CSS/JS inline)
//   GET  /jarvis                     mesma leitura no visual JARVIS (núcleo, voz, bom dia)
//   GET  /api/painel                 todos os grupos + alertas
//   GET  /api/painel/<grupo>         um grupo
//   GET  /api/painel/terminal?id=&n= conversa de uma sessão registrada, só leitura
//   GET  /api/painel/falha?bot=&id=  resultado completo de uma falha (aberto no clique)
//   POST /api/vagas {classe, valor}  única escrita: exige Bearer SEMPRE (sem token = 403)
import { conversaLigada } from './conversa.js';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { montarPainel, type Painel } from './agregador.js';
import { falhaCompletaAccbot, falhaCompletaV3 } from './fontes/bots.js';
import { acharTranscript, lerConversa, SID } from './fontes/sessoes.js';
import { enviarAoPane, paneDoId, telaDoPane } from './fontes/assumir.js';
import { lerFim } from './util.js';
import { mudarVagas } from './fontes/vagas.js';
import { JARVIS_HTML } from './tela/jarvis.js';
import { PAINEL_HTML } from './tela/pagina.js';
import type { DepsPainel } from './tipos.js';

const GRUPOS = new Set(['maquina', 'bots', 'producao', 'publicacao', 'creditos', 'sites', 'vagas', 'radar', 'terminais', 'esperando']);

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

/** Envio do Assumir: acha o pane pelo id do corpo e digita. Usado pela 3142 e pela 3143. */
export async function enviarComId(d: DepsPainel, bruto: string, quem: string) {
  let id = '';
  try { id = String((JSON.parse(bruto || '{}') as { id?: unknown }).id ?? ''); } catch { return { status: 400, corpo: { erro: 'JSON inválido' } }; }
  if (!SID.test(id)) return { status: 400, corpo: { erro: 'id inválido' } };
  const pane = paneDoId((await painelEmCache(d)).grupos.terminais.dados?.vivos ?? [], id);
  if (!pane) return { status: 404, corpo: { erro: 'esta sessão não está no tmux (abra com cct)' } };
  return enviarAoPane(d, pane, bruto, quem, id);
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
  if (p === '/jarvis' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JARVIS_HTML);
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
  if (p === '/api/painel/chat' && req.method === 'GET') {
    json(res, 200, { ligado: conversaLigada() && !!d.conversa, msgs: d.conversa ? d.conversa.desde(Number(url.searchParams.get('desde')) || 0) : [] });
    return true;
  }
  if (p === '/api/painel/terminal/tela' || p === '/api/painel/terminal/enviar') {
    // Tela ao vivo e Assumir: só sessões abertas com `cct` (tmux "inema"). Ver: GET. Digitar: POST
    // (na 3142 exige o Bearer; a 3143 trata o POST antes, com sessão + CSRF).
    const id = (p.endsWith('/tela') ? url.searchParams.get('id') : null) ?? '';
    if (p.endsWith('/enviar')) {
      if (req.method !== 'POST') { json(res, 405, { erro: 'use POST' }); return true; }
      if (!d.token || req.headers.authorization !== `Bearer ${d.token}`) { json(res, 401, { erro: 'token Bearer obrigatório' }); return true; }
      let bruto = '';
      try { bruto = await corpo(req, 8192); } catch { json(res, 413, { erro: 'corpo grande demais' }); return true; }
      const r = await enviarComId(d, bruto, 'token:3142');
      json(res, r.status, r.corpo); return true;
    }
    const pane = paneDoId((await painelEmCache(d)).grupos.terminais.dados?.vivos ?? [], id);
    if (!pane) { json(res, 404, { erro: 'esta sessão não está no tmux (abra com cct)' }); return true; }
    const r = await telaDoPane(d, pane);
    json(res, r.status, r.corpo); return true;
  }
  if (p === '/api/painel/terminal') {
    // Conversa de uma sessão registrada, SÓ LEITURA (últimas mensagens, segredos mascarados).
    const id = url.searchParams.get('id') ?? '';
    const n = Math.min(300, Math.max(10, Number(url.searchParams.get('n')) || 80));
    if (!SID.test(id)) { json(res, 400, { erro: 'id inválido' }); return true; }
    const painel = await painelEmCache(d);
    const t = painel.grupos.terminais.dados;
    const conhecida = [...(t?.vivos ?? []), ...(t?.interrompidos ?? [])].some((s) => s.session_id === id);
    if (!conhecida) { json(res, 404, { erro: 'sessão não registrada' }); return true; }
    const arq = acharTranscript(d.caminhos.claudeProjetos, id);
    if (!arq) { json(res, 404, { erro: 'conversa não encontrada' }); return true; }
    json(res, 200, { id, mensagens: lerConversa(lerFim(arq, 1_500_000) ?? '', n) });
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
