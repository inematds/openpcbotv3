// Publicação: histórico do yt-pubx (só o fim do JSONL) e filas de publicação
// (espanhol, cidades, r7ex). Registros antigos sem todos os campos são aceitos.
import type { DepsPainel } from '../tipos.js';
import { corta, inicioDoDia, lerFim, lerJson, linhasJson, paraEpoch } from '../util.js';

const ID_YT = /^[\w-]{11}$/;
/** Erro em fila só vira alerta se o item for recente (o antigo fica só como contagem). */
export const JANELA_ERRO_FILA_S = 48 * 3600;

export interface Upload { quando: number; canal: string; video_id: string | null; url: string | null; titulo: string; publico: boolean | null; thumb_ok: boolean | null; miniatura: string | null }

/** Parser tolerante do historico.jsonl: ignora linha quebrada, aceita campo ausente. */
export function lerHistorico(texto: string): Upload[] {
  const out: Upload[] = [];
  for (const r of linhasJson<Record<string, unknown>>(texto)) {
    const quando = paraEpoch(r.data ?? r.quando ?? r.ts);
    if (quando === null) continue;
    let vid = typeof r.video_id === 'string' ? r.video_id : null;
    if (!vid && typeof r.url === 'string') vid = /(?:v=|shorts\/|youtu\.be\/)([\w-]{11})/.exec(r.url)?.[1] ?? null;
    if (vid && !ID_YT.test(vid)) vid = null;
    const priv = r.privacy as { privacyStatus?: string } | string | undefined;
    const ps = typeof priv === 'string' ? priv : priv?.privacyStatus;
    out.push({
      quando, canal: typeof r.canal === 'string' && r.canal ? r.canal : '?', video_id: vid,
      url: typeof r.url === 'string' ? r.url : (vid ? `https://www.youtube.com/watch?v=${vid}` : null),
      titulo: corta(r.titulo ?? '', 120), publico: ps ? ps === 'public' : null,
      thumb_ok: typeof r.thumb_ok === 'boolean' ? r.thumb_ok : null,
      miniatura: vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : null,
    });
  }
  return out.sort((a, b) => b.quando - a.quando);
}

export interface ResumoFila { nome: string; total: number; por_estado: Record<string, number>; erros_recentes: { id: string; nome: string; erro: string }[]; proximo: string | null }

export function resumirFila(nome: string, itens: unknown, agora: number): ResumoFila | null {
  const lista = Array.isArray(itens) ? itens : (itens && typeof itens === 'object' && Array.isArray((itens as { itens?: unknown[] }).itens) ? (itens as { itens: unknown[] }).itens : null);
  if (!lista) return null;
  const por: Record<string, number> = {};
  const erros: ResumoFila['erros_recentes'] = [];
  let proximo: string | null = null;
  for (const x of lista as Record<string, unknown>[]) {
    const st = String(x?.estado ?? 'sem estado');
    por[st] = (por[st] ?? 0) + 1;
    if (st === 'erro') {
      const t = paraEpoch(x.erro_em ?? x.quando ?? x.atualizado_em);
      if (t !== null && agora - t < JANELA_ERRO_FILA_S) erros.push({ id: String(x.id ?? ''), nome: corta(x.nome ?? x.titulo ?? '', 80), erro: corta(String(x.erro ?? '').trim(), 160) });
    }
    if (!proximo && (st === 'pendente' || st === 'na_fila' || st === 'agendado')) proximo = corta(x.nome ?? x.titulo ?? x.id ?? '', 80);
  }
  return { nome, total: lista.length, por_estado: por, erros_recentes: erros, proximo };
}

export function coletarPublicacao(d: DepsPainel) {
  const agora = d.agora();
  const ausentes: string[] = [];
  const texto = lerFim(d.caminhos.ytHistorico, 384 * 1024);
  let hoje: Upload[] = [], semana: Record<string, number> = {}, ultimos: Upload[] = [];
  if (texto === null) ausentes.push('historico do yt-pubx');
  else {
    const todos = lerHistorico(texto);
    const ini = inicioDoDia(agora);
    hoje = todos.filter((u) => u.quando >= ini);
    for (const u of todos.filter((x) => agora - x.quando < 7 * 86400)) semana[u.canal] = (semana[u.canal] ?? 0) + 1;
    semana = Object.fromEntries(Object.entries(semana).sort((a, b) => b[1] - a[1]));
    ultimos = todos.slice(0, 10);
  }
  const filas: ResumoFila[] = [];
  for (const [nome, cam] of [['espanhol', d.caminhos.filaEspanhol], ['cidades', d.caminhos.filaCidades], ['r7ex', d.caminhos.filaR7ex]] as const) {
    const r = resumirFila(nome, lerJson(cam), agora);
    if (r) filas.push(r); else ausentes.push(`fila ${nome}`);
  }
  const hojePorCanal: Record<string, number> = {};
  for (const u of hoje) hojePorCanal[u.canal] = (hojePorCanal[u.canal] ?? 0) + 1;
  return { dados: { hoje: hoje.length, hoje_por_canal: hojePorCanal, semana_por_canal: semana, ultimos, filas }, ausentes };
}
