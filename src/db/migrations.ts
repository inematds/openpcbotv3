// Migrations versionadas com checksum (portado do inemaccbot). O boot RECUSA
// subir se o SQL de uma migration já aplicada mudou — divergência silenciosa
// de schema é a pior classe de bug num sistema que guarda estado.
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  nome: string;
  sql: string;
}

export function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Migrations do sistema, em ordem crescente de `version`. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    nome: 'jobs',
    sql: `
      CREATE TABLE jobs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        fila           TEXT    NOT NULL,
        kind           TEXT    NOT NULL,
        tarefa         TEXT    NOT NULL,
        input          TEXT    NOT NULL,
        prioridade     INTEGER NOT NULL DEFAULT 0,
        status         TEXT    NOT NULL DEFAULT 'queued',
        tentativas     INTEGER NOT NULL DEFAULT 0,
        max_tentativas INTEGER NOT NULL DEFAULT 1,
        lease_ate      INTEGER,
        disponivel_em  INTEGER NOT NULL DEFAULT 0,
        idem_key       TEXT,
        flow_ref       TEXT,
        chat_id        INTEGER,
        motor          TEXT,
        modelo         TEXT,
        esforco        TEXT,
        resultado      TEXT,
        erro           TEXT,
        criado_em      INTEGER NOT NULL,
        iniciado_em    INTEGER,
        terminado_em   INTEGER
      );
      CREATE INDEX idx_jobs_claim
        ON jobs (fila, status, disponivel_em, prioridade DESC, id);
      CREATE INDEX idx_jobs_flow_ref ON jobs (flow_ref);
      CREATE INDEX idx_jobs_idem_key ON jobs (idem_key);
    `,
  },
  {
    version: 2,
    nome: 'lease_owner',
    sql: `
      ALTER TABLE jobs ADD COLUMN lease_owner TEXT;
    `,
  },
  {
    version: 3,
    nome: 'notificado_em',
    sql: `
      ALTER TABLE jobs ADD COLUMN notificado_em INTEGER;
      CREATE INDEX idx_jobs_pendente_notificacao
        ON jobs (status, notificado_em, chat_id);
      UPDATE jobs SET notificado_em = criado_em
        WHERE status IN ('done', 'failed', 'canceled');
    `,
  },
  {
    version: 4,
    nome: 'cerebro',
    // Mesma tabela `memories` do v2 (plano §4.4) — a importação é linha a linha,
    // sem tradução. `superseded_by` e `hash` são os campos novos da consolidação:
    // `superseded` nunca deleta, só esconde (risco §7).
    sql: `
      CREATE TABLE memories (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id       TEXT NOT NULL,
        topic_key     TEXT,
        content       TEXT NOT NULL,
        sector        TEXT NOT NULL DEFAULT 'semantic',
        salience      REAL NOT NULL DEFAULT 1.0,
        created_at    INTEGER NOT NULL,
        accessed_at   INTEGER NOT NULL,
        superseded_by INTEGER,
        origem        TEXT NOT NULL DEFAULT 'v3',
        hash          TEXT
      );
      CREATE INDEX idx_memories_chat ON memories(chat_id, created_at DESC);
      CREATE INDEX idx_memories_sector ON memories(chat_id, sector);
      CREATE INDEX idx_memories_hash ON memories(hash);

      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content, content=memories, content_rowid=id
      );
      CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
      CREATE TRIGGER memories_fts_update AFTER UPDATE OF content ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;

      -- Vetor bge-m3 (1024 floats little-endian num BLOB). Volume pequeno:
      -- cosseno em JS resolve, sem extensão nativa.
      CREATE TABLE memory_vec (
        memory_id INTEGER PRIMARY KEY REFERENCES memories(id),
        modelo    TEXT NOT NULL,
        dim       INTEGER NOT NULL,
        vetor     BLOB NOT NULL
      );

      CREATE TABLE conversation_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id    TEXT NOT NULL,
        canal      TEXT NOT NULL DEFAULT 'telegram',
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        session_id TEXT,
        agent_id   TEXT NOT NULL DEFAULT 'main',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_convo_log_chat ON conversation_log(chat_id, created_at DESC);

      CREATE TABLE insights (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id    TEXT NOT NULL,
        texto      TEXT NOT NULL,
        fontes     TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE hive_mind (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id   TEXT NOT NULL,
        chat_id    TEXT NOT NULL,
        action     TEXT NOT NULL,
        summary    TEXT NOT NULL,
        artifacts  TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_hive_mind_time ON hive_mind(created_at DESC);

      -- Propostas de entrada no MEMORY.md / USER.md: o agente propõe, você aprova.
      CREATE TABLE propostas_vault (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id    TEXT NOT NULL,
        arquivo    TEXT NOT NULL,
        texto      TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'pendente',
        created_at INTEGER NOT NULL,
        decidido_em INTEGER
      );
    `,
  },
  {
    version: 5,
    nome: 'custo',
    // Toda chamada de LLM passa por aqui (regra de ouro 2), inclusive Ollama
    // (custo zero, mas conta tokens e tempo).
    sql: `
      CREATE TABLE chamadas_llm (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id      TEXT,
        provedor      TEXT NOT NULL,
        modelo        TEXT NOT NULL,
        tier          TEXT NOT NULL,
        agente        TEXT,
        job_id        INTEGER,
        chat_id       TEXT,
        tokens_in     INTEGER NOT NULL DEFAULT 0,
        tokens_out    INTEGER NOT NULL DEFAULT 0,
        tokens_cache  INTEGER NOT NULL DEFAULT 0,
        custo_usd     REAL NOT NULL DEFAULT 0,
        latencia_ms   INTEGER NOT NULL DEFAULT 0,
        ok            INTEGER NOT NULL DEFAULT 1,
        erro          TEXT,
        motivo_tier   TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_chamadas_dia ON chamadas_llm(created_at DESC);
      CREATE INDEX idx_chamadas_agente ON chamadas_llm(agente, created_at DESC);
    `,
  },
  {
    version: 6,
    nome: 'tarefas',
    sql: `
      CREATE TABLE cron_jobs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        nome        TEXT NOT NULL UNIQUE,
        expressao   TEXT NOT NULL,
        tarefa      TEXT NOT NULL,
        input       TEXT NOT NULL DEFAULT '',
        sessao      TEXT NOT NULL DEFAULT 'isolada',
        canal       TEXT NOT NULL DEFAULT 'telegram',
        chat_id     TEXT,
        ativo       INTEGER NOT NULL DEFAULT 1,
        proxima_em  INTEGER,
        ultima_em   INTEGER,
        ultimo_job  INTEGER,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE tarefas_usuario (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     TEXT NOT NULL,
        texto       TEXT NOT NULL,
        feita       INTEGER NOT NULL DEFAULT 0,
        lembrar_em  INTEGER,
        lembrado_em INTEGER,
        created_at  INTEGER NOT NULL,
        feita_em    INTEGER
      );
      CREATE INDEX idx_tarefas_chat ON tarefas_usuario(chat_id, feita, created_at DESC);

      CREATE TABLE sessions (
        chat_id     TEXT NOT NULL,
        agente      TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        ultimo_uso  INTEGER NOT NULL,
        PRIMARY KEY (chat_id, agente)
      );

      CREATE TABLE heartbeat (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        ultimo_em   INTEGER NOT NULL,
        detalhe     TEXT
      );
    `,
  },
];

const SCHEMA_CONTROLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    nome       TEXT    NOT NULL,
    checksum   TEXT    NOT NULL,
    applied_at INTEGER NOT NULL
  );
`;

export function aplicarMigrations(
  db: Database.Database,
  agora: () => number,
  migrations: Migration[] = MIGRATIONS,
): number {
  db.exec(SCHEMA_CONTROLE);

  const aplicadas = new Map<number, string>(
    (db.prepare('SELECT version, checksum FROM schema_migrations').all() as {
      version: number; checksum: string;
    }[]).map((l) => [l.version, l.checksum]),
  );

  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  for (const m of sorted) {
    const soma = checksum(m.sql);
    const anterior = aplicadas.get(m.version);
    if (anterior !== undefined && anterior !== soma) {
      throw new Error(
        `migration ${m.version} (${m.nome}): checksum divergente — o SQL mudou depois de aplicado`,
      );
    }
  }

  let n = 0;
  for (const m of sorted) {
    const soma = checksum(m.sql);
    if (aplicadas.get(m.version) !== undefined) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, nome, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(m.version, m.nome, soma, agora());
    })();
    n += 1;
  }
  return n;
}
