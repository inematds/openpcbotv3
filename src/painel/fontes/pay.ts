// Pay e bancos (Nei, 14/11/2026): robôs de pagamento (hoje: PIX do Nubank na VPS1).
// Quem coleta é o pay-monitor (~/projetos/wifi/pay-monitor, timer a cada 10 min, SSH só leitura),
// que grava ~/.local/share/inema/pay.json. Aqui só leitura. Arquivo com mais de 30 min = monitor parado.
import type { DepsPainel } from '../tipos.js';
import { corta, lerJson } from '../util.js';

export interface RoboPay {
  nome: string; onde: string; estado: 'ok' | 'aviso' | 'erro'; motivo: string | null;
  execucoes_7d: number | null; falhas_7d: number | null; falhas_seguidas: number | null;
  ultimo_ok: number | null; ultima_execucao: number | null;
  pix_24h: number | null; valor_24h: number | null; pix_7d: number | null; valor_7d: number | null;
  ultimo_pix: number | null; token_vence: number | null; erro: string | null;
}
export interface DadosPay { atualizado: number | null; parado: boolean; robos: RoboPay[] }

const PARADO_S = 30 * 60;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, n: number): string | null => (typeof v === 'string' && v ? corta(v, n) : null);

export function normalizarPay(b: { atualizado?: unknown; robos?: unknown } | null, agora: number): DadosPay {
  const atualizado = num(b?.atualizado);
  const robos = (Array.isArray(b?.robos) ? b!.robos as Record<string, unknown>[] : []).map((r) => ({
    nome: str(r.nome, 60) ?? '?', onde: str(r.onde, 60) ?? '',
    estado: (r.estado === 'ok' || r.estado === 'aviso' ? r.estado : 'erro') as RoboPay['estado'],
    motivo: str(r.motivo, 200),
    execucoes_7d: num(r.execucoes_7d), falhas_7d: num(r.falhas_7d), falhas_seguidas: num(r.falhas_seguidas),
    ultimo_ok: num(r.ultimo_ok), ultima_execucao: num(r.ultima_execucao),
    pix_24h: num(r.pix_24h), valor_24h: num(r.valor_24h), pix_7d: num(r.pix_7d), valor_7d: num(r.valor_7d),
    ultimo_pix: num(r.ultimo_pix), token_vence: num(r.token_vence), erro: str(r.erro, 160),
  }));
  return { atualizado, parado: atualizado == null || agora - atualizado > PARADO_S, robos };
}

export function coletarPay(d: DepsPainel): { dados: DadosPay; ausentes: string[] } {
  const b = lerJson<{ atualizado?: unknown; robos?: unknown }>(d.caminhos.pay);
  if (!b || typeof b !== 'object') return { ausentes: ['~/.local/share/inema/pay.json (pay-monitor)'], dados: normalizarPay(null, d.agora()) };
  return { ausentes: [], dados: normalizarPay(b, d.agora()) };
}

/** Alertas do quadro: robô em erro/aviso e monitor parado. Chave estável por robô e estado. */
export function alertasPay(p: DadosPay | undefined): { chave: string; nivel: 'erro' | 'aviso'; texto: string }[] {
  if (!p) return [];
  const out: { chave: string; nivel: 'erro' | 'aviso'; texto: string }[] = [];
  if (p.parado) out.push({ chave: 'pay:monitor-parado', nivel: 'erro', texto: 'Pay e bancos: o pay-monitor parou de atualizar (robôs de pagamento sem vigia)' });
  for (const r of p.robos) {
    if (r.estado === 'ok') continue;
    out.push({ chave: `pay:${r.nome}:${r.estado}`, nivel: r.estado, texto: `${r.nome} (${r.onde}): ${r.motivo ?? r.estado}` });
  }
  return out;
}
