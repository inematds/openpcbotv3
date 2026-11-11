// Bots: o banco do próprio v3 (jobs, falhas 24 h, sessões, custo do dia, cron),
// o banco do inemaccbot aberto SOMENTE LEITURA e o estado dos serviços.
// Consultas sempre por faixa de `id` (o `jobs` do v3 passa de 100 mil linhas e
// não tem índice por status sozinho).
import Database from 'better-sqlite3';

import type { DepsPainel } from '../tipos.js';
import { corta, inicioDoDia, paraEpoch } from '../util.js';

export const SERVICOS = ['openpcbotv3', 'inemaccbot', 'openpcbot'] as const;
/** Janela de ids olhada no v3 (≈ 3–4 dias de jobs). */
const JANELA_V3 = 8000;
const JANELA_ACCBOT = 600;

/** Abre um SQLite alheio só para leitura: `readonly`, `fileMustExist`, timeout curto (não congela o bot). */
export function abrirSomenteLeitura(caminho: string): Database.Database {
  return new Database(caminho, { readonly: true, fileMustExist: true, timeout: 300 });
}

let accbot: { caminho: string; db: Database.Database } | null = null;
function dbAccbot(caminho: string): Database.Database {
  if (accbot && accbot.caminho === caminho && accbot.db.open) return accbot.db;
  accbot = { caminho, db: abrirSomenteLeitura(caminho) };
  return accbot.db;
}
export function fecharAccbot(): void { try { accbot?.db.close(); } catch { /* já fechado */ } accbot = null; }

export interface Falha { id: number; tarefa: string; fila: string; quando: number | null; erro: string }

function colunas(db: Database.Database, tabela: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name));
}

export function lerV3(db: Database.Database, agora: number) {
  const hoje = inicioDoDia(agora);
  const max = (db.prepare('SELECT max(id) m FROM jobs').get() as { m: number | null }).m ?? 0;
  const piso = Math.max(0, max - JANELA_V3);
  const porEstado = Object.fromEntries((db.prepare('SELECT status, count(*) n FROM jobs WHERE id > ? GROUP BY status').all(piso) as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const ativos = (db.prepare("SELECT status, count(*) n FROM jobs WHERE id > ? AND status IN ('queued','running') GROUP BY status").all(piso) as { status: string; n: number }[]);
  const hojeN = (db.prepare('SELECT count(*) n FROM jobs WHERE id > ? AND criado_em >= ?').get(piso, hoje) as { n: number }).n;
  const falhas = (db.prepare("SELECT id, tarefa, fila, terminado_em, erro, resultado FROM jobs WHERE id > ? AND status = 'failed' AND coalesce(terminado_em, criado_em) >= ? ORDER BY id DESC LIMIT 20").all(piso, agora - 86400) as { id: number; tarefa: string; fila: string; terminado_em: number | null; erro: string | null; resultado: string | null }[])
    .map((f): Falha => ({ id: f.id, tarefa: f.tarefa, fila: f.fila, quando: f.terminado_em, erro: corta(f.erro || f.resultado || '', 240) }));
  const sessoes = (db.prepare('SELECT count(*) n FROM sessions WHERE ultimo_uso >= ?').get(agora - 3600) as { n: number }).n;
  const custo = db.prepare('SELECT count(*) chamadas, coalesce(sum(custo_usd),0) usd FROM chamadas_llm WHERE created_at >= ?').get(hoje) as { chamadas: number; usd: number };
  const cron = (db.prepare('SELECT nome, expressao, ativo, proxima_em, ultima_em FROM cron_jobs WHERE ativo = 1 ORDER BY proxima_em LIMIT 6').all()) as { nome: string; expressao: string; ativo: number; proxima_em: number | null; ultima_em: number | null }[];
  return {
    jobs: { por_estado_recente: porEstado, rodando: ativos.find((a) => a.status === 'running')?.n ?? 0, na_fila: ativos.find((a) => a.status === 'queued')?.n ?? 0, criados_hoje: hojeN },
    falhas_24h: falhas, sessoes_1h: sessoes, custo_hoje: { chamadas: custo.chamadas, usd: Math.round(custo.usd * 1000) / 1000 }, cron,
  };
}

/** Resultado completo de uma falha do v3 (rota de detalhe, aberta no clique). */
export function falhaCompletaV3(db: Database.Database, id: number): Record<string, unknown> | null {
  const r = db.prepare('SELECT id, fila, tarefa, status, tentativas, max_tentativas, erro, resultado, criado_em, iniciado_em, terminado_em FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return { ...r, erro: corta(r.erro, 20000), resultado: corta(r.resultado, 20000) };
}

export function falhaCompletaAccbot(caminho: string, id: number): Record<string, unknown> | null {
  const db = dbAccbot(caminho);
  const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  const { input: _i, ...resto } = r;
  return { ...resto, erro: corta(r.erro, 20000), resultado: corta(r.resultado, 20000) };
}

export function lerAccbot(caminho: string, agora: number) {
  const db = dbAccbot(caminho);
  const cj = colunas(db, 'jobs');
  const temErro = cj.has('erro');
  const max = (db.prepare('SELECT max(id) m FROM jobs').get() as { m: number | null }).m ?? 0;
  const ativos = db.prepare("SELECT status, count(*) n FROM jobs WHERE id > ? AND status IN ('queued','running') GROUP BY status").all(Math.max(0, max - 5000)) as { status: string; n: number }[];
  const recentes = db.prepare(`SELECT id, fila, tarefa, status, ${temErro ? 'erro' : "'' AS erro"}, criado_em, terminado_em FROM jobs WHERE id > ? ORDER BY id DESC`).all(Math.max(0, max - JANELA_ACCBOT)) as { id: number; fila: string; tarefa: string; status: string; erro: string | null; criado_em: unknown; terminado_em: unknown }[];
  const falhas: Falha[] = [];
  for (const j of recentes) {
    if (j.status !== 'failed') continue;
    const t = paraEpoch(j.terminado_em) ?? paraEpoch(j.criado_em);
    if (t === null || agora - t > 86400) continue;
    falhas.push({ id: j.id, tarefa: j.tarefa, fila: j.fila, quando: t, erro: corta(j.erro, 240) });
    if (falhas.length >= 20) break;
  }
  let fluxos: { id: number; tipo: string; slug: string; status: string; criado_em: number | null }[] = [];
  let aguardandoOk: { fluxo_id: number; fase: string; slug: string }[] = [];
  try {
    fluxos = (db.prepare("SELECT id, tipo, slug, status, criado_em FROM fluxos WHERE status NOT IN ('feito','falhou','cancelado') ORDER BY id DESC LIMIT 10").all() as { id: number; tipo: string; slug: string; status: string; criado_em: unknown }[])
      .map((f) => ({ ...f, slug: corta(f.slug, 60), criado_em: paraEpoch(f.criado_em) }));
    aguardandoOk = (db.prepare("SELECT ff.fluxo_id, ff.fase, f.slug FROM fluxo_fases ff JOIN fluxos f ON f.id = ff.fluxo_id WHERE ff.estado = 'aguardando-ok' AND f.status NOT IN ('feito','falhou','cancelado') ORDER BY ff.fluxo_id DESC LIMIT 10").all() as { fluxo_id: number; fase: string; slug: string }[])
      .map((a) => ({ ...a, slug: corta(a.slug, 60) }));
  } catch { /* tabelas de fluxo ausentes numa versão antiga */ }
  return {
    jobs: { rodando: ativos.find((a) => a.status === 'running')?.n ?? 0, na_fila: ativos.find((a) => a.status === 'queued')?.n ?? 0 },
    falhas_24h: falhas, fluxos_abertos: fluxos, aguardando_ok: aguardandoOk,
  };
}

/** Bot v2 (openpcbotv2): conversa, custo e vídeos do banco dele, SOMENTE LEITURA (Nei, 11/11: "card do inemaccbot e do v2 e v3"). */
export function lerV2(caminho: string, agora: number) {
  const db = abrirSomenteLeitura(caminho);
  try {
    const um = <T>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as T;
    const msgs = um<{ ult: number | null; d1: number; d7: number }>('SELECT max(created_at) ult, sum(created_at >= ?) d1, sum(created_at >= ?) d7 FROM conversation_log', agora - 86400, agora - 7 * 86400);
    const custo = um<{ usd: number | null }>('SELECT sum(cost_usd) usd FROM token_usage WHERE created_at >= ?', agora - 7 * 86400);
    const porEstado = Object.fromEntries((db.prepare('SELECT status, count(*) n FROM video_jobs GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    const ult = um<{ id: number; skill: string; status: string; created_at: number; error: string | null } | undefined>('SELECT id, skill, status, created_at, error FROM video_jobs ORDER BY id DESC LIMIT 1');
    const tarefas = um<{ n: number }>("SELECT count(*) n FROM scheduled_tasks WHERE status = 'active'").n;
    return {
      ultima_msg: msgs.ult, msgs_24h: msgs.d1 ?? 0, msgs_7d: msgs.d7 ?? 0, custo_7d_usd: Math.round((custo.usd ?? 0) * 1000) / 1000,
      videos: porEstado, ultimo_video: ult ? { id: ult.id, skill: ult.skill, status: ult.status, quando: ult.created_at, erro: ult.error ? corta(ult.error, 160) : null } : null,
      tarefas_agendadas: tarefas,
    };
  } finally { db.close(); }
}

export async function estadoServicos(d: DepsPainel): Promise<Record<string, string>> {
  return d.cache.obter('bots:servicos', 30_000, async () => {
    const r = await d.exec('systemctl', ['--user', 'is-active', ...SERVICOS], 4000);
    const linhas = r.stdout.trim().split('\n');
    if (!r.stdout.trim()) return Object.fromEntries(SERVICOS.map((s) => [s, 'desconhecido']));
    return Object.fromEntries(SERVICOS.map((s, i) => [s, (linhas[i] ?? 'desconhecido').trim()]));
  });
}

export async function coletarBots(d: DepsPainel) {
  const ausentes: string[] = [];
  let v3: ReturnType<typeof lerV3> | null = null, inemaccbot: ReturnType<typeof lerAccbot> | null = null, v2: ReturnType<typeof lerV2> | null = null;
  if (d.db) { try { v3 = lerV3(d.db, d.agora()); } catch { ausentes.push('banco do v3'); } } else ausentes.push('banco do v3');
  try { inemaccbot = lerAccbot(d.caminhos.inemaccbotDb, d.agora()); } catch { ausentes.push('inemaccbot.db'); fecharAccbot(); }
  try { v2 = await d.cache.obter('bots:v2', 60_000, () => lerV2(d.caminhos.v2Db, d.agora())); } catch { ausentes.push('banco do v2'); }
  const servicos = await estadoServicos(d);
  return { dados: { v3, inemaccbot, v2, servicos }, ausentes };
}
