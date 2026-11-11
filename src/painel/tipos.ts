// Contratos do painel: dependências injetadas (para o bot e para o servidor de
// teste isolado) e o formato de cada grupo do /api/painel.
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

import { Cache, executar, type Executor } from './util.js';

export interface Caminhos {
  rodadas: string;
  continua: string;
  ytHistorico: string;
  filaEspanhol: string;
  filaCidades: string;
  filaR7ex: string;
  filaLives11: string;
  filaAventuras: string;
  raizProjetos: string;
  ccLimites: string;
  codexSessoes: string;
  avisos: string;
  sites: string;
  vagasJson: string;
  scriptFilaVaga: string;
  scriptVagas: string;
  scriptTerminais: string;
  claudeProjetos: string;
  terminaisEstado: string;
  pendencias: string;
  inemaccbotDb: string;
  inemaccbotFilas: string;
  estadoTelegram: string;
}

export function caminhosPadrao(home = homedir(), raizBot = process.cwd()): Caminhos {
  const h = (p: string) => resolve(home, p);
  return {
    rodadas: h('.local/share/inema/rodadas.jsonl'),
    continua: h('projetos/wifi/continua/estado.json'),
    ytHistorico: h('.local/share/yt-pubx/historico.jsonl'),
    filaEspanhol: h('projetos/wifi/fila-espanhol/fila.json'),
    filaCidades: h('projetos/wifi/fila-cidades/fila.json'),
    filaR7ex: h('projetos/r7ex/fila/fila.json'),
    filaLives11: h('projetos/metricool-pub2/lives11/fila.json'),
    filaAventuras: h('projetos/aventurasinemavideo/privado/fila_publicar.txt'),
    raizProjetos: h('projetos'),
    ccLimites: `/tmp/cc_limits_${process.getuid?.() ?? 1000}.json`,
    codexSessoes: h('.codex-2/sessions'),
    avisos: h('.config/inema/painel-avisos.json'),
    sites: h('.config/inema/painel-sites.json'),
    // Mesmo override do comando `vagas` (VAGAS_ARQ troca o arquivo).
    vagasJson: process.env.VAGAS_ARQ || h('.config/inema/vagas.json'),
    scriptFilaVaga: h('projetos/wifi/scripts/fila-vaga'),
    scriptVagas: h('projetos/wifi/scripts/vagas'),
    scriptTerminais: h('projetos/wifi/scripts/terminais'),
    claudeProjetos: h('.claude/projects'),
    terminaisEstado: resolve(process.env.TERMINAIS_DIR || h('.local/share/inema/terminais'), 'estado'),
    pendencias: h('projetos/wifi/pendencias.md'),
    inemaccbotDb: h('projetos/inemaccbot/inemaccbot.db'),
    inemaccbotFilas: h('projetos/inemaccbot/src/fila/filas.ts'),
    estadoTelegram: resolve(raizBot, 'store/painel-avisados.json'),
  };
}

export interface DepsPainel {
  /** Banco do próprio v3 (pode faltar no teste). */
  db?: Database.Database;
  versao: string;
  caminhos: Caminhos;
  exec: Executor;
  /** Epoch em segundos. */
  agora: () => number;
  cache: Cache;
  /** Concorrência interna do v3 (lanes da fila). */
  concorrenciaV3: Record<string, number>;
  /** `fetch` injetável (teste dos sites sem rede). */
  fetch: typeof fetch;
  /** Sites ligados? (`PAINEL_SITES=0` desliga). */
  sitesLigado: boolean;
  /** Conversa com o bot pelo painel (PAINEL_CHAT=1). */
  conversa?: import('./conversa.js').Conversa;
  /** Token Bearer que libera o POST /api/vagas; sem token = 403. */
  token?: string;
  /** Servidor do painel com login (3143): a sessão autentica o POST /api/vagas. */
  porSessao?: boolean;
  /** Envio de alerta ao Telegram (só usado com PAINEL_ALERTA_TELEGRAM=1). */
  enviarTelegram?: (texto: string) => void;
}

export function depsPadrao(p: Partial<DepsPainel> & { versao: string; concorrenciaV3: Record<string, number> }): DepsPainel {
  return {
    caminhos: caminhosPadrao(),
    exec: executar,
    agora: () => Math.floor(Date.now() / 1000),
    cache: new Cache(),
    fetch: globalThis.fetch,
    sitesLigado: process.env.PAINEL_SITES !== '0',
    token: process.env.DASHBOARD_TOKEN_V3 || undefined,
    ...p,
  };
}

export type NomeGrupo = 'maquina' | 'bots' | 'producao' | 'publicacao' | 'creditos' | 'sites' | 'vagas' | 'radar' | 'terminais' | 'esperando';

export interface Grupo<T = Record<string, unknown>> {
  ok: boolean;
  gerado_em: number;
  dados?: T;
  erro?: string;
  /** Fontes que não existiam/sem acesso nesta leitura (o cartão mostra "sem dados"). */
  ausentes?: string[];
}

export type Nivel = 'erro' | 'aviso';
export interface AlertaPainel {
  /** Chave estável `regra:sujeito` — nunca com número que varia (a voz e o Telegram deduplicam por ela). */
  chave: string;
  nivel: Nivel;
  grupo: NomeGrupo;
  texto: string;
}
