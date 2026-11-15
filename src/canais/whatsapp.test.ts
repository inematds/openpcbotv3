import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Bus, type MensagemRecebida } from '../bus/bus.js';
import { decidir, Memoria, normalizarJid, podeEnviar, type EstadoFiltro } from './whatsapp-filtro.js';
import { ligarWhatsApp, origemOk, v2UsaWhatsApp, type WhatsAppLigado } from './whatsapp.js';

const DONO = '5548999990000@s.whatsapp.net';
const LID = '123456789012345@lid';
const est = (): EstadoFiltro => ({ dono: new Set([DONO]), enviados: new Memoria(), vistos: new Memoria() });
const evento = (key: Record<string, unknown>, texto = 'oi bot') => ({ event: 'messages.upsert', instance: 'pessoal', data: { key, pushName: 'X', message: { conversation: texto } } });

describe('filtro do webhook (fase 1: só "eu comigo")', () => {
  it('grupo nunca passa', () => {
    expect(decidir(evento({ remoteJid: '120363000@g.us', fromMe: false, id: 'a', participant: '5511@s.whatsapp.net' }), est()).motivo).toBe('grupo');
    expect(decidir(evento({ remoteJid: '120363000@g.us', fromMe: true, id: 'b' }), est()).motivo).toBe('grupo');
  });
  it('mensagem de outro contato não passa', () => {
    expect(decidir(evento({ remoteJid: '5511888887777@s.whatsapp.net', fromMe: false, id: 'c' }), est()).motivo).toBe('nao-e-meu');
  });
  it('o que o Nei manda para outra pessoa não passa', () => {
    expect(decidir(evento({ remoteJid: '5511888887777@s.whatsapp.net', fromMe: true, id: 'd' }), est()).motivo).toBe('outro-chat');
  });
  it('contato fingindo ser o dono (fromMe false no chat do dono) não passa', () => {
    expect(decidir(evento({ remoteJid: DONO, fromMe: false, id: 'e' }), est()).motivo).toBe('nao-e-meu');
  });
  it('a conversa "eu comigo" passa', () => {
    const d = decidir(evento({ remoteJid: DONO, fromMe: true, id: 'f' }, 'resume meu dia'), est());
    expect(d).toMatchObject({ aceitar: true, chatId: DONO, texto: 'resume meu dia', ref: 'f' });
  });
  it('"eu comigo" vindo como @lid com o número no remoteJidAlt passa e responde no número', () => {
    const d = decidir(evento({ remoteJid: LID, remoteJidAlt: DONO, fromMe: true, id: 'g' }), est());
    expect(d).toMatchObject({ aceitar: true, chatId: DONO });
  });
  it('@lid sem número alternativo não passa (a menos que esteja em WHATSAPP_DONO_IDS)', () => {
    expect(decidir(evento({ remoteJid: LID, fromMe: true, id: 'h' }), est()).motivo).toBe('outro-chat');
    const e = est(); e.dono.add(LID);
    expect(decidir(evento({ remoteJid: LID, fromMe: true, id: 'h2' }), e).aceitar).toBe(true);
  });
  it('eco das respostas do bot não volta (por id e por prefixo)', () => {
    const e = est(); e.enviados.por('bot1');
    expect(decidir(evento({ remoteJid: DONO, fromMe: true, id: 'bot1' }), e).motivo).toBe('eco');
    expect(decidir(evento({ remoteJid: DONO, fromMe: true, id: 'novo' }, '🤖 resposta'), e).motivo).toBe('eco');
  });
  it('webhook repetido entra uma vez só', () => {
    const e = est();
    expect(decidir(evento({ remoteJid: DONO, fromMe: true, id: 'r' }), e).aceitar).toBe(true);
    expect(decidir(evento({ remoteJid: DONO, fromMe: true, id: 'r' }), e).motivo).toBe('repetida');
  });
  it('sem dono conhecido (antes do QR) nada passa', () => {
    const e = est(); e.dono.clear();
    expect(decidir(evento({ remoteJid: DONO, fromMe: true, id: 's' }), e).motivo).toBe('dono-desconhecido');
  });
  it('status, broadcast, outro evento e corpo torto não passam', () => {
    expect(decidir(evento({ remoteJid: 'status@broadcast', fromMe: true, id: 't' }), est()).motivo).toBe('broadcast');
    expect(decidir({ event: 'connection.update', data: {} }, est()).motivo).toBe('evento');
    expect(decidir(null, est()).aceitar).toBe(false);
    expect(decidir({ event: 'MESSAGES_UPSERT', data: [{ key: { remoteJid: DONO, fromMe: true, id: 'u' }, message: { extendedTextMessage: { text: 'x' } } }] }, est()).aceitar).toBe(true);
  });
  it('envio só para o dono; jid normalizado', () => {
    expect(podeEnviar(DONO, new Set([DONO]))).toBe(true);
    expect(podeEnviar('5511888887777@s.whatsapp.net', new Set([DONO]))).toBe(false);
    expect(normalizarJid('5548999990000:12@s.whatsapp.net')).toBe(DONO);
    expect(origemOk('::ffff:10.95.31.3')).toBe(true);
    expect(origemOk('192.168.0.10')).toBe(false);
  });
});

describe('guarda do v2', () => {
  it('só recusa se o WHATSAPP_ENABLED do v2 estiver ligado (não comentado)', () => {
    const d = mkdtempSync(join(tmpdir(), 'wa-'));
    const f = join(d, '.env');
    writeFileSync(f, '# WHATSAPP_ENABLED=true\n'); expect(v2UsaWhatsApp(f)).toBe(false);
    writeFileSync(f, 'WHATSAPP_ENABLED=true\n'); expect(v2UsaWhatsApp(f)).toBe(true);
    expect(v2UsaWhatsApp(join(d, 'nao-existe'))).toBe(false);
  });
});

describe('adaptador ponta a ponta (Evolution simulada)', () => {
  let wa: WhatsAppLigado | null = null;
  afterEach(() => { wa?.parar(); wa = null; });

  it('só a conversa "eu comigo" chega ao bus; resposta volta só para o dono, com prefixo', async () => {
    const bus = new Bus();
    const recebidas: MensagemRecebida[] = [];
    bus.on('mensagem.recebida', (m) => { recebidas.push(m); });
    const enviados: { url: string; corpo: { number: string; text: string } }[] = [];
    const buscar = (async (url: string, init?: RequestInit) => {
      if (url.includes('fetchInstances')) return new Response(JSON.stringify([{ ownerJid: DONO }]), { status: 200 });
      enviados.push({ url, corpo: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ key: { id: `bot-${enviados.length}` } }), { status: 201 });
    }) as typeof fetch;
    const segredo = 'segredo-de-teste-1234567890';
    const porta = 31000 + Math.floor(Math.random() * 2000);
    wa = ligarWhatsApp({
      ativo: true, v2UsaWhatsApp: () => false, bus, log: () => {}, agora: () => 1, buscar,
      env: { EVOLUTION_URL: 'http://evo', EVOLUTION_API_KEY: 'k', EVOLUTION_INSTANCIA: 'pessoal', WHATSAPP_WEBHOOK_SEGREDO: segredo, WHATSAPP_WEBHOOK_BIND: '127.0.0.1', WHATSAPP_WEBHOOK_PORTA: String(porta) },
    });
    expect(wa.ligado).toBe(true);
    await new Promise((r) => setTimeout(r, 100)); // dono carregado + ouvinte de pé
    const post = (corpo: unknown, rota = `/webhook/evolution/${segredo}`) => fetch(`http://127.0.0.1:${porta}${rota}`, { method: 'POST', body: JSON.stringify(corpo) });

    expect((await post(evento({ remoteJid: DONO, fromMe: true, id: 'x' }), '/webhook/evolution/errado')).status).toBe(404);
    await post(evento({ remoteJid: '120363000@g.us', fromMe: false, id: '1' }, 'dado sensível do grupo'));
    await post(evento({ remoteJid: '5511888887777@s.whatsapp.net', fromMe: false, id: '2' }, 'oi Nei'));
    await post(evento({ remoteJid: '5511888887777@s.whatsapp.net', fromMe: true, id: '3' }, 'oi amigo'));
    await post(evento({ remoteJid: DONO, fromMe: true, id: '4' }, 'quem não respondi?'));
    await new Promise((r) => setTimeout(r, 50));
    expect(recebidas.map((m) => m.texto)).toEqual(['quem não respondi?']);
    expect(recebidas[0]).toMatchObject({ canal: 'whatsapp', chatId: DONO });

    bus.emit('mensagem.enviar', { canal: 'whatsapp', chatId: '5511888887777@s.whatsapp.net', texto: 'não deveria sair' });
    bus.emit('mensagem.enviar', { canal: 'whatsapp', chatId: DONO, texto: 'Você tem 2 conversas sem resposta.' });
    await new Promise((r) => setTimeout(r, 50));
    expect(enviados).toHaveLength(1);
    expect(enviados[0].corpo).toEqual({ number: '5548999990000', text: '🤖 Você tem 2 conversas sem resposta.' });

    // eco da própria resposta não volta
    await post(evento({ remoteJid: DONO, fromMe: true, id: 'bot-1' }, 'Você tem 2 conversas sem resposta.'));
    await new Promise((r) => setTimeout(r, 50));
    expect(recebidas).toHaveLength(1);
  });

  it('desligado sem config ou com o v2 usando o número', () => {
    expect(ligarWhatsApp({ ativo: false, v2UsaWhatsApp: () => false, bus: new Bus(), log: () => {}, agora: () => 1 }).ligado).toBe(false);
    expect(ligarWhatsApp({ ativo: true, v2UsaWhatsApp: () => true, bus: new Bus(), log: () => {}, agora: () => 1 }).ligado).toBe(false);
    expect(ligarWhatsApp({ ativo: true, v2UsaWhatsApp: () => false, bus: new Bus(), log: () => {}, agora: () => 1, env: {} }).ligado).toBe(false);
  });
});
