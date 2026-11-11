// Adaptador Telegram (grammy). Só traduz para/do bus. Guarda: nunca sobe com o
// token do v2 (409 → bot surdo). Só atende o chat permitido.
import { Bot, GrammyError, HttpError, InputFile } from 'grammy';

import type { Bus } from '../bus/bus.js';
import { novoTraceId } from '../bus/bus.js';
import { validarTokenTelegram, RAIZ } from '../config/env.js';
import { baixarAnexo, extrairAnexo, linhaAnexo, type MsgComMidia } from './anexo.js';
import { basename, join } from 'node:path';
import { extrairEnvios, motivoRecusa } from './arquivos.js';

export interface OpcoesTelegram {
  token: string | undefined;
  /** Chats em que o bot RESPONDE. Vazio = responde em qualquer chat. */
  chatsResponder: string[];
  /** Chats que o bot só OBSERVA (grava no cérebro, nunca responde). `todos` = qualquer um. */
  chatsObservar: string[];
  bus: Bus;
  log: (m: string) => void;
  agora: () => number;
  /** Onde salvar anexos recebidos (padrão: store/anexos). */
  dirAnexos?: string;
}

export type Papel = 'responder' | 'observar' | 'ignorar';

/**
 * Decide o que fazer com uma mensagem. `responder` vence `observar` (um chat
 * listado nos dois é chat de conversa). Lista de resposta vazia = o bot ainda
 * não foi restringido, então responde a quem falar com ele.
 */
export function papelDoChat(chatId: string, responder: string[], observar: string[]): Papel {
  if (responder.length === 0 && observar.length === 0) return 'responder';
  if (responder.includes(chatId) || responder.includes('todos')) return 'responder';
  if (observar.includes(chatId) || observar.includes('todos')) return 'observar';
  return 'ignorar';
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
  o.log(`[telegram] responde em: ${o.chatsResponder.join(', ') || '(qualquer chat)'} · observa: ${o.chatsObservar.join(', ') || '(nenhum)'}`);
  const bot = new Bot(o.token as string);
  const me = await bot.api.getMe();
  // Chats ignorados são logados UMA vez por id: é assim que se descobre o
  // chat_id de um grupo novo (docs/CONECTORES.md §3.3) sem ligar o observador.
  const jaLogados = new Set<string>();

  // `message` (não `message:text`) para pegar também legenda de foto/vídeo —
  // em grupo é onde mora metade do que se quer lembrar.
  bot.on('message', async (ctx) => {
    let texto = ctx.message.text ?? ctx.message.caption ?? '';
    const chatId = String(ctx.chat.id);
    const papel = papelDoChat(chatId, o.chatsResponder, o.chatsObservar);
    // Anexo (vídeo, foto, documento…): só baixa nos chats em que o bot responde.
    const anexo = papel === 'responder' ? extrairAnexo(ctx.message as unknown as MsgComMidia) : null;
    if (anexo) {
      const r = await baixarAnexo(anexo, ctx.message.message_id, o.token as string, o.dirAnexos ?? join(RAIZ, 'store/anexos'), {
        getFile: (id) => bot.api.getFile(id),
        buscar: async (url) => { const resp = await fetch(url); if (!resp.ok) throw new Error(`HTTP ${resp.status}`); return resp.arrayBuffer(); },
      });
      o.log(`[telegram] anexo ${anexo.tipo} msg ${ctx.message.message_id}: ${r.caminho ?? `não baixado (${r.motivo})`}`);
      texto = [texto, linhaAnexo(anexo, r)].filter(Boolean).join('\n\n');
    }
    if (!texto) return;
    const chat = ctx.chat as { title?: string; first_name?: string; username?: string };
    if (papel === 'ignorar') {
      if (!jaLogados.has(chatId)) {
        jaLogados.add(chatId);
        o.log(`[telegram] ignorado chat_id=${chatId} "${chat.title ?? chat.first_name ?? chat.username ?? '?'}" — some em TELEGRAM_CHATS_OBSERVAR/RESPONDER para usar`);
      }
      return;
    }
    o.bus.emit('mensagem.recebida', {
      canal: 'telegram', chatId, texto,
      usuario: ctx.from?.username ?? [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') ?? String(ctx.from?.id ?? ''),
      titulo: chat.title ?? chat.first_name ?? chat.username,
      observar: papel === 'observar',
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
    const { texto: semMarcadores, envios } = extrairEnvios(m.texto);
    for (const parte of semMarcadores ? fatiar(semMarcadores) : []) {
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
    // [SEND_FILE:...] → arquivo de verdade (antes saía como texto cru).
    const chat = Number(m.chatId);
    for (const env of envios) {
      const recusa = motivoRecusa(env);
      if (recusa) {
        o.log(`[telegram] arquivo não enviado ${env.caminho}: ${recusa}`);
        try { await bot.api.sendMessage(chat, `⚠️ Não mandei ${basename(env.caminho)}: ${recusa}.`); } catch { /* sem rede */ }
        continue;
      }
      const arq = new InputFile(env.caminho);
      const extra = env.legenda ? { caption: env.legenda.slice(0, 1000) } : {};
      try {
        if (env.tipo === 'video') await bot.api.sendVideo(chat, arq, { ...extra, supports_streaming: true });
        else if (env.tipo === 'foto') await bot.api.sendPhoto(chat, arq, extra);
        else if (env.tipo === 'audio') await bot.api.sendAudio(chat, arq, extra);
        else await bot.api.sendDocument(chat, arq, extra);
        o.log(`[telegram] arquivo enviado (${env.tipo}): ${env.caminho}`);
      } catch (e) {
        // Vídeo/foto que o Telegram recusa no formato próprio ainda vai como documento.
        try {
          await bot.api.sendDocument(chat, new InputFile(env.caminho), extra);
          o.log(`[telegram] arquivo enviado como documento após falha (${(e as Error).message}): ${env.caminho}`);
        } catch (e2) {
          o.log(`[telegram] arquivo falhou ${env.caminho}: ${(e2 as Error).message}`);
          try { await bot.api.sendMessage(chat, `⚠️ Falhou o envio de ${basename(env.caminho)}: ${(e2 as Error).message}`); } catch { /* sem rede */ }
        }
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
