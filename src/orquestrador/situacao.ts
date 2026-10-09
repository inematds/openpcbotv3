// Situação do chat respondida por CÓDIGO (padrão Hermes `/agents` e OpenClaw
// inline shortcuts): "qual situação?" com job rodando lê a fila, sem modelo.
// E a trava da rota direta (padrão Agent Zero: turno sem ferramenta não pode
// terminar em promessa) — resposta local que promete ação sobe para o agente.
import type { FilaSqlite } from '../fila/store.js';
import type { Job } from '../fila/types.js';

/** Pergunta curta de andamento: "qual situação?", "e aí, terminou?", "como está o vídeo?". */
const STATUS_RE = /(?<![\p{L}\p{N}])(situa[çc][ãa]o|status|andamento|progresso|terminou|acabou|j[áa] foi|ficou pronto|como (?:est[áa]|t[áa]|anda|vai)|cad[êe]|e a[íi])(?![\p{L}\p{N}])/iu;

export function ehPerguntaStatus(texto: string): boolean {
  const t = texto.trim();
  return t.length > 0 && t.length <= 160 && STATUS_RE.test(t);
}

/** Jobs abertos (na fila ou rodando) deste chat; `flow_ref` = `canal:chatId`. */
export function jobsAbertos(fila: FilaSqlite, flowRef: string): Job[] {
  const abertos: Job[] = [];
  for (const status of ['running', 'queued'] as const) {
    for (const j of fila.listar({ status, limite: 200 })) if (j.flow_ref === flowRef) abertos.push(j);
  }
  return abertos;
}

function pedidoDe(job: Job): string {
  try {
    const i = JSON.parse(job.input) as { texto?: string; entrada?: { texto?: string } };
    return (i.texto ?? i.entrada?.texto ?? '').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

function minutos(seg: number): string {
  const m = Math.max(0, Math.round(seg / 60));
  return m < 1 ? 'menos de 1 min' : `${m} min`;
}

/** Texto do quadro de situação. Lista vazia → null (quem chama segue o fluxo normal). */
export function textoSituacao(jobs: Job[], agora: number): string | null {
  if (!jobs.length) return null;
  const linhas = jobs.map((j) => {
    const quem = j.tarefa.replace(/^(agente|consulta):/, '');
    const estado = j.status === 'running' ? `rodando há ${minutos(agora - (j.iniciado_em ?? j.criado_em))}` : `na fila há ${minutos(agora - j.criado_em)}`;
    const p = pedidoDe(j);
    return `• #${j.id} ${quem} — ${estado}${p ? `\n  pedido: "${p.slice(0, 100)}${p.length > 100 ? '…' : ''}"` : ''}`;
  });
  return `📋 Situação agora (lida da fila, sem modelo):\n${linhas.join('\n')}\n\nAviso aqui quando terminar. /status <número> mostra o detalhe.`;
}

/** Marcador que a rota direta devolve quando precisaria de ferramenta. */
export const MARCA_ESCALAR = '[ESCALAR]';

export const REGRA_ROTA_DIRETA = `[Rota direta — SEM ferramentas]
Você não consegue ler arquivos, rodar comandos, consultar projetos, jobs, sites nem nada fora desta conversa.
Nunca prometa uma ação ("vou verificar", "vou olhar", "já te retorno"). Se a resposta exige consultar ou fazer algo, responda APENAS ${MARCA_ESCALAR} e nada mais — o agente com ferramentas assume.`;

const PROMESSA_RE = /\b(?:vou|irei|vamos|deixa eu|deixe-me|deixa-me|j[áa] vou|estou indo)\s+(?:j[áa]\s+|agora\s+|rapidamente\s+)?(?:verificar|checar|conferir|olhar|dar uma olhada|ver|analisar|buscar|procurar|consultar|investigar|rodar|executar|abrir|ler|pesquisar|levantar|apurar|acompanhar|averiguar)\b|\bj[áa] (?:te )?(?:retorno|volto|aviso)\b|\bum momento\b|\baguarde\b/i;

/** Resposta local que é promessa sem ação (ou pediu escalada) → não envia, sobe para o agente. */
export function deveEscalar(resposta: string): boolean {
  return resposta.includes(MARCA_ESCALAR) || PROMESSA_RE.test(resposta);
}
