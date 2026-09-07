// MEMORY.md / USER.md curados (padrão Hermes): o agente PROPÕE, você aprova.
// Nada é escrito no vault sem aprovação explícita (/memoria aprovar <id>).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

export type ArquivoVault = 'MEMORY.md' | 'USER.md';

export interface Proposta {
  id: number;
  chat_id: string;
  arquivo: ArquivoVault;
  texto: string;
  status: 'pendente' | 'aprovada' | 'descartada';
  created_at: number;
}

export class Vault {
  constructor(private readonly db: Database.Database, private readonly dir: string, private readonly agora: () => number) {}

  caminho(arq: ArquivoVault): string { return resolve(this.dir, arq); }

  ler(arq: ArquivoVault, maxChars = 1600): string {
    const p = this.caminho(arq);
    if (!existsSync(p)) return '';
    const t = readFileSync(p, 'utf8');
    return t.length > maxChars ? t.slice(0, maxChars) + '\n…' : t;
  }

  propor(chatId: string, arquivo: ArquivoVault, texto: string): Proposta {
    const r = this.db.prepare('INSERT INTO propostas_vault (chat_id, arquivo, texto, created_at) VALUES (?, ?, ?, ?)').run(chatId, arquivo, texto.trim(), this.agora());
    return this.obter(Number(r.lastInsertRowid)) as Proposta;
  }

  obter(id: number): Proposta | undefined {
    return this.db.prepare('SELECT * FROM propostas_vault WHERE id = ?').get(id) as Proposta | undefined;
  }

  pendentes(chatId: string): Proposta[] {
    return this.db.prepare("SELECT * FROM propostas_vault WHERE chat_id = ? AND status = 'pendente' ORDER BY id").all(chatId) as Proposta[];
  }

  aprovar(id: number): Proposta | undefined {
    const p = this.obter(id);
    if (!p || p.status !== 'pendente') return undefined;
    mkdirSync(this.dir, { recursive: true });
    const data = new Date(this.agora() * 1000).toISOString().slice(0, 10);
    appendFileSync(this.caminho(p.arquivo), `\n- (${data}) ${p.texto}\n`);
    this.db.prepare("UPDATE propostas_vault SET status = 'aprovada', decidido_em = ? WHERE id = ?").run(this.agora(), id);
    return this.obter(id);
  }

  descartar(id: number): boolean {
    return this.db.prepare("UPDATE propostas_vault SET status = 'descartada', decidido_em = ? WHERE id = ? AND status = 'pendente'").run(this.agora(), id).changes === 1;
  }
}
