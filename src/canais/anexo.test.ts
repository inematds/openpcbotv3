import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { baixarAnexo, extrairAnexo, linhaAnexo, LIMITE_BOT_API } from './anexo.js';

describe('extrairAnexo', () => {
  it('vídeo sem nome vira video.mp4', () => {
    expect(extrairAnexo({ message_id: 1, video: { file_id: 'v', file_size: 10, mime_type: 'video/mp4' } }))
      .toEqual({ tipo: 'vídeo', fileId: 'v', nome: 'video.mp4', tamanho: 10 });
  });
  it('foto pega a maior', () => {
    expect(extrairAnexo({ message_id: 1, photo: [{ file_id: 'p', file_size: 1 }, { file_id: 'g', file_size: 9 }] })?.fileId).toBe('g');
  });
  it('documento mantém o nome, sem caracteres perigosos', () => {
    expect(extrairAnexo({ message_id: 1, document: { file_id: 'd', file_name: '../meu vídeo.mov' } })?.nome).toBe('.._meu_vídeo.mov');
  });
  it('GIF vem como gif, não documento', () => {
    expect(extrairAnexo({ message_id: 1, animation: { file_id: 'a' }, document: { file_id: 'd' } })?.tipo).toBe('gif');
  });
  it('só texto → null', () => {
    expect(extrairAnexo({ message_id: 1 })).toBeNull();
  });
});

describe('baixarAnexo', () => {
  const hoje = new Date('2026-10-23T03:00:00Z');
  it('baixa e salva em <dir>/<data>/<msg>-<nome>', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anexo-'));
    let url = '';
    const r = await baixarAnexo({ tipo: 'vídeo', fileId: 'v', nome: 'video.mp4', tamanho: 3 }, 42, 'TK', dir, {
      getFile: async () => ({ file_path: 'videos/x.mp4' }),
      buscar: async (u) => { url = u; return new TextEncoder().encode('abc').buffer as ArrayBuffer; },
    }, hoje);
    expect(r.caminho).toBe(join(dir, '2026-10-23', '42-video.mp4'));
    expect(readFileSync(r.caminho as string, 'utf8')).toBe('abc');
    expect(url).toBe('https://api.telegram.org/file/botTK/videos/x.mp4');
  });
  it('acima de 20 MB não chama o Telegram e diz o motivo', async () => {
    let chamou = false;
    const r = await baixarAnexo({ tipo: 'vídeo', fileId: 'v', nome: 'v.mp4', tamanho: LIMITE_BOT_API + 1 }, 1, 'TK', '/nao', {
      getFile: async () => { chamou = true; return {}; }, buscar: async () => new ArrayBuffer(0),
    });
    expect(chamou).toBe(false);
    expect(r.motivo).toMatch(/20 MB/);
  });
  it('erro não vaza o token', async () => {
    const r = await baixarAnexo({ tipo: 'foto', fileId: 'f', nome: 'foto.jpg', tamanho: 1 }, 1, 'SEGREDO', '/tmp', {
      getFile: async () => { throw new Error('falhou em /botSEGREDO/getFile'); }, buscar: async () => new ArrayBuffer(0),
    });
    expect(r.motivo).not.toContain('SEGREDO');
  });
});

describe('linhaAnexo', () => {
  it('com caminho e sem', () => {
    const a = { tipo: 'vídeo' as const, fileId: 'v', nome: 'v.mp4', tamanho: 5 * 1024 * 1024 };
    expect(linhaAnexo(a, { caminho: '/x/v.mp4' })).toBe('[anexo recebido: vídeo · 5,0 MB · salvo em /x/v.mp4]');
    expect(linhaAnexo(a, { motivo: 'grande' })).toContain('NÃO baixado: grande');
  });
});
