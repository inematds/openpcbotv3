// Slack via Web API (fetch, sem SDK). DESLIGADO por padrão: o v2 ainda é dono
// do token de usuário; dois pollers duplicariam respostas. Liga com
// SLACK_ENABLED=1 depois do corte. Também faz o probe de OAuth (auth.test).
import type { Bus } from '../bus/bus.js';
import { novoTraceId } from '../bus/bus.js';

export interface OpcoesSlack {
  token: string | undefined;
  canais: string[];
  bus: Bus;
  log: (m: string) => void;
  agora: () => number;
  fetchFn?: typeof fetch;
}

export async function probeOAuthSlack(token: string | undefined, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; erro?: string; user?: string }> {
  if (!token) return { ok: false, erro: 'sem SLACK_USER_TOKEN' };
  try {
    const r = await fetchFn('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const d = (await r.json()) as { ok: boolean; error?: string; user?: string };
    return d.ok ? { ok: true, user: d.user } : { ok: false, erro: d.error };
  } catch (e) { return { ok: false, erro: (e as Error).message }; }
}

export function ligarSlack(o: OpcoesSlack): () => void {
  const f = o.fetchFn ?? fetch;
  if (!o.token) { o.log('[slack] sem token — desligado'); return () => {}; }
  const visto = new Set<string>();
  let desde = String(o.agora());
  const puxar = async (): Promise<void> => {
    for (const canal of o.canais) {
      try {
        const r = await f(`https://slack.com/api/conversations.history?channel=${canal}&oldest=${desde}&limit=20`, { headers: { Authorization: `Bearer ${o.token}` }, signal: AbortSignal.timeout(15_000) });
        const d = (await r.json()) as { ok: boolean; messages?: { ts: string; text: string; user?: string; bot_id?: string }[] };
        for (const m of (d.messages ?? []).reverse()) {
          if (m.bot_id || visto.has(m.ts)) continue;
          visto.add(m.ts);
          o.bus.emit('mensagem.recebida', { canal: 'slack', chatId: canal, texto: m.text, usuario: m.user, ref: m.ts, traceId: novoTraceId(), recebidaEm: o.agora() });
        }
      } catch (e) { o.log(`[slack] history ${canal}: ${(e as Error).message}`); }
    }
    desde = String(o.agora() - 60);
  };
  const timer = setInterval(() => { void puxar(); }, 15_000);
  timer.unref?.();
  const off = o.bus.on('mensagem.enviar', async (m) => {
    if (m.canal !== 'slack') return;
    try {
      await f('https://slack.com/api/chat.postMessage', {
        method: 'POST', headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: m.chatId, text: m.texto, ...(m.ref ? { thread_ts: m.ref } : {}) }), signal: AbortSignal.timeout(15_000),
      });
    } catch (e) { o.log(`[slack] post: ${(e as Error).message}`); }
  });
  o.log(`[slack] ligado em ${o.canais.length} canal(is)`);
  return () => { clearInterval(timer); off(); };
}
