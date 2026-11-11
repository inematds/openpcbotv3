// Agregador do /api/painel: coleta cada grupo isolado (erro de um grupo vira
// `ok:false` naquele grupo, nunca 500), deriva "Esperando você" e aplica as
// regras de alerta. Custo por chamada: leituras de /proc, SQLite com LIMIT,
// fim de arquivos e comandos curtos com cache.
import { avaliarAlertas, type GruposColetados } from './alertas.js';
import { coletarBots, falhaCompletaV3 } from './fontes/bots.js';
import { coletarCreditos } from './fontes/creditos.js';
import { coletarMaquina } from './fontes/maquina.js';
import { coletarProducao } from './fontes/producao.js';
import { coletarPublicacao } from './fontes/publicacao.js';
import { coletarRadar } from './fontes/radar.js';
import { coletarVps } from './fontes/vps.js';
import { coletarApis } from './fontes/apis.js';
import { coletarSites } from './fontes/sites.js';
import { coletarPendencias, coletarTerminais } from './fontes/terminais.js';
import { coletarVagas } from './fontes/vagas.js';
import { avisarNovos } from './telegram-alerta.js';
import type { AlertaPainel, DepsPainel, Grupo, NomeGrupo } from './tipos.js';

async function grupo<T>(d: DepsPainel, f: () => Promise<{ dados: T; ausentes: string[] }> | { dados: T; ausentes: string[] }): Promise<Grupo<T>> {
  try {
    const r = await f();
    return { ok: true, gerado_em: d.agora(), dados: r.dados, ...(r.ausentes.length ? { ausentes: r.ausentes } : {}) };
  } catch (e) {
    return { ok: false, gerado_em: d.agora(), erro: (e as Error).message };
  }
}

export interface ItemEsperando { tipo: string; texto: string; nivel: 'erro' | 'aviso' | 'info'; grupo: NomeGrupo }

export function montarEsperando(g: GruposColetados, pendencias: { titulo: string }[] | null, aguardandoOk: { fluxo_id: number; fase: string; slug: string }[]): ItemEsperando[] {
  const out: ItemEsperando[] = [];
  for (const f of g.bots.dados?.v3?.falhas_24h ?? []) out.push({ tipo: 'falha', nivel: 'erro', grupo: 'bots', texto: `v3 #${f.id} ${f.tarefa} falhou` });
  for (const f of g.bots.dados?.inemaccbot?.falhas_24h ?? []) out.push({ tipo: 'falha', nivel: 'erro', grupo: 'bots', texto: `inemaccbot #${f.id} ${f.tarefa} falhou` });
  for (const r of g.producao.dados?.falhas ?? []) out.push({ tipo: 'falha', nivel: 'erro', grupo: 'producao', texto: `${r.unidade} falhou${r.motivo ? ': ' + r.motivo : ''}` });
  for (const r of g.producao.dados?.presas ?? []) out.push({ tipo: 'presa', nivel: 'erro', grupo: 'producao', texto: `${r.unidade} parada há ${r.aberta_min} min` });
  for (const e of g.producao.dados?.esperas ?? []) if (((e.estado === 'falhou' || e.estado === 'parado') && e.recente) || e.passou_teto) out.push({ tipo: 'espera', nivel: 'aviso', grupo: 'producao', texto: `Espera ${e.chave}: ${e.passou_teto ? 'passou do teto' : e.estado}` });
  for (const a of aguardandoOk) out.push({ tipo: 'ok', nivel: 'aviso', grupo: 'bots', texto: `inemaccbot aguarda seu OK: ${a.slug} (${a.fase})` });
  for (const t of g.terminais.dados?.interrompidos ?? []) out.push({ tipo: 'terminal', nivel: 'aviso', grupo: 'terminais', texto: `Terminal interrompido em ${t.projeto}` });
  for (const a of g.creditos.dados?.avisos ?? []) out.push({ tipo: 'manual', nivel: a.vencido || a.nivel === 'erro' ? 'erro' : a.nivel === 'info' ? 'info' : 'aviso', grupo: 'creditos', texto: a.ate && /^\d{4}-\d{2}-\d{2}/.test(a.ate) ? `${a.titulo} até ${a.ate.slice(8, 10)}/${a.ate.slice(5, 7)}` : a.ate ? `${a.titulo} até ${a.ate}` : a.titulo });
  for (const p of pendencias ?? []) out.push({ tipo: 'pendencia', nivel: 'info', grupo: 'esperando', texto: p.titulo });
  return out;
}

export interface Painel {
  versao: string; gerado_em: number; ms: number;
  grupos: GruposColetados & { vagas: Grupo<Awaited<ReturnType<typeof coletarVagas>>['dados']>; radar: Grupo<ReturnType<typeof coletarRadar>['dados']>; esperando: Grupo<{ itens: ItemEsperando[] }> };
  alertas: AlertaPainel[];
}

export async function montarPainel(d: DepsPainel): Promise<Painel> {
  const t0 = Date.now();
  const [maquina, bots, producao, publicacao, creditos, sites, vagas, terminais, radar, vps, apis] = await Promise.all([
    grupo(d, async () => ({ dados: await coletarMaquina(d), ausentes: [] })),
    grupo(d, () => coletarBots(d)),
    grupo(d, () => coletarProducao(d)),
    grupo(d, () => coletarPublicacao(d)),
    grupo(d, () => coletarCreditos(d)),
    grupo(d, () => coletarSites(d)),
    grupo(d, () => coletarVagas(d)),
    grupo(d, () => coletarTerminais(d)),
    grupo(d, () => coletarRadar(d)),
    grupo(d, () => coletarVps(d)),
    grupo(d, () => coletarApis(d)),
  ]);
  const g: GruposColetados = { maquina, bots, producao, publicacao, creditos, sites, terminais, vps, apis };
  const esperando = await grupo(d, () => {
    const pend = coletarPendencias(d);
    return { dados: { itens: montarEsperando(g, pend, bots.dados?.inemaccbot?.aguardando_ok ?? []) }, ausentes: pend === null ? ['pendencias.md'] : [] };
  });
  const alertas = avaliarAlertas(g, d.agora());
  if (d.enviarTelegram) {
    try { avisarNovos(alertas, d.caminhos.estadoTelegram, d.enviarTelegram, d.agora()); } catch { /* nunca derruba o painel */ }
  }
  return { versao: d.versao, gerado_em: d.agora(), ms: Date.now() - t0, grupos: { ...g, vagas, radar, esperando }, alertas };
}

export { falhaCompletaV3 };
