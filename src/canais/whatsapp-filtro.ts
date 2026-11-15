// Filtro do webhook da Evolution (3.35.17). Fase 1: só a conversa "eu comigo" do
// Nei vira comando. Tudo o mais (contatos, grupos, status, canais, o que ele digita
// para outras pessoas e o eco das respostas do bot) é descartado aqui, sem guardar
// texto nem nome. Falha fechada: na dúvida, descarta — o que passa chega a um agente
// com shell.

/** Prefixo das respostas do bot no WhatsApp; serve também de trava contra eco. */
export const PREFIXO_BOT = '🤖 ';

export type Motivo =
  | 'evento' | 'sem-chave' | 'grupo' | 'broadcast' | 'nao-e-meu' | 'outro-chat'
  | 'eco' | 'repetida' | 'sem-texto' | 'dono-desconhecido' | 'ok';

export interface Decisao {
  aceitar: boolean;
  motivo: Motivo;
  chatId?: string;
  texto?: string;
  ref?: string;
}

/** `5548999@s.whatsapp.net:12` / `5548999:12@s.whatsapp.net` → `5548999@s.whatsapp.net`. */
export function normalizarJid(jid: unknown): string {
  const s = String(jid ?? '').trim().toLowerCase();
  if (!s.includes('@')) return '';
  const [usuario, servidor] = s.split('@');
  const u = usuario.split(':')[0];
  const sv = servidor.split(':')[0];
  return u && sv ? `${u}@${sv}` : '';
}

/** Conjunto limitado (mais antigos saem primeiro). */
export class Memoria {
  private readonly itens = new Set<string>();
  constructor(private readonly max = 2000) {}
  tem(x: string): boolean { return this.itens.has(x); }
  por(x: string): void {
    this.itens.add(x);
    if (this.itens.size > this.max) this.itens.delete(this.itens.values().next().value as string);
  }
}

export interface EstadoFiltro {
  /** Identidades do próprio número: `<numero>@s.whatsapp.net` e, se houver, `<lid>@lid`. */
  dono: Set<string>;
  /** key.id das mensagens que o bot mandou (eco). */
  enviados: Memoria;
  /** key.id já processados (a Evolution pode repetir o webhook). */
  vistos: Memoria;
}

interface Chave { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean; id?: string; participant?: string }

function textoDe(msg: Record<string, unknown> | undefined): string {
  if (!msg) return '';
  const ext = msg.extendedTextMessage as { text?: string } | undefined;
  const t = typeof msg.conversation === 'string' ? msg.conversation : ext?.text;
  return typeof t === 'string' ? t.trim() : '';
}

export function decidir(corpo: unknown, est: EstadoFiltro): Decisao {
  const b = (corpo ?? {}) as { event?: string; data?: unknown };
  const ev = String(b.event ?? '').toLowerCase().replace('_', '.');
  if (ev !== 'messages.upsert') return { aceitar: false, motivo: 'evento' };
  let data = b.data as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (Array.isArray(data)) data = data[0];
  const key = (data?.key ?? undefined) as Chave | undefined;
  if (!data || !key || !key.remoteJid) return { aceitar: false, motivo: 'sem-chave' };

  const jid = normalizarJid(key.remoteJid);
  if (jid.endsWith('@g.us')) return { aceitar: false, motivo: 'grupo' };
  if (jid.endsWith('@broadcast') || jid.endsWith('@newsletter') || !jid) return { aceitar: false, motivo: 'broadcast' };
  // Só o que o PRÓPRIO Nei escreveu. Mensagem de qualquer contato para no fromMe.
  if (key.fromMe !== true) return { aceitar: false, motivo: 'nao-e-meu' };
  if (est.dono.size === 0) return { aceitar: false, motivo: 'dono-desconhecido' };
  // E só na conversa com ele mesmo — fromMe sozinho pegaria tudo o que ele manda aos outros.
  const alt = normalizarJid(key.remoteJidAlt);
  if (!est.dono.has(jid) && !(alt && est.dono.has(alt))) return { aceitar: false, motivo: 'outro-chat' };

  const id = String(key.id ?? '');
  if (id && est.enviados.tem(id)) return { aceitar: false, motivo: 'eco' };
  if (id && est.vistos.tem(id)) return { aceitar: false, motivo: 'repetida' };
  const texto = textoDe(data.message as Record<string, unknown> | undefined);
  if (!texto) return { aceitar: false, motivo: 'sem-texto' };
  if (texto.startsWith(PREFIXO_BOT.trim())) return { aceitar: false, motivo: 'eco' };
  if (id) est.vistos.por(id);
  // Resposta vai para o número (s.whatsapp.net), não para o @lid.
  const chatId = [jid, alt].find((j) => j && j.endsWith('@s.whatsapp.net') && est.dono.has(j)) ?? jid;
  return { aceitar: true, motivo: 'ok', chatId, texto, ref: id || undefined };
}

/** Envio só para a própria conversa do Nei na fase 1 (falha fechada também na saída). */
export function podeEnviar(chatId: string, dono: Set<string>): boolean {
  return dono.has(normalizarJid(chatId));
}
