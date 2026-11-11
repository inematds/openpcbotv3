// Quadro "Outras APIs" (Nei, 10/11/2026: "outro card com outras apis"): o uso medido pelo v3 (chamadas_llm, hoje e 7 dias)
// e a lista de APIs com o que está liberado, de ~/.config/inema/painel-apis.json (editável; espelha as regras do CLAUDE.md).
// Não chama API nenhuma: saldo de serviço externo só entra se alguém gravar no arquivo.
import type { DepsPainel } from '../tipos.js';
import { inicioDoDia, lerJson } from '../util.js';
import { lerAvisos } from './creditos.js';

export type Situacao = 'liberada' | 'só leitura' | 'pedir antes' | 'desligada';
export interface ApiListada { nome: string; para: string; situacao: Situacao; nota: string | null }
const SITUACOES: Situacao[] = ['liberada', 'só leitura', 'pedir antes', 'desligada'];

export function lerApis(j: unknown): ApiListada[] {
  const l = Array.isArray(j) ? j : (j as { apis?: unknown[] } | null)?.apis;
  if (!Array.isArray(l)) return [];
  return l.flatMap((x) => {
    const a = x as Record<string, unknown>;
    if (typeof a.nome !== 'string') return [];
    const s = SITUACOES.includes(a.situacao as Situacao) ? (a.situacao as Situacao) : 'pedir antes';
    return [{ nome: a.nome.slice(0, 60), para: String(a.para ?? '').slice(0, 160), situacao: s, nota: a.nota ? String(a.nota).slice(0, 160) : null }];
  });
}

export async function coletarApis(d: DepsPainel) {
  const agora = d.agora();
  const ausentes: string[] = [];
  type Linha = { provedor: string; chamadas: number; usd: number };
  const uso = (desde: number): Linha[] => (d.db!.prepare('SELECT provedor, count(*) chamadas, coalesce(sum(custo_usd),0) usd FROM chamadas_llm WHERE created_at >= ? GROUP BY provedor ORDER BY chamadas DESC').all(desde) as Linha[])
    .map((r) => ({ ...r, usd: Math.round(r.usd * 1000) / 1000 }));
  let hoje: Linha[] = [], semana: Linha[] = [];
  if (d.db) {
    try { hoje = uso(inicioDoDia(agora)); semana = uso(agora - 7 * 86400); } catch { ausentes.push('uso do v3'); }
  } else ausentes.push('uso do v3');
  const lj = lerJson(d.caminhos.apisLista);
  if (lj === null) ausentes.push('painel-apis.json');
  const avj = lerJson(d.caminhos.avisos);
  return { dados: { hoje, semana, apis: lerApis(lj), avisos: lerAvisos(avj, agora) }, ausentes };
}
