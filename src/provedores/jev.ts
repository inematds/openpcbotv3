// Contrato restrito a Choice para roteamento; chamadas passam pelo gateway.
export const MODELO_JEV = '~typesafe/jev-latest';
export interface PerguntaJev { type: 'choice'; instructions: string; criteria: Record<string, string> }
export interface PedidoJev {
  modelo?: string;
  state: Record<string, unknown>;
  questions: Record<string, PerguntaJev>;
  timeoutMs?: number;
  sinal?: AbortSignal;
}
export interface EscolhaJev {
  type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number;
}
export interface RespostaJev {
  modelo: string;
  answers: Record<string, EscolhaJev>;
  tokensIn: number;
  tokensOut: number;
  custoUsdInformado: number;
}
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numero = (v: unknown, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const mesmas = (a: object, b: object): boolean => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());

export function validarPedidoJev(p: PedidoJev): void {
  const modelo = p.modelo ?? MODELO_JEV;
  if (!/^(~typesafe\/jev-latest|typesafe\/jev-[a-zA-Z0-9.-]+)$/.test(modelo)) throw new Error('Jev: modelo inválido');
  if (!objeto(p.state) || !Object.keys(p.state).length || !objeto(p.questions) || !Object.keys(p.questions).length || Object.keys(p.questions).length > 30) throw new Error('Jev: contexto ou perguntas inválidos');
  for (const q of Object.values(p.questions)) {
    if (!objeto(q) || q.type !== 'choice' || typeof q.instructions !== 'string' || !q.instructions.trim() || !objeto(q.criteria) || Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 255 || Object.entries(q.criteria).some(([k,v]) => !k || typeof v !== 'string' || !v.trim())) throw new Error('Jev: critérios inválidos');
  }
  if (Buffer.byteLength(JSON.stringify({ model: modelo, state: p.state, questions: p.questions })) > 60_000) throw new Error('Jev: contexto excede 60 KB locais');
}

export function validarRespostaJev(p: PedidoJev, d: unknown): RespostaJev {
  if (!objeto(d) || typeof d.model !== 'string' || !d.model || !objeto(d.answers) || !mesmas(d.answers, p.questions) || !objeto(d.usage)) throw new Error('Jev: resposta incompleta');
  const answers: Record<string, EscolhaJev> = {};
  for (const [id, q] of Object.entries(p.questions)) {
    const a = d.answers[id];
    if (!objeto(a) || a.type !== 'choice' || typeof a.choice !== 'string' || !Object.hasOwn(q.criteria, a.choice) || !objeto(a.probabilities) || !mesmas(a.probabilities, q.criteria) || !numero(a.confidence, 1)) throw new Error('Jev: escolha fora do contrato');
    const values = Object.values(a.probabilities);
    if (!values.every(v => numero(v, 1))) throw new Error('Jev: probabilidades inválidas');
    const probs = a.probabilities as Record<string, number>;
    if (Math.abs((values as number[]).reduce((x,y) => x+y,0)-1) > .001 || probs[a.choice]+1e-6 < Math.max(...values as number[])) throw new Error('Jev: distribuição inconsistente');
    answers[id] = { type: 'choice', choice: a.choice, probabilities: probs, confidence: a.confidence };
  }
  const u=d.usage;
  if (!numero(u.input_tokens) || !Number.isInteger(u.input_tokens) || !numero(u.output_tokens) || !Number.isInteger(u.output_tokens) || !numero(u.cost)) throw new Error('Jev: uso ou custo ausente/inválido');
  return { modelo: d.model, answers, tokensIn: u.input_tokens, tokensOut: u.output_tokens, custoUsdInformado: u.cost };
}

/** Adaptador do provedor; não chamar fora de GatewayLLM.decidirJev. */
export async function consultarJev(apiKey: string, p: PedidoJev, fetchFn: typeof fetch): Promise<RespostaJev> {
  validarPedidoJev(p);
  const timeout = p.timeoutMs ?? 3000;
  if (!numero(timeout, 30_000) || timeout < 1) throw new Error('Jev: timeout inválido');
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  if (p.sinal?.aborted) throw new Error('Jev: chamada cancelada');
  p.sinal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(onAbort, timeout);
  try {
    const r = await fetchFn('https://openrouter.ai/api/alpha/decisions', {
      method:'POST', signal:ctrl.signal,
      headers: { Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json', 'X-Title':'openpcbotv3' },
      body:JSON.stringify({ model:p.modelo ?? MODELO_JEV, state:p.state, questions:p.questions }),
    });
    if (!r.ok) throw new Error(`Jev: HTTP ${r.status}`);
    const text=await r.text();
    if (Buffer.byteLength(text)>1_000_000) throw new Error('Jev: resposta excede limite');
    let data: unknown;
    try { data=JSON.parse(text); } catch { throw new Error('Jev: JSON inválido'); }
    return validarRespostaJev(p,data);
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('Jev: tempo esgotado ou cancelado');
    if (e instanceof Error && e.message.startsWith('Jev:')) throw e;
    throw new Error('Jev: conexão indisponível');
  } finally {
    clearTimeout(timer);p.sinal?.removeEventListener('abort', onAbort);
  }
}
