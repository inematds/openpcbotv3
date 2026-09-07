// Cérebro (plano §4.4): tabela `memories` do v2 (FTS5 + salience com decaimento
// 2 %/dia), sinais semânticos em PT-BR (TODO #1 do v2, aberto desde 2026-05-01),
// vetor bge-m3 opcional e retrieval em 3 camadas.
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export type Setor = 'semantic' | 'episodic' | 'procedural';

export interface Memoria {
  id: number;
  chat_id: string;
  topic_key: string | null;
  content: string;
  sector: Setor;
  salience: number;
  created_at: number;
  accessed_at: number;
  superseded_by: number | null;
  origem: string;
  hash: string | null;
}

/** Sinais de memória de longa duração — inglês (v2) + PT-BR (TODO #1). */
export const SINAIS_SEMANTICOS =
  /\b(my|i am|i'm|i prefer|remember|always|never|meu|minha|meus|minhas|eu sou|eu (?:tô|to|estou)|eu prefiro|prefiro|lembr[ae]|lembre-se|anota|sempre|nunca|gosto de|odeio|preciso|quero|moro em|trabalho (?:com|na|no)|meu nome)\b/i;

/** Pergunta não é fato durável: "o que eu disse que prefiro?" fica episódica. */
export function ehPergunta(texto: string): boolean {
  return /\?\s*$/.test(texto.trim()) || /^(o que|qual|quais|quando|onde|como|por que|quem|cad[êe]|será que)\b/i.test(texto.trim());
}

export function classificarSetor(texto: string): Setor {
  return !ehPergunta(texto) && SINAIS_SEMANTICOS.test(texto) ? 'semantic' : 'episodic';
}

export function hashConteudo(texto: string): string {
  return createHash('sha1').update(texto.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex');
}

export class Cerebro {
  constructor(private readonly db: Database.Database, private readonly agora: () => number) {}

  salvar(chatId: string, content: string, sector: Setor = classificarSetor(content), origem = 'v3', topicKey?: string): Memoria | null {
    const h = hashConteudo(content);
    // Dedupe exato barato (TODO #5 parte 1): mesma frase normalizada no mesmo chat só toca salience.
    const igual = this.db.prepare('SELECT * FROM memories WHERE chat_id = ? AND hash = ? AND superseded_by IS NULL').get(chatId, h) as Memoria | undefined;
    if (igual) { this.tocar(igual.id, 0.2); return null; }
    const t = this.agora();
    const r = this.db.prepare(
      `INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at, origem, hash)
       VALUES (?, ?, ?, ?, 1.0, ?, ?, ?, ?)`,
    ).run(chatId, topicKey ?? null, content, sector, t, t, origem, h);
    return this.obter(Number(r.lastInsertRowid));
  }

  obter(id: number): Memoria | null {
    return (this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memoria | undefined) ?? null;
  }

  tocar(id: number, ganho = 0.1): void {
    this.db.prepare('UPDATE memories SET accessed_at = ?, salience = MIN(salience + ?, 2.0) WHERE id = ?').run(this.agora(), ganho, id);
  }

  /** FTS5. Consulta saneada: cada palavra vira termo com prefixo; sem operadores. */
  buscar(chatId: string, consulta: string, limite = 3): Memoria[] {
    const termos = consulta.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length >= 3).slice(0, 8);
    if (!termos.length) return [];
    const q = termos.map((t) => `"${t}"*`).join(' OR ');
    try {
      return this.db.prepare(
        `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
          WHERE memories_fts MATCH ? AND m.chat_id = ? AND m.superseded_by IS NULL
          ORDER BY bm25(memories_fts) * (1.0 / MAX(m.salience, 0.05)) LIMIT ?`,
      ).all(q, chatId, limite) as Memoria[];
    } catch { return []; }
  }

  recentes(chatId: string, limite = 5): Memoria[] {
    return this.db.prepare(
      `SELECT * FROM memories WHERE chat_id = ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT ?`,
    ).all(chatId, limite) as Memoria[];
  }

  importantes(chatId: string, limite = 3): Memoria[] {
    return this.db.prepare(
      `SELECT * FROM memories WHERE chat_id = ? AND superseded_by IS NULL AND sector = 'semantic'
        ORDER BY salience DESC, accessed_at DESC LIMIT ?`,
    ).all(chatId, limite) as Memoria[];
  }

  listar(chatId: string, limite = 50): Memoria[] {
    return this.db.prepare(
      `SELECT * FROM memories WHERE chat_id = ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT ?`,
    ).all(chatId, limite) as Memoria[];
  }

  esquecer(id: number): boolean {
    return this.db.prepare('DELETE FROM memory_vec WHERE memory_id = ?').run(id) !== undefined
      && this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes === 1;
  }

  /** `superseded` nunca deleta, só esconde (risco §7). */
  substituir(antigaId: number, novaId: number): void {
    this.db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL').run(novaId, antigaId);
  }

  /** Decaimento 2 %/dia nas episódicas; semânticas 0,5 %/dia; remove < 0,05 sem acesso há 30 dias. */
  decair(): { decaidas: number; removidas: number } {
    const dia = 86400;
    const t = this.agora();
    const a = this.db.prepare(
      `UPDATE memories SET salience = salience * (CASE sector WHEN 'semantic' THEN 0.995 ELSE 0.98 END)
        WHERE accessed_at < ?`,
    ).run(t - dia);
    const ids = this.db.prepare('SELECT id FROM memories WHERE salience < 0.05 AND accessed_at < ?').all(t - 30 * dia) as { id: number }[];
    for (const { id } of ids) this.esquecer(id);
    return { decaidas: a.changes, removidas: ids.length };
  }

  contagem(chatId?: string): { total: number; semanticas: number; episodicas: number } {
    const w = chatId ? 'WHERE chat_id = ? AND superseded_by IS NULL' : 'WHERE superseded_by IS NULL';
    const args = chatId ? [chatId] : [];
    return this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN sector='semantic' THEN 1 ELSE 0 END),0) AS semanticas,
              COALESCE(SUM(CASE WHEN sector='episodic' THEN 1 ELSE 0 END),0) AS episodicas
         FROM memories ${w}`,
    ).get(...args) as { total: number; semanticas: number; episodicas: number };
  }

  // ---- vetores -------------------------------------------------------------

  gravarVetor(memoryId: number, modelo: string, vetor: number[]): void {
    const buf = Buffer.from(new Float32Array(vetor).buffer);
    this.db.prepare('INSERT OR REPLACE INTO memory_vec (memory_id, modelo, dim, vetor) VALUES (?, ?, ?, ?)').run(memoryId, modelo, vetor.length, buf);
  }

  semVetor(limite = 50): Memoria[] {
    return this.db.prepare(
      `SELECT m.* FROM memories m LEFT JOIN memory_vec v ON v.memory_id = m.id
        WHERE v.memory_id IS NULL AND m.superseded_by IS NULL ORDER BY m.id DESC LIMIT ?`,
    ).all(limite) as Memoria[];
  }

  /** Cosseno em JS: volume pequeno (centenas), não precisa de extensão nativa. */
  buscarVetor(chatId: string, consulta: number[], limite = 3, minimo = 0.55): (Memoria & { score: number })[] {
    const linhas = this.db.prepare(
      `SELECT m.*, v.vetor AS _v FROM memories m JOIN memory_vec v ON v.memory_id = m.id
        WHERE m.chat_id = ? AND m.superseded_by IS NULL`,
    ).all(chatId) as (Memoria & { _v: Buffer })[];
    const q = new Float32Array(consulta);
    const nq = Math.hypot(...q);
    const out: (Memoria & { score: number })[] = [];
    for (const l of linhas) {
      const v = new Float32Array(l._v.buffer, l._v.byteOffset, l._v.byteLength / 4);
      if (v.length !== q.length) continue;
      let dot = 0, nv = 0;
      for (let i = 0; i < v.length; i++) { dot += v[i] * q[i]; nv += v[i] * v[i]; }
      const score = dot / (Math.sqrt(nv) * nq || 1);
      if (score >= minimo) { const { _v, ...resto } = l; void _v; out.push({ ...resto, score }); }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limite);
  }

  // ---- conversa --------------------------------------------------------------

  logarTurno(chatId: string, canal: string, role: 'user' | 'assistant', content: string, sessionId?: string, agentId = 'main'): void {
    this.db.prepare(
      'INSERT INTO conversation_log (chat_id, canal, role, content, session_id, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(chatId, canal, role, content.slice(0, 8000), sessionId ?? null, agentId, this.agora());
  }

  ultimosTurnos(chatId: string, n = 8): { role: 'user' | 'assistant'; content: string }[] {
    const l = this.db.prepare(
      'SELECT role, content FROM conversation_log WHERE chat_id = ? ORDER BY id DESC LIMIT ?',
    ).all(chatId, n) as { role: 'user' | 'assistant'; content: string }[];
    return l.reverse();
  }

  podarConversa(manterPorChat = 500): number {
    return this.db.prepare(
      `DELETE FROM conversation_log WHERE id IN (
         SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY id DESC) AS rn FROM conversation_log) WHERE rn > ?)`,
    ).run(manterPorChat).changes;
  }

  limparConversa(chatId: string): number {
    return this.db.prepare('DELETE FROM conversation_log WHERE chat_id = ?').run(chatId).changes;
  }

  insights(chatId: string, limite = 3): { id: number; texto: string }[] {
    return this.db.prepare('SELECT id, texto FROM insights WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(chatId, limite) as { id: number; texto: string }[];
  }

  gravarInsight(chatId: string, texto: string, fontes: number[]): void {
    this.db.prepare('INSERT INTO insights (chat_id, texto, fontes, created_at) VALUES (?, ?, ?, ?)').run(chatId, texto, JSON.stringify(fontes), this.agora());
  }
}
