// Regras de alerta do painel — ÚNICO lugar. Cada regra lê os grupos já
// coletados e devolve alertas com chave estável `regra:sujeito` (a voz da tela
// e o aviso no Telegram deduplicam por ela). Fonte ausente nunca dispara alerta.
//
// Janelas escolhidas para a TV não nascer vermelha com o histórico:
//   job/rodada falhou → últimas 24 h · fila com erro → item com data nas últimas 48 h
//   reinício → últimas 6 h · erro de memória da GPU → última hora.
import type { AlertaPainel, Grupo, NomeGrupo } from './tipos.js';
import type { DadosMaquina } from './fontes/maquina.js';
import type { coletarBots, Falha } from './fontes/bots.js';
import type { coletarProducao } from './fontes/producao.js';
import type { coletarPublicacao } from './fontes/publicacao.js';
import type { coletarCreditos } from './fontes/creditos.js';
import type { coletarSites } from './fontes/sites.js';
import type { coletarTerminais } from './fontes/terminais.js';

type D<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>> extends { dados: infer X } ? X : never;
export interface GruposColetados {
  maquina: Grupo<DadosMaquina>;
  bots: Grupo<D<typeof coletarBots>>;
  producao: Grupo<D<typeof coletarProducao>>;
  publicacao: Grupo<D<typeof coletarPublicacao>>;
  creditos: Grupo<D<typeof coletarCreditos>>;
  sites: Grupo<D<typeof coletarSites>>;
  terminais: Grupo<D<typeof coletarTerminais>>;
}

export const LIMITES = { discoPct: 90, memoriaGb: 10, reinicioH: 6, limitePct: 80 };

interface Regra { id: string; grupo: NomeGrupo; avaliar: (g: GruposColetados, agora: number) => Omit<AlertaPainel, 'grupo'>[] }

const hora = (t: number | null) => (t ? new Date(t * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '?');
const host = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');

export const REGRAS: Regra[] = [
  { id: 'disco', grupo: 'maquina', avaliar: (g) => {
    const x = g.maquina.dados?.disco;
    return x && x.usado_pct > LIMITES.discoPct ? [{ chave: 'disco:raiz', nivel: 'erro', texto: `Disco da raiz em ${x.usado_pct}% (livres ${x.livre_gb} GB)` }] : [];
  } },
  { id: 'memoria', grupo: 'maquina', avaliar: (g) => {
    const m = g.maquina.dados?.memoria;
    return m && m.disponivel_gb < LIMITES.memoriaGb ? [{ chave: 'memoria:baixa', nivel: 'erro', texto: `Memória disponível baixa: ${m.disponivel_gb} GB` }] : [];
  } },
  { id: 'gpu', grupo: 'maquina', avaliar: (g) => {
    const x = g.maquina.dados?.gpu_oom;
    return x && x.ultima_hora > 0 ? [{ chave: 'gpu:oom', nivel: 'erro', texto: `GPU sem memória: ${x.ultima_hora} erro(s) na última hora (último ${hora(x.ultima_em)})` }] : [];
  } },
  { id: 'reinicio', grupo: 'maquina', avaliar: (g, agora) => {
    const b = g.maquina.dados?.boot_em;
    return b && agora - b < LIMITES.reinicioH * 3600 ? [{ chave: `reinicio:${b}`, nivel: 'aviso', texto: `A máquina reiniciou às ${hora(b)}` }] : [];
  } },
  { id: 'servico', grupo: 'bots', avaliar: (g) => Object.entries(g.bots.dados?.servicos ?? {})
    .filter(([, st]) => st !== 'active' && st !== 'desconhecido')
    .map(([s, st]) => ({ chave: `servico:${s}`, nivel: 'erro' as const, texto: `Serviço ${s} está ${st}` })) },
  { id: 'job-falhou', grupo: 'bots', avaliar: (g) => {
    const f = (bot: string, l: Falha[] | undefined) => (l ?? []).map((j) => ({ chave: `job-falhou:${bot}:${j.id}`, nivel: 'erro' as const, texto: `${bot}: job #${j.id} (${j.tarefa}) falhou às ${hora(j.quando)}` }));
    return [...f('v3', g.bots.dados?.v3?.falhas_24h), ...f('inemaccbot', g.bots.dados?.inemaccbot?.falhas_24h)];
  } },
  { id: 'rodada-falhou', grupo: 'producao', avaliar: (g) => (g.producao.dados?.falhas ?? [])
    .map((r) => ({ chave: `rodada-falhou:${r.unidade}:${r.edicao ?? r.fim}`, nivel: 'erro' as const, texto: `Rodada ${r.unidade} falhou às ${hora(r.fim)}${r.motivo ? ': ' + r.motivo : ''}` })) },
  { id: 'rodada-presa', grupo: 'producao', avaliar: (g) => (g.producao.dados?.presas ?? [])
    .map((r) => ({ chave: `rodada-presa:${r.unidade}:${r.inicio}`, nivel: 'erro' as const, texto: `Rodada ${r.unidade} começou às ${hora(r.inicio)} e não terminou` })) },
  { id: 'espera', grupo: 'producao', avaliar: (g) => (g.producao.dados?.esperas ?? [])
    .filter((e) => e.passou_teto || (e.estado === 'falhou' && e.recente))
    .map((e) => ({ chave: `espera:${e.chave}:${e.estado}`, nivel: 'aviso' as const, texto: e.estado === 'falhou' ? `Espera ${e.chave} falhou` : `Espera ${e.chave} passou do teto de ${e.teto_h} h` })) },
  { id: 'fila-erro', grupo: 'publicacao', avaliar: (g) => (g.publicacao.dados?.filas ?? [])
    .flatMap((f) => f.erros_recentes.map((e) => ({ chave: `fila-erro:${f.nome}:${e.id}`, nivel: 'aviso' as const, texto: `Fila ${f.nome}: "${e.nome}" deu erro` }))) },
  // continua com estado.json vazio/corrompido = vigia parado (10/11 00:29: disco cheio zerou o arquivo e ninguém viu).
  { id: 'fila-ilegivel', grupo: 'publicacao', avaliar: (g) => (g.publicacao.dados?.filas_itens ?? [])
    .filter((f) => f.problema && /VAZIO|corrompido/.test(f.problema))
    .map((f) => ({ chave: `fila-ilegivel:${f.chave}`, nivel: 'erro' as const, texto: `${f.nome}: ${f.problema}` })) },
  { id: 'site-fora', grupo: 'sites', avaliar: (g) => (g.sites.dados?.sites ?? [])
    .filter((s) => !s.ok).map((s) => ({ chave: `site-fora:${host(s.url)}`, nivel: 'erro' as const, texto: `${host(s.url)} fora do ar (${s.erro ?? 'sem resposta'})` })) },
  { id: 'limite', grupo: 'creditos', avaliar: (g) => {
    const c = g.creditos.dados;
    const out = (c?.claude.limites ?? []).filter((l) => l.pct > LIMITES.limitePct)
      .map((l) => ({ chave: `limite-claude:${l.nome}`, nivel: 'aviso' as const, texto: `Claude ${l.nome}: ${l.pct}% usado` }));
    if (c?.codex && c.codex.pct > LIMITES.limitePct) out.push({ chave: 'limite-codex:semana', nivel: 'aviso', texto: `Codex: ${c.codex.pct}% do limite usado` });
    return out;
  } },
  { id: 'aviso-manual', grupo: 'creditos', avaliar: (g) => (g.creditos.dados?.avisos ?? [])
    .filter((a) => a.vencido || a.nivel === 'erro' || (a.dias !== null && a.dias <= 2))
    .map((a) => {
      const ate = a.ate && /^\d{4}-\d{2}-\d{2}/.test(a.ate) ? a.ate.slice(8, 10) + '/' + a.ate.slice(5, 7) : a.ate;
      return { chave: `manual:${a.titulo}`, nivel: a.nivel === 'erro' || a.vencido ? 'erro' as const : 'aviso' as const, texto: a.vencido ? `${a.titulo}: prazo passou (${ate})` : `${a.titulo}${ate ? ` até ${ate}` : ''}` };
    }) },
  { id: 'terminal-interrompido', grupo: 'terminais', avaliar: (g) => (g.terminais.dados?.interrompidos ?? [])
    .map((t) => ({ chave: `terminal-interrompido:${t.session_id}`, nivel: 'aviso' as const, texto: `Terminal interrompido em ${t.projeto}` })) },
];

export function avaliarAlertas(g: GruposColetados, agora: number): AlertaPainel[] {
  const out: AlertaPainel[] = [];
  for (const r of REGRAS) {
    try { for (const a of r.avaliar(g, agora)) out.push({ ...a, grupo: r.grupo }); } catch { /* regra nunca derruba o painel */ }
  }
  return out.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'erro' ? -1 : 1));
}
