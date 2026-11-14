// INEMA.PRO e Portal (Nei, 14/11/2026): o que fizemos (git), se está rodando (rotinas do cron) e uso
// (acessos, uso de IA, visitas, busca, eventos, chat). Quem coleta é o uso-inema (~/projetos/wifi/uso-inema,
// timer 1×/dia, Supabase só leitura, só contagens), que grava ~/.local/share/inema/uso-inema.json. Aqui só leitura.
import type { DepsPainel } from '../tipos.js';
import { lerJson } from '../util.js';

type Obj = Record<string, unknown>;
export interface DadosUso { atualizado: number | null; parado: boolean; erros: string[]; [k: string]: unknown }

const PARADO_S = 30 * 3600; // diário: mais de 30 h sem atualizar = vigia parado
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function base(b: Obj | null, lado: 'pro' | 'portal', agora: number): DadosUso {
  const atualizado = num(b?.atualizado);
  const erros = Array.isArray(b?.erros) ? (b!.erros as unknown[]).map((e) => String(e).slice(0, 160)).slice(0, 8) : [];
  const dados = (b && typeof b[lado] === 'object' && b[lado]) ? (b[lado] as Obj) : {};
  return { ...dados, atualizado, parado: atualizado == null || agora - atualizado > PARADO_S, erros };
}

function coletar(d: DepsPainel, lado: 'pro' | 'portal'): { dados: DadosUso; ausentes: string[] } {
  const b = lerJson<Obj>(d.caminhos.uso);
  if (!b || typeof b !== 'object') return { ausentes: ['~/.local/share/inema/uso-inema.json (uso-inema)'], dados: base(null, lado, d.agora()) };
  return { ausentes: [], dados: base(b, lado, d.agora()) };
}

export const coletarInemapro = (d: DepsPainel) => coletar(d, 'pro');
export const coletarPortal = (d: DepsPainel) => coletar(d, 'portal');

/** Alerta (selo, Esperando você e 🟡 no v3, uma vez por chave): rotina do inemapro com erro e vigia parado. */
export function alertasUso(p: DadosUso | undefined): { chave: string; nivel: 'erro' | 'aviso'; texto: string }[] {
  if (!p) return [];
  const out: { chave: string; nivel: 'erro' | 'aviso'; texto: string }[] = [];
  if (p.parado) out.push({ chave: 'uso:parado', nivel: 'aviso', texto: 'INEMA.PRO e Portal: o uso-inema não atualiza há mais de 30 h' });
  for (const r of (Array.isArray(p.rotinas) ? p.rotinas : []) as Obj[]) {
    if (r.estado === 'erro') out.push({ chave: `uso:rotina:${String(r.nome)}:${String(r.quando)}`, nivel: 'aviso', texto: `INEMA.PRO: a rotina ${String(r.nome)} falhou na última execução` });
  }
  return out;
}
