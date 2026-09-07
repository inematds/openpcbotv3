// Adaptador Telegram (grammy). Só traduz para/do bus. Guarda: nunca sobe com o
// token do v2 (409 → bot surdo). Só atende o chat permitido.
import { Bot, GrammyError, HttpError } from 'grammy';

import type { Bus } from '../bus/bus.js';
import { novoTraceId } from '../bus/bus.js';
import { validarTokenTelegram } from '../config/env.js';

export interface OpcoesTelegram {
  token: string | undefined;
  chatPermitido: string | undefined;
  bus: Bus;
  log: (m: string) => void;
  agora: () => number;
}

/** Converte markdown simples (*negrito*, `código`) para HTML do Telegram, escapando o resto. */
export function paraHtml(texto: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const partes: string[] = [];
  const re = /```([\s\S]*?)```|`([^`\n]+)`|\*([^*\n]+)\*/g;
  let ultimo = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    partes.push(esc(texto.slice(ultimo, m.index)));
    if (m[1] !== undefined) partes.push(`<pre>${esc(m[1].replace(/^\w*\n/, ''))}</pre>`);
    else if (m[2] !== undefined) partes.push(`<code>${esc(m[2])}</code>`);
    else partes.push(`<b>${esc(m[3])}</b>`);
    ultimo = m.index + m[0].length;
  }
  partes.push(esc(texto.slice(ultimo)));
  return partes.join('');
}

export function fatiar(texto: string, max = 3900): string[] {
  if (texto.length <= max) return [texto];
  const out: string[] = [];
  let resto = texto;
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max / 2) corte = max;
    out.push(resto.slice(0, corte));
    resto = resto.slice(corte);
  }
  if (resto) out.push(resto);
  return out;
}

export async function ligarTelegram(o: OpcoesTelegram): Promise<{ parar: () => Promise<void>; username: string } | null> {
  const v = validarTokenTelegram(o.token);
  if (!v.ok) { o.log(`[telegram] ${v.motivo}`); return null; }
  const bot = new Bot(o.token as string);
  const me = await bot.api.getMe();

  bot.on('message:text', (ctx) => {
    const chatId = String(ctx.chat.id);
    if (o.chatPermitido && chatId !== o.chatPermitido) {
      o.log(`[telegram] ignorado chat ${chatId} (permitido: ${o.chatPermitido})`);
      return;
    }
    o.bus.emit('mensagem.recebida', {
      canal: 'telegram', chatId, texto: ctx.message.text, usuario: ctx.from?.username ?? String(ctx.from?.id ?? ''),
      ref: String(ctx.message.message_id), traceId: novoTraceId(), recebidaEm: o.agora(),
    });
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError && e.error_code === 409) o.log('[telegram] 409 Conflict — outro processo usa este token. NÃO reiniciar em loop; verificar tokens.');
    else if (e instanceof HttpError) o.log(`[telegram] rede: ${e.message}`);
    else o.log(`[telegram] erro: ${(e as Error).message}`);
  });

  const off = o.bus.on('mensagem.enviar', async (m) => {
    if (m.canal !== 'telegram') return;
    const html = m.formato === 'markdown';
    for (const parte of fatiar(m.texto)) {
      try {
        await bot.api.sendMessage(Number(m.chatId), html ? paraHtml(parte) : parte, {
          ...(html ? { parse_mode: 'HTML' as const } : {}),
          ...(m.ref ? { reply_parameters: { message_id: Number(m.ref), allow_sending_without_reply: true } } : {}),
        });
      } catch (e) {
        // HTML inválido → manda como texto puro em vez de perder a mensagem.
        try { await bot.api.sendMessage(Number(m.chatId), parte); } catch (e2) { o.log(`[telegram] envio falhou: ${(e2 as Error).message}`); }
        void e;
      }
    }
  });

  // start() só resolve quando parar; rodamos em segundo plano e vigiamos o erro fatal.
  void bot.start({
    drop_pending_updates: false,
    onStart: (info) => o.log(`[telegram] online como @${info.username}`),
  }).catch((e) => o.log(`[telegram] polling encerrou: ${(e as Error).message}`));

  return {
    username: me.username ?? '?',
    parar: async () => { off(); await bot.stop(); },
  };
}
