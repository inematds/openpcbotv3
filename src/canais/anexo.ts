// Anexos recebidos no Telegram (vídeo, foto, documento, áudio, voz, vídeo
// redondo, GIF). Antes o canal só lia texto/legenda e o arquivo sumia sem
// aviso (22/10/2026). Agora: baixa até o limite do Bot API (20 MB) para
// store/anexos/<data>/ e acrescenta ao texto uma linha com o caminho; acima do
// limite, a linha diz que NÃO baixou, para o agente avisar em vez de ignorar.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Limite de download do Bot API público (getFile). */
export const LIMITE_BOT_API = 20 * 1024 * 1024;

export interface Anexo {
  tipo: 'vídeo' | 'foto' | 'documento' | 'áudio' | 'voz' | 'vídeo redondo' | 'gif';
  fileId: string;
  nome: string;
  tamanho: number | undefined;
}

interface Arq { file_id: string; file_size?: number; file_name?: string; mime_type?: string }

/** Campos de mídia que o Telegram manda numa mensagem (subconjunto do tipo do grammy). */
export interface MsgComMidia {
  message_id: number;
  video?: Arq; document?: Arq; audio?: Arq; voice?: Arq; video_note?: Arq; animation?: Arq;
  photo?: Arq[];
}

const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

function nomeDe(a: Arq, padrao: string): string {
  if (a.file_name) return a.file_name.replace(/[^\w.\-À-ÿ ]/g, '_').replace(/\s+/g, '_').slice(0, 120);
  const ext = (a.mime_type && EXT[a.mime_type]) ?? padrao.split('.').pop();
  return `${padrao.split('.')[0]}.${ext}`;
}

/** Descobre o anexo da mensagem (a foto maior, quando é foto). `null` se não tem. */
export function extrairAnexo(m: MsgComMidia): Anexo | null {
  const um = (tipo: Anexo['tipo'], a: Arq | undefined, padrao: string): Anexo | null =>
    a ? { tipo, fileId: a.file_id, nome: nomeDe(a, padrao), tamanho: a.file_size } : null;
  if (m.photo?.length) {
    const maior = m.photo[m.photo.length - 1];
    return { tipo: 'foto', fileId: maior.file_id, nome: 'foto.jpg', tamanho: maior.file_size };
  }
  // animation vem antes de document: o Telegram manda os dois para GIF.
  return um('vídeo', m.video, 'video.mp4') ?? um('gif', m.animation, 'gif.mp4') ?? um('documento', m.document, 'arquivo.bin')
    ?? um('áudio', m.audio, 'audio.mp3') ?? um('voz', m.voice, 'voz.ogg') ?? um('vídeo redondo', m.video_note, 'video-redondo.mp4');
}

export function mb(bytes: number | undefined): string {
  return bytes === undefined ? '? MB' : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Linha acrescentada ao texto que vai para o agente. */
export function linhaAnexo(a: Anexo, r: { caminho?: string; motivo?: string }): string {
  if (r.caminho) return `[anexo recebido: ${a.tipo} · ${mb(a.tamanho)} · salvo em ${r.caminho}]`;
  return `[anexo recebido: ${a.tipo} · ${mb(a.tamanho)} · NÃO baixado: ${r.motivo}. Avise o Nei e peça outro meio (link ou arquivo menor).]`;
}

export interface Baixador {
  getFile: (fileId: string) => Promise<{ file_path?: string }>;
  buscar: (url: string) => Promise<ArrayBuffer>;
}

/** Baixa o anexo para `<dir>/<AAAA-MM-DD>/<msgId>-<nome>`. Nunca lança: devolve caminho ou motivo. */
export async function baixarAnexo(a: Anexo, msgId: number, token: string, dir: string, b: Baixador, hoje = new Date()):
Promise<{ caminho?: string; motivo?: string }> {
  if (a.tamanho !== undefined && a.tamanho > LIMITE_BOT_API) return { motivo: `acima do limite de 20 MB do Bot API do Telegram` };
  try {
    const f = await b.getFile(a.fileId);
    if (!f.file_path) return { motivo: 'o Telegram não devolveu o caminho do arquivo' };
    const dados = Buffer.from(await b.buscar(`https://api.telegram.org/file/bot${token}/${f.file_path}`));
    const pasta = join(dir, hoje.toISOString().slice(0, 10));
    mkdirSync(pasta, { recursive: true });
    const caminho = join(pasta, `${msgId}-${a.nome}`);
    writeFileSync(caminho, dados);
    return { caminho };
  } catch (e) {
    const msg = (e as Error).message.replace(token, '<token>');
    return { motivo: /too big/i.test(msg) ? 'acima do limite de 20 MB do Bot API do Telegram' : `falha no download (${msg.slice(0, 120)})` };
  }
}
