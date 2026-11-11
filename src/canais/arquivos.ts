// Marcadores de envio de arquivo na resposta do agente (3.26.14).
// As skills e o hábito herdado do v2 escrevem `[SEND_FILE:/caminho|legenda]` e
// `[SEND_PHOTO:/caminho|legenda]`. O v3 só mandava texto, então o Nei recebia o
// marcador cru em vez do vídeo. Aqui: tira os marcadores do texto, decide como
// mandar cada arquivo e barra o que não pode sair (segredo, inexistente, > 50 MB).
import { existsSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

export type TipoEnvio = 'video' | 'foto' | 'audio' | 'documento';

export interface Envio {
  caminho: string;
  legenda?: string;
  tipo: TipoEnvio;
}

/** Limite de upload da Bot API do Telegram. */
export const MAX_BYTES = 50 * 1024 * 1024;

const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const FOTO = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const AUDIO = new Set(['.mp3', '.m4a', '.ogg', '.wav', '.flac']);

export function tipoDoArquivo(caminho: string, pediuFoto = false): TipoEnvio {
  const ext = extname(caminho).toLowerCase();
  if (FOTO.has(ext)) return 'foto';
  if (pediuFoto) return 'documento';
  if (VIDEO.has(ext)) return 'video';
  if (AUDIO.has(ext)) return 'audio';
  return 'documento';
}

/** Tira `[SEND_FILE:...]`/`[SEND_PHOTO:...]` do texto (também dentro de crase) e devolve os envios. */
export function extrairEnvios(texto: string): { texto: string; envios: Envio[] } {
  const envios: Envio[] = [];
  const re = /`?\[SEND_(FILE|PHOTO):([^\]|]+)(?:\|([^\]]*))?\]`?/g;
  const limpo = texto.replace(re, (_t, kind: string, cam: string, leg?: string) => {
    const caminho = cam.trim();
    envios.push({ caminho, legenda: leg?.trim() || undefined, tipo: tipoDoArquivo(caminho, kind === 'PHOTO') });
    return '';
  });
  return { texto: limpo.replace(/\n{3,}/g, '\n\n').trim(), envios };
}

/** Arquivo que nunca sai pelo Telegram, mesmo que o agente peça. */
export function ehSegredo(caminho: string): boolean {
  const c = resolve(caminho);
  const nome = basename(c).toLowerCase();
  if (nome === '.env' || nome.startsWith('.env.') || nome.endsWith('.env')) return true;
  if (/\.(pem|key|p12|pfx|kdbx)$/.test(nome) || /^id_(rsa|ed25519|ecdsa|dsa)/.test(nome)) return true;
  if (/(^|\/)\.(ssh|gnupg|aws)(\/|$)/.test(c)) return true;
  const midia = tipoDoArquivo(c) !== 'documento';
  if (!midia && /(credential|secret|token|cookies?)/i.test(nome)) return true;
  if (/\.db(-wal|-shm)?$/.test(nome)) return true;
  return false;
}

/** null = pode mandar; texto = motivo para avisar no chat. */
export function motivoRecusa(e: Envio): string | null {
  if (!e.caminho.startsWith('/')) return 'caminho não é absoluto';
  if (ehSegredo(e.caminho)) return 'arquivo protegido (segredo/credencial/banco), não sai pelo Telegram';
  if (!existsSync(e.caminho)) return 'arquivo não existe';
  const st = statSync(e.caminho);
  if (!st.isFile()) return 'não é um arquivo';
  if (st.size > MAX_BYTES) return `tem ${(st.size / 1048576).toFixed(0)} MB, acima do limite de 50 MB do Telegram`;
  return null;
}
