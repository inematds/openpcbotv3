// Classificação por LLM LOCAL pequeno (papel `roteador`), antes de gastar
// token na nuvem. Devolve rota + tier + motivo. Falha = resposta direta local.
import type { GatewayLLM } from '../custo/gateway.js';
import type { Tier } from '../custo/registro.js';
import type { Agente } from './agentes.js';
import type { SkillInfo } from './skills.js';

export type Rota = 'direto' | 'agente';

export interface Decisao {
  rota: Rota;
  agente?: string;
  tier: Tier;
  motivo: string;
  /** Especialistas read-only a consultar em paralelo antes do lead (0–3). */
  consultar?: string[];
}

export function promptRoteador(agentes: Agente[], skills: SkillInfo[]): string {
  const ag = agentes.map((a) => `- ${a.id}: ${a.descricao}${a.somenteLeitura ? ' [só leitura]' : ''}`).join('\n');
  const sk = skills.filter((s) => !s.rascunho).map((s) => `- ${s.id}: ${s.description.slice(0, 100)}`).join('\n');
  return `Você é o roteador de um assistente pessoal em PT-BR. Classifique a mensagem do usuário e responda SOMENTE JSON:
{"rota":"direto"|"agente","agente":"<id ou null>","tier":"local"|"barato"|"premium","motivo":"<até 12 palavras>","consultar":["<id>",...]}

Regras:
- "direto" = conversa, pergunta factual curta, resumo, opinião, tradução, texto criativo curto. tier "local".
- "agente" = precisa de FERRAMENTAS: ler/escrever arquivos, rodar comando, mexer em repositório, pesquisar na web a fundo, usar uma skill, mexer em calendário/email/slack. Escolha o agente pelo domínio; sem especialista claro → "lead".
- tier "barato" só em "direto" quando exigir raciocínio longo (>3 passos) ou texto longo (>400 palavras). "premium" NUNCA por conta própria.
- "consultar": até 2 especialistas [só leitura] cujo contexto ajude o agente escolhido; [] se não ajudar.
- Nunca invente ids fora das listas.

Agentes:
${ag}

Skills disponíveis para o agente (indicam que a rota é "agente"):
${sk}`;
}

export function parsearDecisao(bruto: string, agentes: Agente[]): Decisao {
  const fallback: Decisao = { rota: 'direto', tier: 'local', motivo: 'fallback' };
  const m = bruto.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    const j = JSON.parse(m[0]) as Partial<Decisao> & { agente?: string | null };
    const ids = new Set(agentes.map((a) => a.id));
    const rota: Rota = j.rota === 'agente' ? 'agente' : 'direto';
    let tier: Tier = j.tier === 'barato' ? 'barato' : 'local';
    if (rota === 'agente') tier = 'premium'; // CLI = Claude; o custo real vem do próprio CLI
    const agente = rota === 'agente' ? (j.agente && ids.has(j.agente) ? j.agente : 'lead') : undefined;
    const consultar = (Array.isArray(j.consultar) ? j.consultar : []).filter((id): id is string => typeof id === 'string' && ids.has(id) && id !== agente).slice(0, 2);
    return { rota, agente, tier, motivo: String(j.motivo ?? '').slice(0, 120), consultar };
  } catch { return fallback; }
}

/** Heurística barata ANTES do LLM: comandos óbvios de ferramenta nem passam pelo roteador. */
const FERRAMENTA_RE = /\b(cria|crie|criar|edita|edite|editar|corrig|refator|commit|push|deploy|instala|roda|rode|execut|compila|build|teste|arquivo|pasta|repo|reposit[óo]rio|projeto|script|c[óo]digo|bug|erro no|pesquis[ae] (?:a fundo|na web)|agenda|calend[áa]rio|email|e-mail|slack|skill)\b/i;

export async function rotear(
  gateway: GatewayLLM,
  modeloRoteador: string,
  mensagem: string,
  agentes: Agente[],
  skills: SkillInfo[],
  ctx: { chatId: string; traceId: string },
): Promise<Decisao> {
  if (mensagem.length < 12 && !FERRAMENTA_RE.test(mensagem)) return { rota: 'direto', tier: 'local', motivo: 'curta' };
  try {
    const r = await gateway.chamar({
      tier: 'local', modelo: modeloRoteador, json: true, temperatura: 0.1, maxTokens: 160, timeoutMs: 30_000,
      agente: 'roteador', chatId: ctx.chatId, traceId: ctx.traceId,
      mensagens: [{ role: 'system', content: promptRoteador(agentes, skills) }, { role: 'user', content: mensagem.slice(0, 2000) }],
    });
    const d = parsearDecisao(r.texto, agentes);
    if (d.rota === 'direto' && FERRAMENTA_RE.test(mensagem) && /\b(no|na|do|da|desse|deste|nesse|neste)\s+(projeto|repo|arquivo|pasta)\b/i.test(mensagem)) {
      return { rota: 'agente', agente: 'lead', tier: 'premium', motivo: 'heurística: menciona projeto/arquivo', consultar: [] };
    }
    return d;
  } catch {
    return { rota: 'direto', tier: 'local', motivo: 'roteador indisponível' };
  }
}
