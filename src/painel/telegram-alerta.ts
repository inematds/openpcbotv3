// Alerta do painel no Telegram — PRONTO E DESLIGADO. Só roda com
// `PAINEL_ALERTA_TELEGRAM=1` (falta o OK do Nei sobre o texto). Nunca repete o
// mesmo alerta: as chaves já avisadas ficam em arquivo (store/painel-avisados.json).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { AlertaPainel } from './tipos.js';

export const telegramLigado = (): boolean => process.env.PAINEL_ALERTA_TELEGRAM === '1';

function lerAvisados(arq: string): Record<string, number> {
  try { return JSON.parse(readFileSync(arq, 'utf8')) as Record<string, number>; } catch { return {}; }
}

/** Manda só os alertas cujas chaves ainda não foram avisadas. Devolve as enviadas. */
export function avisarNovos(alertas: AlertaPainel[], arq: string, enviar: (texto: string) => void, agora: number, ligado = telegramLigado()): string[] {
  if (!ligado || !alertas.length) return [];
  const ja = lerAvisados(arq);
  const novos = alertas.filter((a) => !(a.chave in ja));
  if (!novos.length) return [];
  for (const a of novos) ja[a.chave] = agora;
  // Poda: guarda só os últimos 30 dias (chaves estáveis não voltam a disparar dentro disso).
  for (const [k, t] of Object.entries(ja)) if (agora - t > 30 * 86400) delete ja[k];
  if (!existsSync(dirname(arq))) mkdirSync(dirname(arq), { recursive: true });
  writeFileSync(arq + '.tmp', JSON.stringify(ja)); renameSync(arq + '.tmp', arq);
  const icone = (a: AlertaPainel) => (a.nivel === 'erro' ? '🔴' : '🟡');
  enviar(`Painel: ${novos.length} alerta(s) novo(s)\n` + novos.slice(0, 10).map((a) => `${icone(a)} ${a.texto}`).join('\n'));
  return novos.map((a) => a.chave);
}
