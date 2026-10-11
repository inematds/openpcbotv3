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
  return t.length > 0 && t.length <= 80 && STATUS_RE.test(t);
}

/** Jobs abertos (na fila ou rodando) deste chat; `flow_ref` = `canal:chatId`. */
export function jobsAbertos(fila: FilaSqlite, flowRef: string): Job[] {
  const abertos: Job[] = [];
  for (const status of ['running', 'queued'] as const) {
    for (const j of fila.listar({ status, limite: 200 })) if (j.flow_ref === flowRef) abertos.push(j);
  }
  return abertos;
}

export function pedidoDe(job: Job): string {
  try {
    const i = JSON.parse(job.input) as { texto?: string; entrada?: { texto?: string } };
    return (i.texto ?? i.entrada?.texto ?? '').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

/** Tarefas internas com nome legível no quadro de situação. */
const NOMES: Record<string, string> = {
  'apos-agente': 'mensagem sua esperando a vez',
  responder: 'mensagem sua na fila',
  'agente-lead': 'agente esperando os especialistas',
};

function minutos(seg: number): string {
  const m = Math.max(0, Math.round(seg / 60));
  return m < 1 ? 'menos de 1 min' : `${m} min`;
}

/** Texto do quadro de situação. Lista vazia → null (quem chama segue o fluxo normal). */
export function textoSituacao(jobs: Job[], agora: number): string | null {
  if (!jobs.length) return null;
  const linhas = jobs.map((j) => {
    const quem = NOMES[j.tarefa] ?? j.tarefa.replace(/^(agente|consulta):/, '');
    const estado = j.status === 'running' ? `rodando há ${minutos(agora - (j.iniciado_em ?? j.criado_em))}` : `na fila há ${minutos(agora - j.criado_em)}`;
    const p = pedidoDe(j);
    return `• #${j.id} ${quem} — ${estado}${p ? `\n  pedido: "${p.slice(0, 100)}${p.length > 100 ? '…' : ''}"` : ''}`;
  });
  return `📋 Situação agora (lida da fila, sem modelo):\n${linhas.join('\n')}\n\nAviso aqui quando terminar. /status <número> mostra o detalhe.`;
}

/**
 * Aviso de job de agente LONGO ainda rodando (heartbeat de 30 min, 3.8.5): com
 * teto de produção de horas, silêncio parecia travamento. Só agente:* (o
 * especialista consulta:* é parte de outro pedido) e só passados `minimoSeg`.
 */
export function avisosAindaRodando(jobs: Job[], agora: number, minimoSeg = 25 * 60): { canal: string; chatId: string; texto: string }[] {
  const avisos: { canal: string; chatId: string; texto: string }[] = [];
  for (const j of jobs) {
    if (j.status !== 'running' || !j.tarefa.startsWith('agente:') || !j.iniciado_em || agora - j.iniciado_em < minimoSeg) continue;
    let e: { canal?: string; chatId?: string };
    try { e = JSON.parse(j.input) as { canal?: string; chatId?: string }; } catch { continue; }
    if (!e.chatId) continue;
    const p = pedidoDe(j);
    avisos.push({
      canal: e.canal ?? 'telegram', chatId: e.chatId,
      texto: `⏳ #${j.id} ainda rodando há ${minutos(agora - j.iniciado_em)}${p ? ` — "${p.slice(0, 80)}${p.length > 80 ? '…' : ''}"` : ''}. /status ${j.id} · /job ${j.id} <texto> complementa.`,
    });
  }
  return avisos;
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
