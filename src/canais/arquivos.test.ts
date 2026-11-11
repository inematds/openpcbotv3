import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ehSegredo, extrairEnvios, motivoRecusa, tipoDoArquivo } from './arquivos.js';

describe('extrairEnvios', () => {
  it('tira o marcador do texto e devolve o envio com legenda', () => {
    const r = extrairEnvios('Segue o vídeo:\n\n[SEND_FILE:/tmp/a/porco-final.mp4|Porquinha]\n\nFim.');
    expect(r.texto).toBe('Segue o vídeo:\n\nFim.');
    expect(r.envios).toEqual([{ caminho: '/tmp/a/porco-final.mp4', legenda: 'Porquinha', tipo: 'video' }]);
  });
  it('aceita vários, SEND_PHOTO e marcador dentro de crase', () => {
    const r = extrairEnvios('a `[SEND_FILE:/x/b.pdf]` [SEND_PHOTO:/x/c.png|capa] [SEND_FILE:/x/d.mp3]');
    expect(r.texto).toBe('a');
    expect(r.envios.map((e) => e.tipo)).toEqual(['documento', 'foto', 'audio']);
  });
  it('texto sem marcador fica igual', () => {
    expect(extrairEnvios('oi').envios).toHaveLength(0);
  });
});

describe('segurança e limites', () => {
  it('barra segredos', () => {
    for (const c of ['/h/p/.env', '/h/p/x.env', '/h/.ssh/config', '/h/id_ed25519', '/h/p/store/v3.db', '/h/p/cookies.txt', '/h/token.json'])
      expect(ehSegredo(c), c).toBe(true);
  });
  it('não barra mídia com palavra parecida no nome', () => {
    expect(ehSegredo('/h/out/token-economy.mp4')).toBe(false);
    expect(tipoDoArquivo('/h/out/a.MP4')).toBe('video');
  });
  it('recusa inexistente, relativo e aceita arquivo real', () => {
    const d = mkdtempSync(join(tmpdir(), 'arq-'));
    const f = join(d, 'v.mp4'); writeFileSync(f, 'x');
    expect(motivoRecusa({ caminho: f, tipo: 'video' })).toBeNull();
    expect(motivoRecusa({ caminho: join(d, 'nao.mp4'), tipo: 'video' })).toMatch(/não existe/);
    expect(motivoRecusa({ caminho: 'rel/v.mp4', tipo: 'video' })).toMatch(/absoluto/);
  });
});
