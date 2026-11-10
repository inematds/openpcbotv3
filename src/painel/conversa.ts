// Conversar com o bot pelo painel (EM TESTE, 10/11/2026). Nei: "seria legal eu poder ter um chat no painel
// falando com o bot ou um terminal". Só com PAINEL_CHAT=1. O texto entra no bot como se viesse do canal http
// (chat "painel") — o mesmo caminho do POST /mensagem da 3142, sem abrir a 3142: o agente roda com permissão
// total, por isso fica desligado por padrão, com log e o mesmo CSRF do Assumir.
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { mascarar } from './fontes/sessoes.js';

export interface MsgConversa { n: number; quando: number; quem: 'voce' | 'bot'; texto: string }

export const conversaLigada = () => process.env.PAINEL_CHAT === '1';
export const CHAT_ID = 'painel';
const MAX_TEXTO = 4000;

export class Conversa {
  private msgs: MsgConversa[] = [];
  private n = 0;
  constructor(private entrar: (texto: string) => void, private log = join(homedir(), '.local/share/inema/painel-chat.log'), private max = 300) {}

  /** Mensagem que chegou do bot (ou foi enviada por você). */
  guardar(quem: MsgConversa['quem'], texto: string): MsgConversa {
    const m = { n: ++this.n, quando: Math.floor(Date.now() / 1000), quem, texto: mascarar(String(texto)) };
    this.msgs.push(m);
    if (this.msgs.length > this.max) this.msgs.splice(0, this.msgs.length - this.max);
    return m;
  }

  enviar(bruto: string, quem: string): { status: number; corpo: unknown } {
    if (!conversaLigada()) return { status: 403, corpo: { erro: 'conversa desligada (PAINEL_CHAT=1 liga)' } };
    let texto = '';
    try { texto = String((JSON.parse(bruto || '{}') as { texto?: unknown }).texto ?? '').trim(); } catch { return { status: 400, corpo: { erro: 'JSON inválido' } }; }
    if (!texto) return { status: 400, corpo: { erro: 'texto vazio' } };
    if (texto.length > MAX_TEXTO) return { status: 413, corpo: { erro: `texto acima de ${MAX_TEXTO} caracteres` } };
    const m = this.guardar('voce', texto);
    try {
      mkdirSync(dirname(this.log), { recursive: true });
      appendFileSync(this.log, `${new Date().toISOString()} ${quem} ${mascarar(texto).slice(0, 80).replace(/\n/g, ' ')}\n`, { mode: 0o600 });
    } catch { /* log é extra */ }
    this.entrar(texto);
    return { status: 200, corpo: { ok: true, n: m.n } };
  }

  desde(n: number): MsgConversa[] { return this.msgs.filter((m) => m.n > n); }
}
