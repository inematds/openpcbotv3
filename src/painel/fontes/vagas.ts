// Vagas: quantos processos pesados podem rodar juntos por classe (gpu, render,
// estudio, claude, codex). Leitura de `fila-vaga --status --json` + vagas.json,
// e a concorrência interna (só leitura) do v3 e do inemaccbot. A ÚNICA escrita
// do painel é mudar vagas, e ela passa pelo comando `vagas <classe> <n>`.
import { existsSync } from 'node:fs';

import type { DepsPainel } from '../tipos.js';
import { lerJson, lerTexto } from '../util.js';

export interface Classe { classe: string; vagas: number | null; teto: number | null; ocupadas: number | null; dono: string | null; desde: unknown; esperando: number | null }

/** `CONCORRENCIAS = { render: 1, ... }` do filas.ts do inemaccbot → objeto. */
export function lerConcorrenciaTs(fonte: string | null): Record<string, number> | null {
  if (!fonte) return null;
  const m = /CONCORRENCIAS[^=]*=\s*\{([^}]*)\}/.exec(fonte);
  if (!m) return null;
  const out: Record<string, number> = {};
  for (const p of m[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) out[p[1]] = Number(p[2]);
  return Object.keys(out).length ? out : null;
}

type VagasJson = Record<string, unknown> & { _teto?: Record<string, number> };

export function tetoDe(vj: VagasJson | null, classe: string): number | null {
  const t = vj?._teto?.[classe];
  return typeof t === 'number' && Number.isInteger(t) ? t : null;
}

/** Junta o status vivo do fila-vaga com o arquivo de configuração. */
export function montarClasses(status: unknown, vj: VagasJson | null): Classe[] {
  const porNome = new Map<string, Classe>();
  const base = (c: string): Classe => porNome.get(c) ?? { classe: c, vagas: null, teto: tetoDe(vj, c), ocupadas: null, dono: null, desde: null, esperando: null };
  if (vj) for (const [k, v] of Object.entries(vj)) if (!k.startsWith('_') && typeof v === 'number') porNome.set(k, { ...base(k), vagas: v });
  // Formatos aceitos: lista de classes, {classes: [...]}, {classes: {gpu: {...}}} (o do fila-vaga) ou {gpu: {...}}.
  const deObjeto = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)).map(([k, v]) => ({ classe: k, ...(v as Record<string, unknown>) }));
  const cls = status && typeof status === 'object' && !Array.isArray(status) ? (status as { classes?: unknown }).classes : undefined;
  const lista: Record<string, unknown>[] = Array.isArray(status) ? status
    : Array.isArray(cls) ? cls as Record<string, unknown>[]
      : cls && typeof cls === 'object' ? deObjeto(cls as Record<string, unknown>)
        : status && typeof status === 'object' ? deObjeto(status as Record<string, unknown>) : [];
  for (const s of lista) {
    const c = String(s.classe ?? s.nome ?? '');
    if (!c) continue;
    const atual = base(c);
    const donos = Array.isArray(s.donos) && s.donos.length ? (s.donos as unknown[]).map((x) => (x && typeof x === 'object' ? String((x as { quem?: unknown }).quem ?? (x as { dono?: unknown }).dono ?? (x as { nome?: unknown }).nome ?? '?') : String(x))).join(', ') : null;
    const espera = Array.isArray(s.esperando) ? s.esperando.length : typeof s.esperando === 'number' ? s.esperando : null;
    porNome.set(c, {
      ...atual,
      vagas: typeof s.vagas === 'number' ? s.vagas : atual.vagas,
      teto: typeof s.teto === 'number' ? s.teto : atual.teto,
      ocupadas: typeof s.ocupadas === 'number' ? s.ocupadas : Array.isArray(s.ocupadas) ? s.ocupadas.length : null,
      dono: typeof s.dono === 'string' ? s.dono : donos,
      desde: s.desde ?? (Array.isArray(s.donos) && s.donos[0] && typeof s.donos[0] === 'object' ? (s.donos[0] as { desde?: unknown }).desde ?? null : null), esperando: espera,
    });
  }
  const ordem = ['gpu', 'render', 'estudio', 'claude', 'codex'];
  return [...porNome.values()].sort((a, b) => (ordem.indexOf(a.classe) + 1 || 99) - (ordem.indexOf(b.classe) + 1 || 99));
}

export async function coletarVagas(d: DepsPainel) {
  const ausentes: string[] = [];
  const vj = lerJson<VagasJson>(d.caminhos.vagasJson);
  if (!vj) ausentes.push('vagas.json');
  const status = await d.cache.obter('vagas:status', 10_000, async () => {
    const r = await d.exec(d.caminhos.scriptFilaVaga, ['--status', '--json'], 4000);
    if (!r.stdout.trim()) return null;
    try { return JSON.parse(r.stdout) as unknown; } catch { return null; }
  });
  if (status === null) ausentes.push('fila-vaga');
  const accbot = await d.cache.obter('vagas:accbot', 10 * 60_000, () => lerConcorrenciaTs(lerTexto(d.caminhos.inemaccbotFilas)));
  return {
    dados: {
      classes: montarClasses(status, vj),
      pode_mudar: !!d.token && existsSync(d.caminhos.scriptVagas),
      motivo_so_leitura: !d.token ? 'defina o token para mudar vagas' : !existsSync(d.caminhos.scriptVagas) ? 'comando vagas ainda não instalado' : null,
      dica: 'no terminal: vagas <classe> <n>',
      internas: { openpcbotv3: d.concorrenciaV3, inemaccbot: accbot },
    },
    ausentes,
  };
}

export type RespostaVagas = { status: number; corpo: Record<string, unknown> };

/** Valida e aplica `POST /api/vagas`. `authorization` é o cabeçalho cru (só Bearer vale). */
export async function mudarVagas(d: DepsPainel, authorization: string | undefined, corpoBruto: string): Promise<RespostaVagas> {
  if (!d.token) return { status: 403, corpo: { erro: 'defina o token para mudar vagas', dica: 'no terminal: vagas <classe> <n>' } };
  if (authorization !== `Bearer ${d.token}`) return { status: 401, corpo: { erro: 'token Bearer obrigatório' } };
  let b: { classe?: unknown; valor?: unknown };
  try { b = JSON.parse(corpoBruto || '{}') as typeof b; } catch { return { status: 400, corpo: { erro: 'JSON inválido' } }; }
  const classe = typeof b.classe === 'string' ? b.classe : '';
  const valor = b.valor;
  if (!/^[a-z][a-z0-9_-]{0,30}$/.test(classe)) return { status: 400, corpo: { erro: 'classe inválida' } };
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1) return { status: 400, corpo: { erro: 'valor tem de ser inteiro ≥ 1' } };
  const vj = lerJson<VagasJson>(d.caminhos.vagasJson);
  if (!vj) return { status: 503, corpo: { erro: 'vagas.json não encontrado' } };
  if (!Object.hasOwn(vj, classe) || typeof vj[classe] !== 'number') return { status: 400, corpo: { erro: `classe desconhecida: ${classe}` } };
  const teto = tetoDe(vj, classe);
  if (teto === null) return { status: 400, corpo: { erro: `sem teto definido para ${classe} no vagas.json` } };
  if (valor > teto) return { status: 400, corpo: { erro: `acima do teto (${teto}) de ${classe}` } };
  if (!existsSync(d.caminhos.scriptVagas)) return { status: 503, corpo: { erro: 'comando vagas não instalado' } };
  const r = await d.exec(d.caminhos.scriptVagas, [classe, String(valor)], 8000);
  if (!r.ok) return { status: 500, corpo: { erro: 'o comando vagas recusou', saida: (r.stderr || r.stdout || r.erro || '').slice(0, 500) } };
  // Sem isso a tela diria "Gravado" e mostraria o valor antigo por até 5 s (cache do painel).
  d.cache.apagar('vagas:status'); d.cache.apagar('painel');
  return { status: 200, corpo: { ok: true, classe, valor, aviso: classe === 'gpu' && valor > 1 ? 'máquina só medida estável com 1' : null, saida: r.stdout.slice(0, 500) } };
}
