// Minha escada (Nei, 12/11/2026): quanto da rotina a IA já conduz (AL4+AL5), medido pelos logs do
// Claude Code e do Codex, comparado com a Anthropic. Outro processo gera o escada.json 1x por dia;
// aqui só leitura do arquivo (~/.local/share/minha-escada/escada.json).
import type { DepsPainel } from '../tipos.js';
import { corta, lerJson, paraEpoch } from '../util.js';

export interface TarefaEscada { tarefa: string; horas_semana: number | null; nivel: string; proximo: string | null; critico: boolean; mix: Record<string, number> }
export interface DadosEscada {
  gerado_em: number | null;
  periodo: { inicio: string; fim: string; dias: number | null } | null;
  parcela_ia: number | null;
  parcela_anterior: number | null;
  variacao: number | null;
  anthropic_ref: number | null;
  projecao: { meses: number; pct: number }[];
  tarefas: TarefaEscada[];
  acoes: string[];
  missao: { titulo: string; texto: string } | null;
  fontes: { claude_sessoes: number | null; codex_sessoes: number | null; conversas: number | null; automaticas: number | null; acoes: number | null };
  relatorio_md: string | null;
  motor: string | null;
}

interface Bruto {
  gerado_em?: string; periodo?: { inicio?: string; fim?: string; dias?: number };
  fontes?: Record<string, unknown>; parcela_ia?: unknown; parcela_anterior?: unknown; anthropic_ref?: unknown;
  projecao?: { meses?: unknown; pct?: unknown }[];
  tarefas?: { tarefa?: string; horas_semana?: unknown; nivel?: string; critico?: unknown; mix?: Record<string, unknown>; proximo?: string | null }[];
  acoes?: unknown[]; missao_do_dia?: { titulo?: string; texto?: string } | null; relatorio_md?: string; motor?: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const txt = (v: unknown, n: number): string => (typeof v === 'string' ? corta(v, n) : '');

export const VAZIO_ESCADA: DadosEscada = {
  gerado_em: null, periodo: null, parcela_ia: null, parcela_anterior: null, variacao: null, anthropic_ref: null,
  projecao: [], tarefas: [], acoes: [], missao: null,
  fontes: { claude_sessoes: null, codex_sessoes: null, conversas: null, automaticas: null, acoes: null }, relatorio_md: null, motor: null,
};

/** Normaliza o escada.json (campos faltando viram null/vazio; nada é inventado). */
export function normalizarEscada(b: Bruto): DadosEscada {
  const pct = num(b.parcela_ia), ant = num(b.parcela_anterior);
  const f = b.fontes ?? {};
  const p = b.periodo;
  return {
    gerado_em: paraEpoch(b.gerado_em),
    periodo: p && (p.inicio || p.fim) ? { inicio: txt(p.inicio, 20), fim: txt(p.fim, 20), dias: num(p.dias) } : null,
    parcela_ia: pct, parcela_anterior: ant,
    variacao: pct != null && ant != null ? Math.round((pct - ant) * 10) / 10 : null,
    anthropic_ref: num(b.anthropic_ref),
    projecao: (Array.isArray(b.projecao) ? b.projecao : [])
      .map((x) => ({ meses: num(x?.meses), pct: num(x?.pct) }))
      .filter((x): x is { meses: number; pct: number } => x.meses != null && x.pct != null)
      .sort((a, c) => a.meses - c.meses),
    tarefas: (Array.isArray(b.tarefas) ? b.tarefas : []).filter((t) => t && t.tarefa).slice(0, 40).map((t) => ({
      tarefa: txt(t.tarefa, 120), horas_semana: num(t.horas_semana), nivel: txt(t.nivel, 8) || '?', proximo: t.proximo ? txt(t.proximo, 8) : null,
      critico: t.critico === true,
      mix: Object.fromEntries(Object.entries(t.mix ?? {}).filter(([, v]) => num(v) != null).map(([k, v]) => [corta(k, 8), v as number])),
    })),
    acoes: (Array.isArray(b.acoes) ? b.acoes : []).filter((a) => typeof a === 'string' && a.trim()).slice(0, 10).map((a) => corta(a, 300)),
    missao: b.missao_do_dia && b.missao_do_dia.titulo ? { titulo: txt(b.missao_do_dia.titulo, 160), texto: txt(b.missao_do_dia.texto, 800) } : null,
    fontes: { claude_sessoes: num(f.claude_sessoes), codex_sessoes: num(f.codex_sessoes), conversas: num(f.conversas), automaticas: num(f.automaticas), acoes: num(f.acoes) },
    relatorio_md: typeof b.relatorio_md === 'string' ? corta(b.relatorio_md, 300) : null,
    motor: typeof b.motor === 'string' ? corta(b.motor, 80) : null,
  };
}

export function coletarEscada(d: DepsPainel): { dados: DadosEscada; ausentes: string[] } {
  const b = lerJson<Bruto>(d.caminhos.escada);
  if (!b || typeof b !== 'object') return { ausentes: ['escada.json'], dados: VAZIO_ESCADA };
  return { ausentes: [], dados: normalizarEscada(b) };
}
