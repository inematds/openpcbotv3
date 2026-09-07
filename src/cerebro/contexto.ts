// Retrieval em 3 camadas (FTS5 + vetor + importantes recentes) + insights,
// limitado em tokens. Quem monta o prompt lê daqui; ninguém mais fala com o
// SQLite de memória.
import type { Cerebro, Memoria } from './memoria.js';
import type { GatewayLLM } from '../custo/gateway.js';

export interface OpcoesContexto {
  cerebro: Cerebro;
  gateway?: GatewayLLM;
  modeloEmbed?: string;
  /** Teto aproximado em tokens (~4 chars/token). */
  tetoTokens?: number;
}

const aproxTokens = (s: string): number => Math.ceil(s.length / 4);

export async function montarContextoMemoria(o: OpcoesContexto, chatId: string, mensagem: string, traceId?: string): Promise<string> {
  const teto = o.tetoTokens ?? 600;
  const vistos = new Set<number>();
  const linhas: string[] = [];
  const add = (m: Memoria, tag: string): void => {
    if (vistos.has(m.id)) return;
    vistos.add(m.id);
    o.cerebro.tocar(m.id);
    linhas.push(`- ${m.content} (${tag})`);
  };

  for (const m of o.cerebro.buscar(chatId, mensagem, 3)) add(m, m.sector);

  if (o.gateway && o.modeloEmbed && mensagem.length > 12) {
    try {
      const [v] = await o.gateway.embed([mensagem], o.modeloEmbed, traceId);
      if (v) for (const m of o.cerebro.buscarVetor(chatId, v, 3)) add(m, `${m.sector}·${m.score.toFixed(2)}`);
    } catch { /* embeddings são opcionais: sem RAM ou sem modelo, segue só com FTS */ }
  }

  for (const m of o.cerebro.importantes(chatId, 3)) add(m, 'importante');
  for (const m of o.cerebro.recentes(chatId, 3)) add(m, 'recente');

  const ins = o.cerebro.insights(chatId, 3).map((i) => `- ${i.texto}`);

  const blocos: string[] = [];
  let usados = 0;
  const empurrar = (titulo: string, itens: string[]): void => {
    const sel: string[] = [];
    for (const it of itens) {
      const t = aproxTokens(it);
      if (usados + t > teto) break;
      usados += t;
      sel.push(it);
    }
    if (sel.length) blocos.push(`[${titulo}]\n${sel.join('\n')}`);
  };
  empurrar('Memória', linhas);
  empurrar('Insights', ins);
  return blocos.join('\n\n');
}

/** Indexa vetores das memórias que ainda não têm (job da lane `ollama`). */
export async function indexarPendentes(o: OpcoesContexto, lote = 32): Promise<number> {
  if (!o.gateway || !o.modeloEmbed) return 0;
  const pend = o.cerebro.semVetor(lote);
  if (!pend.length) return 0;
  const vetores = await o.gateway.embed(pend.map((m) => m.content), o.modeloEmbed);
  pend.forEach((m, i) => { if (vetores[i]) o.cerebro.gravarVetor(m.id, o.modeloEmbed as string, vetores[i]); });
  return pend.length;
}
