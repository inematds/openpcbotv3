// KV por chat sobre SQLite (tabela `prefs`, migration 8). `'*'` é o escopo
// global. Quem precisa de estado pequeno e durável (interruptores, modo de
// fila, personalidade) usa isto em vez de inventar tabela própria.
import type Database from 'better-sqlite3';

export const GLOBAL = '*';

export class Prefs {
  constructor(private readonly db: Database.Database, private readonly agora: () => number) {}

  obter(chatId: string, chave: string): string | undefined {
    const l = this.db.prepare('SELECT valor FROM prefs WHERE chat_id = ? AND chave = ?').get(chatId, chave) as { valor: string } | undefined;
    return l?.valor;
  }

  /** Valor do chat, senão o global, senão `padrao`. */
  resolver(chatId: string, chave: string, padrao: string): string {
    return this.obter(chatId, chave) ?? this.obter(GLOBAL, chave) ?? padrao;
  }

  gravar(chatId: string, chave: string, valor: string): void {
    this.db.prepare('INSERT INTO prefs (chat_id, chave, valor, em) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, chave) DO UPDATE SET valor = excluded.valor, em = excluded.em')
      .run(chatId, chave, valor, this.agora());
  }

  apagar(chatId: string, chave: string): boolean {
    return this.db.prepare('DELETE FROM prefs WHERE chat_id = ? AND chave = ?').run(chatId, chave).changes === 1;
  }

  /** Todas as entradas com um prefixo de chave (ex.: `parar:`), em qualquer escopo. */
  listar(prefixo: string): { chat_id: string; chave: string; valor: string; em: number }[] {
    return this.db.prepare('SELECT chat_id, chave, valor, em FROM prefs WHERE chave LIKE ? ORDER BY em DESC').all(`${prefixo}%`) as { chat_id: string; chave: string; valor: string; em: number }[];
  }
}
