// Conversa do painel e "Novo terminal": desligados por padrão, texto limitado, pasta só dentro de ~/projetos.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Conversa } from './conversa.js';
import { novoTerminal } from './fontes/assumir.js';
import { caminhosPadrao, type DepsPainel } from './tipos.js';
import { Cache } from './util.js';

const log = () => join(mkdtempSync(join(tmpdir(), 'chat-')), 'chat.log');

describe('conversa do painel', () => {
  afterEach(() => { delete process.env.PAINEL_CHAT; delete process.env.PAINEL_ASSUMIR; });

  it('desligada sem PAINEL_CHAT=1: nada entra no bot', () => {
    const entrou: string[] = [];
    const c = new Conversa((t) => entrou.push(t), log());
    expect(c.enviar(JSON.stringify({ texto: 'oi' }), 't').status).toBe(403);
    expect(entrou).toEqual([]);
  });

  it('ligada: entra no bot, guarda as duas pontas e mascara segredo', () => {
    process.env.PAINEL_CHAT = '1';
    const entrou: string[] = [];
    const c = new Conversa((t) => entrou.push(t), log());
    expect(c.enviar(JSON.stringify({ texto: 'status da máquina' }), 't').status).toBe(200);
    c.guardar('bot', 'chave sk-ant-abcdefghijklmnopqrstuvwxyz123456 ok');
    expect(entrou.length).toBe(1);
    expect(entrou[0]).toContain('status da máquina');
    expect(entrou[0]).toContain('127.0.0.1:3142/api/painel');
    const m = c.desde(0);
    expect(m.map((x) => x.quem)).toEqual(['voce', 'bot']);
    expect(m[1].texto).not.toContain('abcdefghijklmnop');
    expect(c.desde(1).length).toBe(1);
    expect(c.enviar(JSON.stringify({ texto: '' }), 't').status).toBe(400);
    expect(c.enviar(JSON.stringify({ texto: 'x'.repeat(4001) }), 't').status).toBe(413);
    c.enviar(JSON.stringify({ texto: 'e esse erro?', contexto: 'detalhe aberto: Publicação', voz: true }), 't');
    expect(entrou[1]).toContain('Na tela agora: detalhe aberto: Publicação');
    expect(entrou[1]).toContain('voz alta');
    expect(c.desde(0).filter((x) => x.quem === 'voce').map((x) => x.texto)).toEqual(['status da máquina', 'e esse erro?']);
  });

  it('novo terminal: desligado sem Assumir; recusa pasta fora de ~/projetos', async () => {
    const casa = mkdtempSync(join(tmpdir(), 'casa-'));
    mkdirSync(join(casa, 'projetos/app'), { recursive: true });
    const chamadas: string[][] = [];
    const d = { versao: 't', caminhos: caminhosPadrao(casa, casa), exec: async (c: string, a: string[]) => { chamadas.push([c, ...a]); return { ok: true, stdout: '', stderr: '', codigo: 0 }; }, agora: () => 1, cache: new Cache(), concorrenciaV3: {}, fetch: globalThis.fetch, sitesLigado: false } as DepsPainel;
    expect((await novoTerminal(d, JSON.stringify({ pasta: 'app' }), 't', casa)).status).toBe(403);
    process.env.PAINEL_ASSUMIR = '1';
    expect((await novoTerminal(d, JSON.stringify({ pasta: '/etc' }), 't', casa)).status).toBe(400);
    expect((await novoTerminal(d, JSON.stringify({ pasta: '../..' }), 't', casa)).status).toBe(400);
    expect((await novoTerminal(d, JSON.stringify({ pasta: 'nao-existe' }), 't', casa)).status).toBe(404);
    const r = await novoTerminal(d, JSON.stringify({ pasta: 'app' }), 't', casa);
    expect(r.status).toBe(200);
    expect(chamadas[0]).toEqual(expect.arrayContaining(['tmux', '-L', 'inema', 'new-session', '-d', '-c', join(casa, 'projetos/app')]));
  });
});
