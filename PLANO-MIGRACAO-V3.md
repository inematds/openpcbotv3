# openpcbot v3 — análise do v2 e plano de migração

Data: 2026-09-01. Versão alvo: `3.0.0` (major → zera minor/patch).
Base analisada: `~/projetos/openpcbotv2` (v2.6.0) e os repos comparáveis listados na seção 2.

---

## 0. Resumo em uma tela

O v2 funciona, mas é um monólito (`src/bot.ts` com 145 KB) sem fila, sem custo por chamada, sem gestão do Ollama e com a memória semântica quebrada em PT-BR. Tudo que você sente falta já existe **pronto e testado em algum repo local**:

| Você quer | De onde vem (repo local) | Esforço |
|---|---|---|
| Filas de verdade | `inemaccbot/src/fila/` (portar como está) | 1 dia |
| Orquestrador bom | `claudeclaw-os/src/orchestrator.ts` + padrão "especialistas read-only, 1 lead escreve" (grokky) | 3–4 dias |
| Gestão do Ollama | **não existe em nenhum repo** — módulo novo, desenhado nas regras já medidas em `wifi/OLLAMA-TUNING.md` | 2–3 dias |
| Cérebro com aprendizado | v2 `memory.ts` (base) + `claudeclaw-os/src/memory-consolidate.ts` (consolidação e contradição) + `MEMORY.md` curado (Hermes) | 3–4 dias |
| Gestão de tarefas | cron com sessão principal vs isolada + heartbeat com detecção de zumbi (openclaw/Hermes) | 2 dias |
| Canais | barramento de eventos (`nanobot/bus/`) com Telegram/WhatsApp/Slack como adaptadores | 2–3 dias |
| Economia de tokens | tiers local→barato→premium, custo por chamada (`claudeclaw-os totalCostUsd`), skills só-metadata (`openclaw/docs/token-use.md`), orçamento mensal com trava | 2 dias |
| Observabilidade | `claudeclaw-os/src/dashboard.ts` (timeline de custo por agente) + `/status` lendo a fila + alertas no Telegram e no hub `wifi` | 2–3 dias |

Total estimado: **~4 semanas** de trabalho efetivo, em fases que rodam ao lado do v2 (estrangulamento, não corte seco).

---

## 1. Diagnóstico do v2

**Arquitetura** (`src/index.ts` → `src/bot.ts`): Telegram via grammy; `src/memory.ts` injeta contexto do SQLite; `src/router.ts` pede ao Ollama para classificar e devolver `{agent, instructions}`; despacha para `agent.ts` (Claude Agent SDK), `codex.ts`, `openrouter.ts` ou fica no Ollama. WhatsApp em `src/whatsapp.ts` (whatsapp-web.js), Slack em `src/slack.ts`, dashboard Hono na 3141 (`src/dashboard.ts`).

**O que está bom e vai pro v3 sem mudar de ideia**
- Roteamento por LLM local (grátis) antes de gastar token na nuvem.
- Memória SQLite com WAL + FTS5, salience com decaimento 2%/dia (`src/memory.ts`, `src/db.ts`).
- Vault em Markdown (`vault-template/`) para memória explícita.
- Skills em `skills/*/SKILL.md` com front-matter, injetadas compactas no orquestrador (`src/skills.ts`).
- Agentes especialistas em `agents/*/agent.yaml` (comms, content, ops, research).
- Logger pino com JSON em produção (`src/logger.ts`).

**O que dói**
- `src/bot.ts` com 145 KB e `src/` flat com ~12.150 linhas em 30 módulos.
- Sem fila: scheduler é `setInterval` de 60 s (`src/scheduler.ts`), processamento sequencial por chat, mensagem que chega durante execução colide.
- Sem custo por chamada nem `/usage` (gap #3 de `RELATORIO_AB_GANHOS.md`, "hoje cego").
- Sem gestão do Ollama: assume `qwen3.6:35b-a3b` no ar, sem preflight de RAM, sem política de residência.
- Memória semântica classifica por regex **só em inglês** (`SEMANTIC_SIGNALS`), bug ativo diário em PT-BR (`TODO_MEMORIA.md` #1).
- SQLite e vault não conversam; busca literal sem embeddings (`TODO_MEMORIA.md` #2, #3).
- Sem guarda de exfiltração de segredos antes do `sendMessage` (gap #2 do relatório, severidade alta).
- Sem health de OAuth (Slack/Google expiram em silêncio).
- Serviço systemd `--user` sem `Restart=on-failure` (anotado no `CLAUDE.md` do v2).
- 11 itens do upstream ClaudeClaw não portados (~44 h) e 5 TODOs de memória parados desde 2026-05-01 aguardando sua decisão.

---

## 2. O que cada comparável ensina

Aviso honesto: **jarvis** (`~/projetos/jarvis`) e os cinco repos **hermes** (`hermesagent`, `agentehermes`, `agente-hermes-local`, `hermes21c`, `claude-hermes-os`) são **cursos HTML**, não código. **grokky** é app Electron desktop. A comparação com Hermes usa o upstream `github.com/NousResearch/hermes-agent` (README conferido em 2026-09-01).

| Repo | Tipo | O que roubar | Onde |
|---|---|---|---|
| **inemaccbot** | bot de fila (TS) | Fila SQLite com claim atômico, lease + heartbeat, backoff exponencial, idempotência, cancelamento sem corrida, drain gracioso, notificação resiliente | `src/fila/store.ts`, `src/fila/worker.ts`, `src/gateway/comandos.ts` |
| **claudeclaw-os** | evolução do claudeclaw (TS) | Consolidação de memória com detecção de contradição por timestamp; retrieval em 3 camadas; registry de subagentes + hive mind; custo por resposta; dashboard SSE com timeline de custo por agente; purge TTL de dados sensíveis | `src/memory-consolidate.ts`, `src/memory.ts`, `src/orchestrator.ts`, `src/dashboard.ts` |
| **openclaw** | gateway multicanal (TS) | Fila por *lane* (por sessão + global) com modos `steer/followup/collect/interrupt`; cron em sessão principal ou isolada; prompt em camadas com skills só-metadata; pruning ciente do TTL de cache; `/usage off\|tokens\|full\|cost`; `doctor`; OTEL | `docs/concepts/queue.md`, `docs/automation/cron-jobs.md`, `docs/token-use.md`, `extensions/diagnostics-otel` |
| **nanobot** | assistente Python leve | Barramento assíncrono desacoplando canal↔agente; heartbeat de 30 min; registry declarativo de providers | `bus/`, `heartbeat/`, `providers/registry.py` |
| **Hermes (upstream)** | agente Nous Research | Loop de aprendizado fechado (cria skills após tarefa complexa, skills se auto-melhoram); `MEMORY.md` + `USER.md` curados sobre SQLite bruto; subagentes isolados; cron com entrega em qualquer canal; `/compress`, `/usage`, `/insights`; a conta de que ~73 % do request é overhead fixo | README upstream; conceitos em `hermes21c/curso/trilha3/` |
| **grokky** | cockpit Electron | "Especialistas read-only em paralelo + 1 lead com escrita"; gate de acesso em 3 níveis por conversa; timeline de eventos normalizados | `README.md` (linhas 92, 376–398) |
| **jarvis** | curso | Vocabulário de camadas (canais, identidade, ferramentas, skills, agentes, cérebros) e checklist Context·Connections·Capabilities·Cadence para documentar o v3 | `curso/trilha4/` |

---

## 3. Arquitetura alvo do v3

```
canais (Telegram | WhatsApp | Slack | CLI | HTTP)
   │  adaptadores finos → publicam no
   ▼
BUS de eventos (in-process, tipado)
   │
   ▼
FILA (SQLite, portada do inemaccbot)  ── lanes: chat:<id> | main | ollama | cron
   │
   ▼
ORQUESTRADOR  ─ classifica (Ollama pequeno) → planeja → despacha
   │            ├─ resposta direta (Ollama residente)
   │            ├─ agente especialista (agents/*.yaml, contexto isolado)
   │            └─ paralelo: N especialistas read-only + 1 lead com escrita
   ▼
CÉREBRO  ─ SQLite FTS5 + salience (v2) + embeddings bge-m3 (local)
         ─ MEMORY.md / USER.md curados (Hermes)
         ─ consolidação noturna com contradição (claudeclaw-os)
         ─ hive mind entre agentes
   ▼
GESTOR DO OLLAMA  ─ registry de papéis, 1 modelo residente, preflight de RAM, lane serializada
   ▼
CUSTO & TELEMETRIA  ─ custo por chamada, orçamento, /usage, dashboard, alertas
```

Regras de ouro (vêm de dor real, não de teoria):
1. **Nenhum módulo com mais de 500 linhas.** `src/` com subpastas por camada.
2. **Toda chamada de LLM passa pelo gestor de custo.** Sem exceção, inclusive Ollama (custo zero, mas conta tokens e tempo).
3. **Ollama só via o serviço systemd.** Nunca `ollama serve` paralelo (segunda instância briga pela 11434, `wifi/OLLAMA-TUNING.md`).
4. **Nada de mídia paga sem confirmação explícita** (regra herdada do `CLAUDE.md` do wifi).

---

## 4. Plano por área

### 4.1 Filas (`src/fila/`)
- Copiar `inemaccbot/src/fila/{store,worker,types}.ts` e os `*.test.ts`. Eles já resolvem double-dispatch, lease morto, backoff, idempotência.
- Adicionar coluna `lane` e a política do openclaw: uma lane por chat, uma `main`, uma `ollama` (concorrência 1) e uma `cron`.
- Modos de chegada durante execução: `collect` (junta mensagens seguidas em um job), `steer` (injeta no job em voo), `interrupt` (cancela e recomeça). Padrão: `collect` com janela de 2 s.
- `/status` e `/status <ref>` do inemaccbot como estão; `/cancelar <ref>`, `/prioridade <ref> <n>`.

### 4.2 Orquestrador (`src/orquestrador/`)
- Três passos separados e testáveis: `classificar()` (Ollama pequeno, JSON), `planejar()` (decide direto vs agente vs paralelo), `despachar()`.
- Registry de agentes de `agents/*/agent.yaml` (já existe no v2, mesmo formato do claudeclaw-os) com `modelo`, `esforco`, `timeout`, `permissao` (`read | workspace | full`, gate do grokky).
- Paralelismo: especialistas read-only via `Promise.all`, lead único consolida e é o único que escreve.
- Hive mind: tabela `hive_log` no SQLite, cada agente lê as últimas N entradas dos outros antes de agir.
- Decisão aberta: motor de execução, **Claude Agent SDK** (v2, `src/agent.ts`) ou **CLI como subprocesso** (inemaccbot `runner-claude.ts`, `--model --effort`). Recomendo CLI por job de fila (isolamento, timeout, abort) e SDK só para conversa interativa.

### 4.3 Gestão do Ollama (`src/ollama/`) — módulo novo
Fatos da máquina: 16 modelos em disco (~300 GB), memória unificada GB10, dois travamentos por OOM em 2026-08 (`wifi/FALHAS.md`), override com `OLLAMA_CONTEXT_LENGTH=32768` e `KV_CACHE_TYPE=q8_0`, script `wifi/ollama-keeponly-qwen36.sh` para fixar um modelo.

Desenho:
- **Registry de papéis** em `config/ollama.yaml`:
  - `roteador`: `llama3.2` ou `qwen2.5:14b` (rápido, JSON) — hoje o router usa o 35b, desperdício.
  - `geral` (residente): `qwen3.6:35b-a3b`, `keep_alive: -1`.
  - `embed`: `bge-m3` (já instalado, 1.2 GB) — resolve o TODO #3 sem Gemini.
  - `pesado` (sob demanda, descarrega depois): `llama3.1:70b` / `command-r:35b`.
- **Política de residência**: no máximo 1 modelo grande carregado. Antes de carregar outro: `ollama stop` do atual, esperar `ollama ps` vazio, checar `free` (mínimo configurável, ex. 40 GB livres), só então carregar.
- **Lane `ollama` com concorrência 1** na fila (o runner com `-np 1` serializa mesmo; enfileirar evita timeouts).
- **Health probe** a cada 60 s: `GET /api/tags`, `ollama ps`, tempo de um `"ok"` a quente. Se >5 s a quente ou serviço fora, alerta e cai para OpenRouter barato.
- **Comandos**: `/ollama status`, `/ollama usar <modelo>`, `/ollama descarregar`.
- **Limpeza sugerida** (decisão sua): `llama3.1-70b-16k`, `llama3.1-70b-32k`, `llama3.1:70b` (3×42 GB, mesmos blobs mas um só basta), `llama3` genérico, `qwen3:30b` vs `qwen3.8:27b` duplicado de papel.

### 4.4 Cérebro com aprendizado (`src/cerebro/`)
- Manter `memories` (FTS5 + salience) do v2.
- **Dia 1**: regex PT-BR nos sinais semânticos (TODO #1, 5 min).
- Embeddings locais com `bge-m3`, tabela `memory_vec` (sqlite-vec ou vetor em BLOB com cosseno em JS; volume é pequeno). Retrieval em 3 camadas: FTS5 + vetor + recentes de alta importância + insights.
- `MEMORY.md` e `USER.md` curados no vault: o agente propõe entradas, você aprova via botão no Telegram. É a memória que você lê.
- **Consolidação noturna** (job cron na lane `main`): portar `claudeclaw-os/src/memory-consolidate.ts`: funde duplicatas (TODO #5), detecta contradições por timestamp e marca a antiga como `superseded`, gera insights. Rodar no Ollama residente, não no Gemini.
- **Loop de aprendizado de skills (Hermes)**: ao terminar tarefa marcada como complexa (>N passos de tool), o agente escreve um rascunho `skills/_rascunhos/<nome>/SKILL.md`; você promove ou descarta. Nunca auto-promove.
- Auto-injeção de insights do vault no contexto (TODO #4) só dos top-3 por relevância, limitado a 400 tokens.

### 4.5 Gestão de tarefas e canais
- **Cron** (`src/tarefas/`): manter `cron-parser`, mas as tarefas viram jobs na fila. Dois modos: `sessao: principal` (vê seu contexto) ou `isolada` (contexto limpo, mais barato). Entrega em qualquer canal.
- **Heartbeat** a cada 30 min: varre jobs com lease vencido (já vem do `recuperarLeasesVencidos`), tarefas travadas >2× o timeout viram alerta e são reclamadas por agente novo.
- **Tarefas suas** (não do bot): tabela `tarefas_usuario` com `/tarefa add|lista|feita`, lembrete por cron, resumo diário às 8h no `/daily`. Sincronia com Google Calendar já existe em `skills/google-calendar`.
- **Canais**: `src/canais/{telegram,whatsapp,slack,cli,http}.ts`, cada um só traduz para/do bus. WhatsApp continua em whatsapp-web.js; **risco**: quebra a cada mudança do WhatsApp Web, manter em processo separado (`scripts/wa-daemon.ts` já faz isso) com restart automático.
- Guarda de exfiltração: filtro de padrões de segredo em todo `sendMessage` (gap #2, severidade alta).
- Health de OAuth: probe diário de Slack/Google, alerta no Telegram (gap #4).

### 4.6 Economia de tokens (`src/custo/`)
- Tabela `chamadas_llm` (modelo, tokens in/out/cache, custo USD, agente, job, latência). Preços em `config/precos.yaml`.
- **Tiers**: `local` (Ollama, custo 0) → `barato` (Haiku 4.5 / modelo barato do OpenRouter) → `premium` (Sonnet/Opus 5). O planejador escolhe o tier; subir de tier exige motivo registrado.
- Skills carregadas **só metadata** no prompt; corpo lido sob demanda (openclaw). Objetivo: medir e derrubar os ~73 % de overhead fixo que o Hermes documenta.
- Pruning ciente do TTL de cache: se a sessão ficou ociosa além do TTL do provedor, compactar antes de mandar (evita reescrever cache caro).
- `/usage` (hoje, semana, mês, por agente) e `/compress` manual.
- **Orçamento mensal** em `config/orcamento.yaml` com aviso a 70 % e trava dura a 100 % (só Ollama passa). Valor é decisão sua.

### 4.7 Observabilidade (`src/telemetria/`)
- pino JSON fica. Cada job/chamada carrega `trace_id`.
- Dashboard (portar `claudeclaw-os/src/dashboard.ts`): fila ao vivo, custo por agente/dia, memória (pinned, decaindo, mais acessadas), Ollama (modelo residente, RAM, latência), heartbeat.
- `GET /health` com fila, Ollama, OAuth, RAM. O hub `wifi` (iccmonit, porta 9003) consome esse endpoint.
- Alertas no Telegram: Ollama fora, RAM abaixo do piso, job falhou 3×, orçamento a 70 %, OAuth expirado.
- `openpcbot doctor` na CLI (ideia do openclaw): checa env, DB, Ollama, tokens, permissões.
- Backup noturno do SQLite com `VACUUM INTO` + `age` (padrão Hermes).

---

## 5. Fases de migração (estrangulamento, v3 ao lado do v2)

O v3 sobe com **bot token próprio** e chat de teste. O v2 continua em produção até paridade. Nada é apagado.

| Fase | Entrega | Reuso | Esforço |
|---|---|---|---|
| **0. Esqueleto** | repo `openpcbotv3`, `src/` por camadas, bus, config YAML, logger, testes vitest, systemd com `Restart=on-failure` | logger e config do v2 | 2 d |
| **1. Fila + Ollama** | `fila/` portada, lanes, gestor do Ollama com registry e preflight, `/status`, `/ollama` | inemaccbot `fila/`, scripts do `wifi` | 4 d |
| **2. Custo + telemetria** | `chamadas_llm`, tiers, `/usage`, `/health`, alertas Telegram, orçamento | claudeclaw-os `totalCostUsd` | 3 d |
| **3. Canal Telegram + orquestrador** | adaptador Telegram, classificar/planejar/despachar, registry de agentes, runner CLI | v2 `router.ts`, `skills.ts`, `agents/`; inemaccbot runners | 4 d |
| **4. Cérebro** | migração do `memories` do v2 (mesma tabela), regex PT-BR, embeddings bge-m3, `MEMORY.md`, consolidação noturna | v2 `memory.ts`/`db.ts`, claudeclaw-os consolidate | 4 d |
| **5. Tarefas + heartbeat + cron** | cron como jobs, heartbeat, tarefas do usuário, `/daily` | v2 `scheduler.ts` | 2 d |
| **6. WhatsApp + Slack + skills** | adaptadores, guarda de exfiltração, OAuth health, 15 skills do v2 migradas como estão | v2 `whatsapp.ts`, `slack.ts`, `skills/` | 3 d |
| **7. Dashboard + doctor + backup** | dashboard portado, `doctor`, backup cifrado | claudeclaw-os `dashboard.ts` | 3 d |
| **8. Corte** | trocar token de produção, v2 vira só leitura por 30 dias, depois arquivar como `openpcbotv2` | — | 1 d |

Critério de paridade antes do corte: todos os comandos do v2 respondem no v3, 7 dias sem job perdido, custo semanal medido e abaixo do v2 (que hoje nem é medido).

Cada fase termina com: testes passando, linha no `CHANGELOG.md`, e falha real registrada em `FALHAS.md`.

---

## 6. Decisões que só você pode tomar

1. **Motor de execução**: Claude Agent SDK (como v2) ou CLI por subprocesso (como inemaccbot)? Recomendo CLI na fila + SDK na conversa.
2. **Orçamento mensal de tokens** em USD para a trava dura.
3. **Modelos do Ollama a apagar** (lista na 4.3; libera ~130 GB).
4. **Os 5 TODOs de memória** (`openpcbotv2/TODO_MEMORIA.md`) parados desde 2026-05-01: #1 e #5 entram sem discussão; #2, #3, #4 estão no plano acima com bge-m3 em vez de Gemini. Confirmar.
5. **Cerebro no Ollama ou na nuvem** para a consolidação noturna. Recomendo Ollama (custo zero, dados não saem).
6. **Skills auto-geradas**: aceitar rascunhos automáticos em `skills/_rascunhos/` ou desligar o loop de aprendizado de skills.
7. **Conta git** do repo v3 (default `inematds` pela regra global) e se publica desde a fase 0.

---

## 7. Riscos

- **OOM**: dois travamentos em agosto. O preflight de RAM e a política de 1 modelo residente existem por isso. Manter `host-mem-watchdog.sh` do `wifi` ativo.
- **Segunda instância do Ollama**: qualquer script que faça `ollama serve` derruba tudo. O gestor só fala HTTP com o serviço systemd.
- **Quebrar o monólito**: `bot.ts` de 145 KB tem lógica implícita (ordem de handlers, regex de gatilhos). Migrar comando a comando com teste de contrato (mesma entrada, mesma saída) antes de desligar no v2.
- **whatsapp-web.js**: frágil, processo separado obrigatório.
- **Consolidação de memória errada** apaga contexto: `superseded` nunca deleta, só esconde; backup antes de cada rodada.
- **Custo invisível durante a migração**: a fase 2 vem antes do orquestrador de propósito.

---

## 8. Fontes

- v2: `openpcbotv2/{README,CLAUDE,AGENTS,ARQUITETURA_SECOND_BRAIN,COMO_ARMAZENA_CONHECIMENTO,TODO_MEMORIA,RELATORIO_AB_GANHOS,RELATORIO_AB_CLAUDECLAW}.md`, `src/*.ts`
- Fila: `inemaccbot/src/fila/`, `inemaccbot/src/gateway/comandos.ts`
- Memória/orquestrador/dashboard: `claudeclaw-os/src/{memory,memory-consolidate,orchestrator,dashboard,message-queue,scheduler}.ts`
- Lanes/cron/tokens: `openclaw/docs/{concepts/queue,automation/cron-jobs,token-use}.md`
- Bus/heartbeat: `nanobot/{bus,heartbeat,providers}/`
- Hermes upstream: `github.com/NousResearch/hermes-agent` (README)
- Ollama na máquina: `wifi/OLLAMA-TUNING.md`, `wifi/ollama-override.conf`, `wifi/ollama-keeponly-qwen36.sh`, `wifi/FALHAS.md`
