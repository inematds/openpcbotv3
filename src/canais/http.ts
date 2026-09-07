// HTTP na porta própria (3142): GET /health (o hub `wifi` consome), GET /status,
// GET /api/* (dashboard), GET / (dashboard HTML), POST /mensagem (canal http:
// texto entra no bus, resposta volta na mesma requisição). Token opcional
// via `DASHBOARD_TOKEN_V3` para tudo que não é /health.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { App } from '../app.js';
import { novoTraceId } from '../bus/bus.js';
import { FILAS } from '../fila/filas.js';
import { rssMb } from '../ollama/ram.js';
import { DASHBOARD_HTML } from '../dashboard/html.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function corpo(req: IncomingMessage, max = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > max) { reject(new Error('corpo grande demais')); req.destroy(); } });
    req.on('end', () => resolve(s)); req.on('error', reject);
  });
}

export function montarHealth(app: App): Record<string, unknown> {
  const e = app.ollama.estado;
  const hb = app.heartbeat.ultimo();
  const fila = Object.fromEntries(FILAS.map((f) => [f, { queued: app.fila.listar({ fila: f, status: 'queued' }).length, running: app.fila.listar({ fila: f, status: 'running' }).length }]));
  const orc = app.orcamento.avaliar('barato');
  const ok = (e?.online ?? false) && (e?.ram.disponivelGb ?? 0) >= 10 && (!hb || app.agora() - hb.ultimo_em < 3 * 1800);
  return {
    ok, versao: app.cfg.versao, instancia: app.cfg.instancia, uptime_s: app.agora() - app.iniciadoEm, rss_mb: rssMb(),
    canais: app.canaisAtivos, fila,
    ollama: e ? { online: e.online, carregados: e.carregados.map((m) => ({ nome: m.name, gb: Math.round(m.size / 1e9) })), latencia_ms: e.latenciaMs, probe_em: e.probeEm, erro: e.erro } : null,
    ram: e?.ram ?? null,
    heartbeat: hb ? { ultimo_em: hb.ultimo_em, ha_s: app.agora() - hb.ultimo_em } : null,
    orcamento: { pct: orc.pct, gasto_usd: orc.gastoUsd, limite_usd: orc.limiteUsd, travado: !orc.permitido },
  };
}

export function ligarHttp(app: App): Server {
  const token = process.env.DASHBOARD_TOKEN_V3;
  const autorizado = (req: IncomingMessage, url: URL): boolean => {
    if (!token) return true;
    const h = req.headers.authorization;
    return h === `Bearer ${token}` || url.searchParams.get('token') === token;
  };

  const srv = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (url.pathname === '/health') { const h = montarHealth(app); json(res, h.ok ? 200 : 503, h); return; }
      if (!autorizado(req, url)) { json(res, 401, { erro: 'token' }); return; }

      if (url.pathname === '/' || url.pathname === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(DASHBOARD_HTML); return;
      }
      if (url.pathname === '/status' || url.pathname === '/api/fila') {
        json(res, 200, { lanes: FILAS.map((f) => ({ lane: f, queued: app.fila.listar({ fila: f, status: 'queued' }).length, running: app.fila.listar({ fila: f, status: 'running' }).length })), recentes: app.fila.listar({ limite: 30 }).map((j) => ({ ...j, input: undefined, resultado: j.resultado?.slice(0, 200) })) });
        return;
      }
      if (url.pathname === '/api/custo') {
        const desde = app.agora() - 30 * 86400;
        json(res, 200, { hoje: app.registro.hoje(), semana: app.registro.semana(), mes: app.registro.mes(), porDia: app.registro.porDia(14), porAgente: app.registro.porAgente(desde), porTier: app.registro.porTier(desde), orcamento: app.orcamento.avaliar('barato') });
        return;
      }
      if (url.pathname === '/api/memoria') {
        const chat = url.searchParams.get('chat') ?? app.cfg.chatPermitido ?? 'cli';
        json(res, 200, { contagem: app.cerebro.contagem(chat), importantes: app.cerebro.importantes(chat, 10), recentes: app.cerebro.recentes(chat, 10), insights: app.cerebro.insights(chat, 5), propostas: app.vault.pendentes(chat) });
        return;
      }
      if (url.pathname === '/api/ollama') { json(res, 200, app.ollama.estado ?? (await app.ollama.probe())); return; }
      if (url.pathname === '/api/cron') { json(res, 200, app.cron.listar()); return; }
      if (url.pathname === '/api/health') { json(res, 200, montarHealth(app)); return; }

      if (url.pathname === '/mensagem' && req.method === 'POST') {
        const b = JSON.parse((await corpo(req)) || '{}') as { texto?: string; chatId?: string };
        if (!b.texto) { json(res, 400, { erro: 'texto obrigatório' }); return; }
        const chatId = b.chatId ?? 'http';
        const traceId = novoTraceId();
        const respostas: string[] = [];
        const off = app.bus.on('mensagem.enviar', (m) => { if (m.canal === 'http' && m.chatId === chatId) respostas.push(m.texto); });
        app.bus.emit('mensagem.recebida', { canal: 'http', chatId, texto: b.texto, traceId, recebidaEm: app.agora() });
        // Espera até 3 min pela primeira resposta (resposta direta); jobs de agente respondem com o número do job.
        const t0 = Date.now();
        while (!respostas.length && Date.now() - t0 < 180_000) await new Promise((r) => setTimeout(r, 200));
        off();
        json(res, 200, { traceId, respostas });
        return;
      }
      json(res, 404, { erro: 'rota' });
    } catch (e) {
      json(res, 500, { erro: (e as Error).message });
    }
  });
  // Loopback por padrão: /mensagem leva a um `claude -p --dangerously-skip-permissions`.
  // O hub `wifi` roda nesta máquina, então /health continua alcançável. Expor na
  // LAN exige HTTP_BIND_V3=0.0.0.0 E DASHBOARD_TOKEN_V3 definido.
  const bind = process.env.HTTP_BIND_V3 || '127.0.0.1';
  if (bind !== '127.0.0.1' && bind !== 'localhost' && !token) {
    app.log('[http] HTTP_BIND_V3 fora do loopback sem DASHBOARD_TOKEN_V3 — recusado, ficando em 127.0.0.1');
  }
  const bindFinal = (bind !== '127.0.0.1' && bind !== 'localhost' && !token) ? '127.0.0.1' : bind;
  srv.listen(app.cfg.porta, bindFinal, () => app.log(`[http] ouvindo em ${bindFinal}:${app.cfg.porta}`));
  return srv;
}
