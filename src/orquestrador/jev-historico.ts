// Histórico das comparações Jev (tabela jev_comparacoes). Nunca guarda a mensagem.
import type Database from 'better-sqlite3';

export interface ComparacaoJev {
  em: number; traceId?: string; modelo?: string; rotaAtual: string; sugestao?: string; skill?: string;
  confidence?: number; probabilidade?: number; skillConfidence?: number; skillProbabilidade?: number;
  revisar: boolean; concorda?: boolean; custoUsd: number | null; latenciaMs?: number; erro: string | null;
}

export function gravarComparacao(db: Database.Database, chatId: string, c: ComparacaoJev): void {
  db.prepare(`INSERT INTO jev_comparacoes (chat_id, trace_id, em, modelo, rota_atual, sugestao, skill, confidence,
    probabilidade, skill_confidence, skill_probabilidade, revisar, concorda, custo_usd, latencia_ms, erro)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    chatId, c.traceId ?? null, c.em, c.modelo ?? null, c.rotaAtual, c.sugestao ?? null, c.skill ?? null,
    c.confidence ?? null, c.probabilidade ?? null, c.skillConfidence ?? null, c.skillProbabilidade ?? null,
    c.revisar ? 1 : 0, c.concorda === undefined ? null : c.concorda ? 1 : 0, c.custoUsd, c.latenciaMs ?? null, c.erro,
  );
}

interface Linha { em: number; rota_atual: string; sugestao: string | null; skill: string | null; confidence: number | null; revisar: number; concorda: number | null; custo_usd: number | null; erro: string | null }

/** Resumo + últimas `n` comparações do chat, em texto para /jev historico e CLI. */
export function historicoJev(db: Database.Database, chatId: string, n = 10): string {
  const lim = Math.min(Math.max(Math.trunc(n) || 10, 1), 50);
  const r = db.prepare(`SELECT COUNT(*) total, SUM(erro IS NULL) ok, SUM(concorda = 1) concordou,
    SUM(erro IS NULL AND revisar = 0) confiante, COALESCE(SUM(custo_usd), 0) custo, MIN(em) desde
    FROM jev_comparacoes WHERE chat_id = ?`).get(chatId) as { total: number; ok: number | null; concordou: number | null; confiante: number | null; custo: number; desde: number | null };
  if (!r.total) return 'Histórico Jev vazio neste chat. As comparações passam a ser guardadas a partir da versão 3.4.4.';
  const ok = r.ok ?? 0;
  const pct = (x: number | null): string => ok ? `${Math.round(100 * (x ?? 0) / ok)}%` : '—';
  const linhas = db.prepare(`SELECT em, rota_atual, sugestao, skill, confidence, revisar, concorda, custo_usd, erro
    FROM jev_comparacoes WHERE chat_id = ? ORDER BY em DESC, id DESC LIMIT ?`).all(chatId, lim) as Linha[];
  const cab = [
    `Histórico Jev: ${r.total} comparações desde ${new Date(r.desde! * 1000).toISOString().slice(0, 10)} (${r.total - ok} com erro).`,
    `Concordância com o roteador: ${r.concordou ?? 0}/${ok} (${pct(r.concordou)}) · confiantes: ${r.confiante ?? 0}/${ok} (${pct(r.confiante)}) · custo total US$ ${r.custo.toFixed(6)}`,
    `Últimas ${linhas.length}:`,
  ];
  const itens = linhas.map((l) => {
    const quando = new Date(l.em * 1000).toISOString().slice(5, 16).replace('T', ' ');
    if (l.erro) return `${quando} · atual ${l.rota_atual} · erro`;
    return `${quando} · atual ${l.rota_atual} · Jev ${l.sugestao} (${l.confidence}) · skill ${l.skill} · ${l.concorda ? 'concorda' : 'diverge'}${l.revisar ? ' · revisar' : ''}`;
  });
  return [...cab, ...itens].join('\n');
}

/** Relatório de um período (dia = últimas 24 h, semana = últimos 7 dias) para /jev relatorio e cron. */
export function relatorioJev(db: Database.Database, chatId: string, periodo: 'dia' | 'semana', agora: number): string {
  const desde = agora - (periodo === 'dia' ? 86_400 : 7 * 86_400);
  const titulo = periodo === 'dia' ? 'Relatório Jev — últimas 24 h' : 'Relatório Jev — últimos 7 dias';
  const r = db.prepare(`SELECT COUNT(*) total, SUM(erro IS NULL) ok, SUM(concorda = 1) concordou,
    SUM(erro IS NULL AND revisar = 0) confiante, SUM(sugestao = 'incerto') incerto,
    COALESCE(SUM(custo_usd), 0) custo, AVG(CASE WHEN erro IS NULL THEN latencia_ms END) lat,
    SUM(erro IS NULL AND revisar = 0 AND concorda = 0) divergeConfiante
    FROM jev_comparacoes WHERE chat_id = ? AND em >= ?`).get(chatId, desde) as {
    total: number; ok: number | null; concordou: number | null; confiante: number | null; incerto: number | null;
    custo: number; lat: number | null; divergeConfiante: number | null };
  if (!r.total) return `${titulo}\nNenhuma comparação no período. Observação: /jev observar liga, /jev mostra o modo.`;
  const ok = r.ok ?? 0;
  const pct = (x: number | null): string => ok ? `${Math.round(100 * (x ?? 0) / ok)}%` : '—';
  const pares = db.prepare(`SELECT rota_atual, sugestao, COUNT(*) n FROM jev_comparacoes
    WHERE chat_id = ? AND em >= ? AND erro IS NULL AND concorda = 0
    GROUP BY rota_atual, sugestao ORDER BY n DESC LIMIT 5`).all(chatId, desde) as { rota_atual: string; sugestao: string; n: number }[];
  const skills = db.prepare(`SELECT skill, COUNT(*) n FROM jev_comparacoes
    WHERE chat_id = ? AND em >= ? AND erro IS NULL AND skill LIKE 'skill:%'
    GROUP BY skill ORDER BY n DESC LIMIT 5`).all(chatId, desde) as { skill: string; n: number }[];
  return [
    titulo,
    `Comparações: ${r.total} (${r.total - ok} com erro)`,
    `Concordância com o roteador: ${r.concordou ?? 0}/${ok} (${pct(r.concordou)})`,
    `Jev confiante (rota e skill ≥ 0,9): ${r.confiante ?? 0}/${ok} (${pct(r.confiante)}) · incerto: ${r.incerto ?? 0}`,
    `Divergências com Jev confiante: ${r.divergeConfiante ?? 0} (as que valem revisar)`,
    `Custo: US$ ${r.custo.toFixed(6)} · latência média: ${r.lat === null ? '—' : Math.round(r.lat) + ' ms'}`,
    ...(pares.length ? ['Divergências mais comuns (atual → Jev):', ...pares.map((p) => `  ${p.rota_atual} → ${p.sugestao}: ${p.n}`)] : []),
    ...(skills.length ? ['Skills sugeridas:', ...skills.map((s) => `  ${s.skill}: ${s.n}`)] : []),
    'Só observação: nenhuma rota foi alterada.',
  ].join('\n');
}
