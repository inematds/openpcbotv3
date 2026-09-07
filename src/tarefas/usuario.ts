// Tarefas SUAS (não do bot): /tarefa add|lista|feita, lembrete e resumo /daily.
import type Database from 'better-sqlite3';

export interface TarefaUsuario {
  id: number;
  chat_id: string;
  texto: string;
  feita: number;
  lembrar_em: number | null;
  lembrado_em: number | null;
  created_at: number;
  feita_em: number | null;
}

/** "amanhã 9h", "hoje 18:30", "sex 10h", "em 2h", "15/09 14h" → epoch segundos (fuso do processo). */
export function parsearQuando(texto: string, agora: number): { quando: number | null; resto: string } {
  const t = texto.trim();
  const base = new Date(agora * 1000);
  const set = (d: Date, h: number, m: number): number => { d.setHours(h, m, 0, 0); return Math.floor(d.getTime() / 1000); };
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^em\s+(\d+)\s*(min|m|h|hora|horas|d|dia|dias)\b\s*(.*)$/i))) {
    const n = Number(m[1]); const u = m[2].toLowerCase();
    const seg = u.startsWith('m') ? n * 60 : u.startsWith('h') ? n * 3600 : n * 86400;
    return { quando: agora + seg, resto: m[3] };
  }
  if ((m = t.match(/^(hoje|amanh[ãa]|seg|ter|qua|qui|sex|s[áa]b|dom)\s+(\d{1,2})(?::(\d{2}))?h?\s*(.*)$/i))) {
    const d = new Date(base); const dia = m[1].toLowerCase();
    if (dia.startsWith('amanh')) d.setDate(d.getDate() + 1);
    else if (dia !== 'hoje') {
      const idx = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].findIndex((x) => dia.startsWith(x.slice(0, 2)));
      const delta = ((idx - d.getDay()) + 7) % 7 || 7;
      d.setDate(d.getDate() + delta);
    }
    return { quando: set(d, Number(m[2]), Number(m[3] ?? 0)), resto: m[4] };
  }
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2})(?::(\d{2}))?h?\s*(.*)$/))) {
    const d = new Date(base); d.setMonth(Number(m[2]) - 1, Number(m[1]));
    if (d.getTime() < base.getTime()) d.setFullYear(d.getFullYear() + 1);
    return { quando: set(d, Number(m[3]), Number(m[4] ?? 0)), resto: m[5] };
  }
  return { quando: null, resto: t };
}

export class TarefasUsuario {
  constructor(private readonly db: Database.Database, private readonly agora: () => number) {}

  adicionar(chatId: string, texto: string, lembrarEm: number | null = null): TarefaUsuario {
    const r = this.db.prepare('INSERT INTO tarefas_usuario (chat_id, texto, lembrar_em, created_at) VALUES (?, ?, ?, ?)').run(chatId, texto, lembrarEm, this.agora());
    return this.db.prepare('SELECT * FROM tarefas_usuario WHERE id = ?').get(Number(r.lastInsertRowid)) as TarefaUsuario;
  }

  pendentes(chatId: string): TarefaUsuario[] {
    return this.db.prepare('SELECT * FROM tarefas_usuario WHERE chat_id = ? AND feita = 0 ORDER BY COALESCE(lembrar_em, 9e12), id').all(chatId) as TarefaUsuario[];
  }

  concluir(chatId: string, id: number): boolean {
    return this.db.prepare('UPDATE tarefas_usuario SET feita = 1, feita_em = ? WHERE id = ? AND chat_id = ? AND feita = 0').run(this.agora(), id, chatId).changes === 1;
  }

  remover(chatId: string, id: number): boolean {
    return this.db.prepare('DELETE FROM tarefas_usuario WHERE id = ? AND chat_id = ?').run(id, chatId).changes === 1;
  }

  /** Lembretes vencidos e ainda não avisados; marca como lembrados. */
  lembretesVencidos(): TarefaUsuario[] {
    const t = this.agora();
    const l = this.db.prepare('SELECT * FROM tarefas_usuario WHERE feita = 0 AND lembrar_em IS NOT NULL AND lembrar_em <= ? AND lembrado_em IS NULL').all(t) as TarefaUsuario[];
    for (const x of l) this.db.prepare('UPDATE tarefas_usuario SET lembrado_em = ? WHERE id = ?').run(t, x.id);
    return l;
  }

  feitasDesde(chatId: string, desde: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM tarefas_usuario WHERE chat_id = ? AND feita = 1 AND feita_em >= ?').get(chatId, desde) as { n: number }).n;
  }

  formatar(lista: TarefaUsuario[]): string {
    if (!lista.length) return 'Nenhuma tarefa pendente.';
    return lista.map((t) => {
      const q = t.lembrar_em ? ` ⏰ ${new Date(t.lembrar_em * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '';
      return `#${t.id} ${t.texto}${q}`;
    }).join('\n');
  }
}
