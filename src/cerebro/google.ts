// Ponte entre os conectores Python (conectores/google/) e o cérebro.
//
// Roda o CLI, lê o JSON e entrega os itens à `Ingestao`. Não fala com a API do
// Google: quem tem o token é o script Python, e é lá que a conta é resolvida.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { RAIZ } from '../config/env.js';
import type { Ingestao, ItemBruto, ResultadoIngestao } from './ingestao.js';

const run = promisify(execFile);
export const DIR_CONECTORES = resolve(RAIZ, 'conectores/google');

export interface EmailBruto {
  conta: string; id: string; de?: string; assunto?: string; data?: string; resumo?: string;
}
export interface EventoBruto {
  account?: string; id?: string; summary?: string; start?: string; end?: string; location?: string; attendees?: string[];
}

/** Executa um conector e devolve o JSON. Erro do script vira exceção com o stderr. */
export async function rodarConector(script: 'gmail.py' | 'gcal.py', args: string[], timeoutMs = 120_000): Promise<unknown> {
  const caminho = resolve(DIR_CONECTORES, script);
  if (!existsSync(caminho)) throw new Error(`conector ausente: ${caminho}`);
  const { stdout, stderr } = await run('python3', [caminho, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  try {
    return JSON.parse(stdout || '[]');
  } catch {
    throw new Error(`${script} não devolveu JSON: ${(stderr || stdout).slice(0, 300)}`);
  }
}

/**
 * Id crescente e estável para uma fonte que não tem rowid: usamos a data.
 * Sem data utilizável, cai para o instante da leitura — o pior caso é reprocessar
 * um item, e o dedupe por hash do cérebro absorve isso.
 */
function idPorData(data: string | undefined, agora: number): number {
  const t = data ? Date.parse(data) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : agora;
}

/** E-mails recentes de TODAS as contas viram fatos, uma fonte por conta. */
export async function ingerirGmail(ing: Ingestao, chatId: string, horas: number, modelo: string | undefined, agora: () => number): Promise<ResultadoIngestao[]> {
  const msgs = (await rodarConector('gmail.py', ['--conta', 'todas', 'recentes', '--horas', String(horas)])) as EmailBruto[];
  const porConta = new Map<string, ItemBruto[]>();
  for (const m of msgs) {
    const item: ItemBruto = {
      id: idPorData(m.data, agora()),
      texto: `E-mail de ${m.de ?? '?'} — ${m.assunto ?? '(sem assunto)'}: ${(m.resumo ?? '').slice(0, 400)}`,
    };
    porConta.set(m.conta, [...(porConta.get(m.conta) ?? []), item]);
  }
  const out: ResultadoIngestao[] = [];
  for (const [conta, itens] of porConta) {
    const fonte = `gmail:${conta}`;
    const desde = ing.ultimoId(fonte);
    const novos = itens.filter((i) => i.id > desde);
    if (novos.length) out.push(await ing.ingerir(fonte, chatId, novos, modelo));
  }
  return out;
}

/**
 * Eventos dos próximos N dias de TODAS as agendas viram fatos.
 *
 * Aqui o id NÃO é a data do evento, e isso é deliberado: a agenda é uma JANELA,
 * não um fluxo. Se o marcador guardasse o começo do evento mais distante da
 * janela, um compromisso marcado amanhã teria `start` MENOR que o marcador e o
 * filtro `id > ultimo_id` o descartaria para sempre. Então cada passagem usa o
 * instante da leitura como id: a janela inteira é reprocessada e o dedupe por
 * hash do cérebro absorve o que já é conhecido. Uma chamada local por dia.
 */
export async function ingerirCalendario(ing: Ingestao, chatId: string, dias: number, modelo: string | undefined, agora: () => number): Promise<ResultadoIngestao[]> {
  const evs = (await rodarConector('gcal.py', ['list', '--all', '--days', String(dias)])) as EventoBruto[];
  const porConta = new Map<string, ItemBruto[]>();
  for (const e of evs) {
    const conta = e.account ?? 'padrao';
    const item: ItemBruto = {
      id: agora(),
      texto: `Compromisso ${e.start ?? ''}: ${e.summary ?? '(sem título)'}${e.location ? ` em ${e.location}` : ''}${e.attendees?.length ? ` com ${e.attendees.slice(0, 5).join(', ')}` : ''}`,
    };
    porConta.set(conta, [...(porConta.get(conta) ?? []), item]);
  }
  const out: ResultadoIngestao[] = [];
  for (const [conta, itens] of porConta) {
    const fonte = `gcal:${conta}`;
    // Duas passagens no mesmo segundo (cron + `/fontes ingerir agenda`) não podem
    // se anular por empate no relógio — o marcador só precisa avançar.
    const desde = ing.ultimoId(fonte);
    const id = Math.max(desde + 1, agora());
    const novos = itens.map((i) => ({ ...i, id }));
    if (novos.length) out.push(await ing.ingerir(fonte, chatId, novos, modelo));
  }
  return out;
}

/** Aliases configurados, ou `null` quando o conector não está configurado. */
export async function contasConfiguradas(): Promise<string[] | null> {
  try {
    const r = (await rodarConector('gmail.py', ['contas'], 15_000)) as { contas?: Record<string, string> };
    return Object.keys(r.contas ?? {});
  } catch {
    return null;
  }
}
