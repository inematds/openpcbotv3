// WhatsApp pela Evolution API v2 (3.35.17). Substitui o plano antigo do
// whatsapp-web.js: a Evolution roda em Docker (evolution/docker-compose.yml),
// separada do bot, e reinicia sozinha. Entrada = webhook num ouvinte PRÓPRIO
// (porta 3144 no gateway da rede docker, nunca a 3142); saída = REST sendText.
// Fase 1: só a conversa "eu comigo" do Nei entra e só ela recebe resposta
// (ver whatsapp-filtro.ts). Nada de contato/grupo é logado — só contagem por motivo.
import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import type { Bus } from '../bus/bus.js';
import { novoTraceId } from '../bus/bus.js';
import { extrairEnvios } from './arquivos.js';
import { fatiar } from './telegram.js';
import { decidir, Memoria, normalizarJid, podeEnviar, PREFIXO_BOT, type EstadoFiltro, type Motivo } from './whatsapp-filtro.js';

export interface OpcoesWhatsApp {
  ativo: boolean;
  /** O v2 está usando o WhatsApp (WHATSAPP_ENABLED ligado no .env dele)? */
  v2UsaWhatsApp: () => boolean;
  bus: Bus;
  log: (m: string) => void;
  agora: () => number;
  env?: NodeJS.ProcessEnv;
  /** Para testes: troca o fetch. */
  buscar?: typeof fetch;
}

export interface WhatsAppLigado { ligado: boolean; motivo: string; parar: () => void; estado?: EstadoFiltro; servidor?: Server }

/** O v2 só disputa o número se o WHATSAPP_ENABLED dele estiver ligado (hoje está comentado). */
export function v2UsaWhatsApp(arquivo = resolve(homedir(), 'projetos/openpcbotv2/.env')): boolean {
  if (!existsSync(arquivo)) return false;
  return readFileSync(arquivo, 'utf8').split('\n').some((l) => /^\s*WHATSAPP_ENABLED\s*=\s*['"]?(1|true|yes)['"]?\s*$/i.test(l));
}

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Origem aceita no ouvinte: loopback ou a rede docker da Evolution. */
export function origemOk(ip: string | undefined): boolean {
  const s = (ip ?? '').replace(/^::ffff:/, '');
  return s === '127.0.0.1' || s.startsWith('10.95.31.');
}

export function ligarWhatsApp(o: OpcoesWhatsApp): WhatsAppLigado {
  const nada = { parar: () => {} };
  if (!o.ativo) return { ligado: false, motivo: 'WHATSAPP_ENABLED != 1', ...nada };
  if (o.v2UsaWhatsApp()) {
    o.log('[whatsapp] recusado: o v2 está com WHATSAPP_ENABLED ligado (um número, um dono)');
    return { ligado: false, motivo: 'v2 usa o WhatsApp', ...nada };
  }
  const env = o.env ?? process.env;
  const url = (env.EVOLUTION_URL ?? '').replace(/\/$/, '');
  const chave = env.EVOLUTION_API_KEY ?? '';
  const inst = env.EVOLUTION_INSTANCIA ?? '';
  const segredo = env.WHATSAPP_WEBHOOK_SEGREDO ?? '';
  if (!url || !chave || !inst || segredo.length < 16) {
    return { ligado: false, motivo: 'faltam EVOLUTION_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCIA/WHATSAPP_WEBHOOK_SEGREDO', ...nada };
  }
  const buscar = o.buscar ?? fetch;
  const cab = { apikey: chave, 'Content-Type': 'application/json' };
  const est: EstadoFiltro = { dono: new Set(), enviados: new Memoria(), vistos: new Memoria() };
  for (const j of (env.WHATSAPP_DONO_IDS ?? '').split(',')) { const n = normalizarJid(j.trim()); if (n) est.dono.add(n); }

  // Número do dono = ownerJid da instância (depois do QR). Até lá, nada passa.
  let avisouSemDono = false;
  const atualizarDono = async (): Promise<void> => {
    try {
      const r = await buscar(`${url}/instance/fetchInstances?instanceName=${encodeURIComponent(inst)}`, { headers: cab });
      if (!r.ok) return;
      const lista = (await r.json()) as { ownerJid?: string; connectionStatus?: string }[];
      const dono = normalizarJid(lista?.[0]?.ownerJid);
      if (dono && !est.dono.has(dono)) { est.dono.add(dono); o.log(`[whatsapp] conectado; comandos só na conversa "eu comigo" (${dono.split('@')[0].slice(0, 4)}…)`); }
      if (!dono && !avisouSemDono) { avisouSemDono = true; o.log('[whatsapp] instância sem número ainda — falta ler o QR (python3 evolution/evo.py qr)'); }
    } catch { /* Evolution fora: tenta de novo no próximo ciclo */ }
  };
  void atualizarDono();
  const tDono = setInterval(() => { void atualizarDono(); }, 60_000);

  // Contagem por motivo, sem conteúdo; resumo no log a cada 30 min.
  const contagem = new Map<Motivo, number>();
  const tResumo = setInterval(() => {
    if (!contagem.size) return;
    o.log(`[whatsapp] últimos 30 min: ${[...contagem].map(([m, n]) => `${m}=${n}`).join(' ')}`);
    contagem.clear();
  }, 30 * 60_000);

  const rota = `/webhook/evolution/${segredo}`;
  const srv = createServer((req, res) => {
    const fim = (s: number): void => { res.writeHead(s); res.end(); };
    if (req.method !== 'POST' || !origemOk(req.socket.remoteAddress) || !igual(req.url ?? '', rota)) { req.resume(); fim(404); return; }
    let corpo = ''; let grande = false;
    req.on('data', (c) => { if (grande) return; corpo += c; if (corpo.length > 2_000_000) { grande = true; corpo = ''; } });
    req.on('end', () => {
      fim(200);
      if (grande) return;
      let b: unknown; try { b = JSON.parse(corpo); } catch { return; }
      corpo = '';
      const d = decidir(b, est);
      contagem.set(d.motivo, (contagem.get(d.motivo) ?? 0) + 1);
      if (d.motivo === 'dono-desconhecido') void atualizarDono();
      if (!d.aceitar || !d.chatId || !d.texto) return;
      o.bus.emit('mensagem.recebida', { canal: 'whatsapp', chatId: d.chatId, texto: d.texto, usuario: 'nei', titulo: 'WhatsApp (eu comigo)', ref: d.ref, traceId: novoTraceId(), recebidaEm: o.agora() });
    });
  });
  const bind = env.WHATSAPP_WEBHOOK_BIND || '10.95.31.1';
  const porta = Number(env.WHATSAPP_WEBHOOK_PORTA ?? 3144);
  let parado = false; let tBind: NodeJS.Timeout | undefined;
  // O gateway só existe com a rede docker de pé: tenta de novo a cada 30 s.
  srv.on('error', (e) => {
    o.log(`[whatsapp] ouvinte ${bind}:${porta}: ${(e as NodeJS.ErrnoException).code ?? e.message} — tento de novo em 30 s`);
    if (!parado) tBind = setTimeout(() => srv.listen(porta, bind), 30_000);
  });
  srv.listen(porta, bind, () => o.log(`[whatsapp] ouvinte do webhook em ${bind}:${porta}`));

  const off = o.bus.on('mensagem.enviar', async (m) => {
    if (m.canal !== 'whatsapp') return;
    if (!podeEnviar(m.chatId, est.dono)) { o.log('[whatsapp] envio recusado: fase 1 só responde na conversa "eu comigo"'); return; }
    const { texto, envios } = extrairEnvios(m.texto);
    const partes = texto ? fatiar(texto, 3500) : [];
    if (envios.length) partes.push(`(${envios.length} arquivo(s) ficaram no servidor; no WhatsApp a fase 1 só manda texto)`);
    for (const parte of partes) {
      try {
        const r = await buscar(`${url}/message/sendText/${encodeURIComponent(inst)}`, { method: 'POST', headers: cab, body: JSON.stringify({ number: m.chatId.split('@')[0], text: PREFIXO_BOT + parte }) });
        const j = (await r.json().catch(() => ({}))) as { key?: { id?: string } };
        if (j.key?.id) est.enviados.por(j.key.id);
        if (!r.ok) o.log(`[whatsapp] envio falhou: HTTP ${r.status}`);
      } catch (e) { o.log(`[whatsapp] envio falhou: ${(e as Error).message}`); }
    }
  });

  return {
    ligado: true, motivo: `Evolution ${url} instância ${inst}`, estado: est, servidor: srv,
    parar: () => { parado = true; off(); clearInterval(tDono); clearInterval(tResumo); if (tBind) clearTimeout(tBind); srv.close(); },
  };
}
