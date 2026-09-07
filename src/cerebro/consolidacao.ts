// Consolidação noturna (padrão claudeclaw-os/memory-consolidate): funde
// duplicatas próximas, detecta contradições por timestamp (a antiga vira
// `superseded`, nunca é apagada) e gera insights. Roda no Ollama residente.
import type { Cerebro, Memoria } from './memoria.js';
import type { GatewayLLM } from '../custo/gateway.js';

export interface ResultadoConsolidacao {
  chats: number;
  duplicatas: number;
  contradicoes: number;
  insights: number;
  erro?: string;
}

interface Veredito {
  duplicatas?: number[][];
  contradicoes?: { antiga: number; nova: number }[];
  insights?: string[];
}

const PROMPT = `Você organiza a memória de um assistente pessoal em PT-BR. Receberá memórias numeradas (id, data, texto).
Devolva SOMENTE JSON no formato:
{"duplicatas":[[id,id,...]], "contradicoes":[{"antiga":id,"nova":id}], "insights":["frase curta"]}
Regras: duplicatas = mesmo fato dito de formas diferentes (mantemos o mais recente); contradições = fatos incompatíveis
sobre o mesmo assunto (a mais NOVA vence); insights = no máximo 3 padrões úteis, cada um com até 20 palavras. Sem markdown.`;

export async function consolidar(cerebro: Cerebro, gateway: GatewayLLM, opts: { modelo?: string; porChat?: number; agora: () => number }): Promise<ResultadoConsolidacao> {
  const out: ResultadoConsolidacao = { chats: 0, duplicatas: 0, contradicoes: 0, insights: 0 };
  const chats = cerebro['db'].prepare('SELECT DISTINCT chat_id AS c FROM memories WHERE superseded_by IS NULL').all() as { c: string }[];
  for (const { c } of chats) {
    const mems = cerebro.listar(c, opts.porChat ?? 60);
    if (mems.length < 4) continue;
    out.chats += 1;
    const lista = mems.map((m) => `${m.id} | ${new Date(m.created_at * 1000).toISOString().slice(0, 10)} | ${m.content.slice(0, 200)}`).join('\n');
    let v: Veredito;
    try {
      const r = await gateway.chamar({
        tier: 'local', modelo: opts.modelo, json: true, temperatura: 0.1, maxTokens: 800, timeoutMs: 240_000,
        agente: 'consolidacao', chatId: c,
        mensagens: [{ role: 'system', content: PROMPT }, { role: 'user', content: lista }],
      });
      v = JSON.parse(r.texto.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Veredito;
    } catch (e) {
      out.erro = (e as Error).message;
      continue;
    }
    const porId = new Map<number, Memoria>(mems.map((m) => [m.id, m]));
    for (const grupo of v.duplicatas ?? []) {
      const validos = grupo.filter((id) => porId.has(id)).sort((a, b) => (porId.get(b)!.created_at - porId.get(a)!.created_at));
      const [fica, ...vao] = validos;
      for (const id of vao) { cerebro.substituir(id, fica); out.duplicatas += 1; }
    }
    for (const cont of v.contradicoes ?? []) {
      const a = porId.get(cont.antiga), n = porId.get(cont.nova);
      if (!a || !n || a.id === n.id) continue;
      const [velha, nova] = a.created_at <= n.created_at ? [a, n] : [n, a];
      cerebro.substituir(velha.id, nova.id);
      out.contradicoes += 1;
    }
    for (const texto of (v.insights ?? []).slice(0, 3)) {
      if (typeof texto === 'string' && texto.trim()) { cerebro.gravarInsight(c, texto.trim(), mems.slice(0, 10).map((m) => m.id)); out.insights += 1; }
    }
  }
  return out;
}
