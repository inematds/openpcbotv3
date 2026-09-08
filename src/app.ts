// Contexto compartilhado do processo: tudo que `index.ts` monta uma vez e os
// módulos recebem por injeção. Nenhum módulo importa `index.ts`.
import type Database from 'better-sqlite3';

import type { Bus } from './bus/bus.js';
import type { Config } from './config/env.js';
import type { ConfigOllama, ConfigOrcamento, ConfigPrecos } from './config/yaml.js';
import type { FilaSqlite } from './fila/store.js';
import type { GestorOllama } from './ollama/gestor.js';
import type { GatewayLLM } from './custo/gateway.js';
import type { RegistroCusto } from './custo/registro.js';
import type { Orcamento } from './custo/orcamento.js';
import type { Cerebro } from './cerebro/memoria.js';
import type { Ingestao } from './cerebro/ingestao.js';
import type { Vault } from './cerebro/vault.js';
import type { Alertas } from './telemetria/alertas.js';
import type { Cron } from './tarefas/cron.js';
import type { TarefasUsuario } from './tarefas/usuario.js';
import type { Heartbeat } from './tarefas/heartbeat.js';
import type { Sessoes } from './orquestrador/agente-cli.js';

export interface App {
  cfg: Config;
  cfgOllama: ConfigOllama;
  cfgPrecos: ConfigPrecos;
  cfgOrcamento: ConfigOrcamento;
  agora: () => number;
  iniciadoEm: number;
  db: Database.Database;
  bus: Bus;
  fila: FilaSqlite;
  ollama: GestorOllama;
  gateway: GatewayLLM;
  registro: RegistroCusto;
  orcamento: Orcamento;
  cerebro: Cerebro;
  ingestao: Ingestao;
  vault: Vault;
  alertas: Alertas;
  cron: Cron;
  tarefas: TarefasUsuario;
  heartbeat: Heartbeat;
  sessoes: Sessoes;
  log: (m: string) => void;
  /** Canais efetivamente ligados neste processo. */
  canaisAtivos: string[];
}
