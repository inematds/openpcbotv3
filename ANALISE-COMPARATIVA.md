# Análise comparativa — base do plano v3

Data: 2026-09-01. Relatórios brutos dos repos que alimentaram o [PLANO-MIGRACAO-V3.md](PLANO-MIGRACAO-V3.md). Um bloco por repo, com caminhos de arquivo para conferência.

---

## 1. openpcbotv2 (`~/projetos/openpcbotv2`, v2.6.0)

Lineage: derivado do ClaudeClaw upstream (`CLAUDECLAW_GUIDE.md`); v1 arquivado em `openpcbotv1`.

**Arquitetura.** Bot Telegram (grammy), Node/TS. `src/index.ts` → `src/bot.ts` (145 KB, quase todo o handling de comandos, mídia e vault). Fluxo: mensagem → `src/memory.ts` injeta contexto do SQLite → `src/router.ts` pede ao Ollama para classificar e devolver JSON `{agent, instructions}` → despacha para `agent.ts` (Claude Agent SDK), `codex.ts` (Codex CLI), `openrouter.ts`, ou fica no Ollama. Canais: Telegram (principal), WhatsApp (`src/whatsapp.ts` + `scripts/wa-daemon.ts`, whatsapp-web.js), Slack (`src/slack.ts`, User OAuth). Dashboard Hono na 3141 (`src/dashboard.ts`, `dashboard-html.ts`).

**LLMs.** 4 backends: Ollama (default e fallback, `qwen3.6:35b-a3b`), Claude Agent SDK (`/claude`), Codex CLI (`/codex`), OpenRouter (`/openrouter`). Router é o Ollama; sem agentes habilitados em `/agents` tudo fica local. Sem custo por chamada, sem cache de resposta, sem circuit-breaker; fallback é "se falhar, cai pro Ollama" em `routeMessage`. Gap #3 de `RELATORIO_AB_GANHOS.md` ("rate tracker + cost footer", 3 h) não implementado.

**Memória.** Dois sistemas paralelos (`COMO_ARMAZENA_CONHECIMENTO.md`, `ARQUITETURA_SECOND_BRAIN.md`):
- SQLite (`src/db.ts`, `src/memory.ts`): toda mensagem >20 chars sem `/` vai para `memories` (WAL + FTS5), classificada `semantic`/`episodic` por regex `SEMANTIC_SIGNALS` **só em inglês**. Salience decai 2%/dia (`decayMemories`), +0.1 ao acessar, apaga <0.1. `buildMemoryContext` injeta top-3 FTS5 + top-5 recentes em todo prompt.
- Vault `.md` (`vault-template/`): `/brain`, gatilho natural ("guarda isso"), ou arquivo com legenda. `/daily` e `/tldr` delegam ao Claude.
- `/file-intel`: Gemini → Claude CLI → Ollama (`scripts/process_files_with_gemini.py`).
- `TODO_MEMORIA.md` (parado desde 2026-05-01): #1 regex PT-BR, #2 SQLite↔vault, #3 embeddings, #4 auto-injeção de insights, #5 dedupe semântica.

**Filas/agendamento.** `src/scheduler.ts`: `setInterval` 60 s, `getDueTasks` do SQLite, `runAgent` sem sessão, `cron-parser`. Sem fila/worker. "Mission Control" e "Signal bridge" do upstream não portados (12 h e 8 h).

**Observabilidade.** pino (`src/logger.ts`), JSON em produção, TZ São Paulo. systemd `--user` sem `Restart=on-failure`. Dashboard com `/api/health`. Sem métricas exportadas. Gaps: exfiltration guard (#2, severidade alta), OAuth health (#4).

**Skills/agents.** 15 skills em `skills/` (agnes-video, analisevideo, daily, file-intel, gmail, google-calendar, inemavox, kling, mkivideos, musica, skool-classroom, skool-transcribe, slack, tldr, vault-setup), carregadas por `src/skills.ts` (front-matter YAML → lista compacta no prompt do router). Agentes em `agents/` (comms, content, ops, research, `_template`) com `CLAUDE.md` + `agent.yaml`.

**Tamanho.** ~12.158 linhas TS, 30 módulos flat. Deps: grammy, `@anthropic-ai/claude-agent-sdk` ^0.2.34, `@google/genai`, whatsapp-web.js, `@slack/web-api`, better-sqlite3, hono, cron-parser, pino. Node ≥20, vitest.

**Env (só nomes).** AGENT_AUTO_APPROVE, AGENT_MAX_TOOL_STEPS, AGNES_*, ALLOWED_CHAT_ID, ANTHROPIC_API_KEY, CLAUDE_LOCAL_BASE_URL, DASHBOARD_TOKEN, ELEVENLABS_*, FIRECRAWL_API_KEY, GCAL/GMAIL/GOOGLE_*, GRADIUM_*, GROQ_API_KEY, HEYGEN_*, LOCAL_AGENT_MODEL, OLLAMA_MODEL, OLLAMA_ROUTER_MODEL, OLLAMA_URL, OPENROUTER_{AGENT_MODEL,API_KEY,MODEL,VIDEO_MODEL,VISION_MODEL}, SKOOL_COOKIE, SLACK_USER_TOKEN, TELEGRAM_BOT_TOKEN, VAULT_PATH.

---

## 2. inemaccbot (`~/projetos/inemaccbot`, v0.19.11) — a fila

**Persistência** (`src/fila/store.ts`): SQLite via better-sqlite3, tabela `jobs` nunca purgada. Claim atômico `UPDATE ... WHERE id = (SELECT ...) RETURNING *` (`pegar()`). Lease com `lease_ate`/`lease_owner` + heartbeat (`renovar()`); `recuperarLeasesVencidos()` recupera jobs de worker morto respeitando `max_tentativas`. Prioridade `ORDER BY prioridade DESC, id ASC`, ajustável em runtime (`priorizar()`). Backoff exponencial em `falhar()` (`backoffBase * 2^(tentativas-1)`). Idempotência via `idem_key` (`enfileirarSeNovo`, `jaConcluido`). Cancelamento sem corrida. `reagendar` para polling sem gastar tentativa.

**Worker** (`src/fila/worker.ts`): stepper puro; loop e `SIGTERM → drenar()` ficam em `src/index.ts`. `concorrencia` configurável, drain gracioso, `AbortController`, guarda stdout bruto de agente que quebra contrato.

**Telegram** (`src/gateway/comandos.ts`): `/status` e `/status <ref>` com ícones ▶️⏳✅❌🚫 e tempos. `pendentesDeNotificacao()`/`marcarNotificado()` garantem reenvio se o Telegram falhar.

**LLM.** Sem API HTTP: invoca CLIs como subprocesso (`runner-claude.ts` com `--model --effort -p`, `runner-codex.ts`, `runner-opencode.ts`, `runner-chrome.ts`). Custo controlado por perfil por job (`motor`/`modelo`/`esforco`), defaults em `config.ts` (`claude`/`sonnet`/`low`).

**Observabilidade.** Log via callback injetado; health é o `/status`. Sem Ollama em nenhum dos três repos (inemaccbot, inemaccvbot, inemacbot).

**Reuso.** `fila/{store,worker,types}.ts` + `*.test.ts` são plugáveis (injeção de dependência: ganchos transacionais, `promptDe`, `aoTerminar`). `inemaccvbot/src/queue-client.ts` é cliente simples de `mkivideos`; `inemacbot` é só doc.

---

## 3. claudeclaw / claudeclaw-os (`~/projetos/claudeclaw*`)

Assistente TS via Telegram, Claude Code como motor, serviço launchd. `claudeclaw-os` adiciona `web/` (dashboard React 3D) e `warroom/` (Python, personas e vozes, `agent_bridge.py`).

- **Memória** (`src/memory.ts`, `src/memory-consolidate.ts`): retrieval em 3 camadas (FTS5, recentes de alta importância, insights). Consolidação periódica via Gemini que funde memórias, acha conexões e **detecta contradições** por timestamp, marcando a antiga como superseded.
- **Orquestração** (`src/orchestrator.ts`): registry de `agents/*/agent.yaml`, delegação com timeout 5 min, `logToHiveMind` compartilhado entre agentes.
- **Fila/cron** (`src/message-queue.ts`, `src/scheduler.ts`): cron-parser, timeout 10 min, lock anti-duplicação (`markTaskRunning`), `claimNextMissionTask`.
- **Tokens**: `totalCostUsd` por resposta, override de modelo por task (haiku vs sonnet).
- **Dashboard** (`src/dashboard.ts`, Hono + SSE): memória (pinned, low-salience, top-accessed, timeline), consolidações, custo por agente, hive mind, sessões. O mais completo dos repos locais.
- **Privacidade**: `store/` fora do git, `runDecaySweep()` purga em 3 dias.

---

## 4. openclaw (`~/projetos/openclaw`) + openclaw-ollama-local

Gateway multicanal TS, o mais maduro. CLI (`src/cli`), gateway (`docs/gateway/`), canais em `src/{telegram,discord,slack,signal,imessage,web}`, plugins em `extensions/` (msteams, matrix, zalo, line, voice-call). Roteamento em `src/routing`.

- **Modelos**: LM Studio, vLLM, LiteLLM, endpoints OpenAI-compat (`docs/gateway/local-models.md`); alias por config, custo por modelo (`cost.input/output/cacheRead/cacheWrite`); `docker-compose.ollama.yml`.
- **Memória**: `extensions/memory-core`, `extensions/memory-lancedb` (vetorial, plugável).
- **Fila** (`docs/concepts/queue.md`): FIFO por lane (sessão + `main`), modos `steer/followup/collect/steer-backlog/interrupt`.
- **Cron** (`docs/automation/cron-jobs.md`, `cron-vs-heartbeat.md`): persistente em `~/.openclaw/cron/`, sessão principal ou isolada, "wake now vs next heartbeat".
- **Tokens** (`docs/token-use.md`): prompt em camadas, skills só metadata, `bootstrapMaxChars`, pruning por TTL de cache, `/status`, `/usage off|tokens|full|cost`.
- **Observabilidade**: dashboard web, `openclaw doctor`, logging estruturado, `extensions/diagnostics-otel`.
- `openclaw-ollama-local` é só kit docker-compose + `docker-ollama-setup.sh`.

---

## 5. nanobot (`~/projetos/nanobot`)

Fork PT-BR de assistente Python (~6.600 linhas). `agent/` (loop, contexto, memória, skills, tools, `subagent.py`), `channels/` (Telegram, WhatsApp via Baileys, Discord, Feishu, DingTalk), `providers/registry.py` (12+ via LiteLLM), `cron/`, `heartbeat/` (30 min), `bus/` (event bus assíncrono canal↔agente), `session/` (JSONL por chat). Memória em `workspace/memory/MEMORY.md`. Persona em `SOUL.md`, `AGENTS.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`. Skills Markdown + YAML. Fraco em observabilidade e testes.

---

## 6. Hermes (upstream `github.com/NousResearch/hermes-agent`)

Repos locais `hermesagent`, `agentehermes`, `agente-hermes-local`, `hermes21c`, `claude-hermes-os` são **cursos HTML** INEMA, não código. Confirmado no README upstream (2026-09-01):
- Loop de aprendizado fechado: memória curada com nudges periódicos, cria skills após tarefas complexas, skills se auto-melhoram.
- Gateway único para Telegram, Discord, Slack, WhatsApp, Signal, Email, CLI.
- Cron com entrega em qualquer canal.
- Subagentes isolados em paralelo; scripts Python chamando tools via RPC.
- `/compress`, `/usage`, `/insights [--days N]`.
- Persistência: `~/.hermes/memory.db` (SQLite), `skills/`, `profiles/`, `config.yaml`, `snapshots/`; `MEMORY.md` + `USER.md`.
- Dos cursos: heartbeat com zombie detection (`hermes21c/curso/trilha3/modulo-3-4.html`); ~73 % do request é overhead fixo (`modulo-3-5.html`); backup `VACUUM INTO` + age + rclone (`hermesagent/curso/trilha4/modulo-4-2.html`); modos Vault/Connected/Cloud (`agente-hermes-local/README.md`).

---

## 7. grokky (`~/projetos/grokky`) e jarvis (`~/projetos/jarvis`)

**grokky**: app Electron, cockpit local-first para Codex SDK e OpenRouter. Sem Ollama, sem canais. Ideias: "crews" com especialistas read-only em `Promise.all` + lead único com escrita (README 376–398); gate Read/Workspace/Full por conversa (linhas 92, 202); timeline de eventos normalizados via IPC tipado.

**jarvis**: curso estático INEMA (6 trilhas, 21 módulos). Vocabulário de 6 camadas (canais, identidade, ferramentas, skills, agentes, cérebros) e framework Context·Connections·Capabilities·Cadence (`curso/trilha4/`). Sem código.

---

## 8. Estado da máquina relevante (spark-922b)

- Ollama: 16 modelos em disco. `qwen3.6:35b-a3b` 23 GB, `qwen3:30b` 18 GB, `qwen3.8:27b` 17 GB, `qwen3.8-64k` 17 GB, `qwen-agentic` 37 GB, `llama3.1:70b` + `-16k` + `-32k` 42 GB cada (blobs dedupados), `command-r:35b` e `-32k` 18 GB, `deepseek-r1:14b` 9 GB, `qwen2.5:14b` 9 GB, `llama3.1:8b` 4.9 GB, `llama3` 4.7 GB, `llama3.2` 2 GB, `bge-m3` 1.2 GB.
- Serviço systemd com override `OLLAMA_CONTEXT_LENGTH=32768` + `OLLAMA_KV_CACHE_TYPE=q8_0` (`wifi/ollama-override.conf`, `wifi/OLLAMA-TUNING.md`: cold start 124 s → 9 s).
- `wifi/ollama-keeponly-qwen36.sh` descarrega tudo e fixa qwen3.6 com `keep_alive: -1`.
- Dois travamentos por OOM em 2026-08 (`wifi/FALHAS.md`); watchdog em `wifi/host-mem-watchdog.sh`.
