# openpcbot v3

**🇧🇷 [Português](README.md) · 🇺🇸 [English](README.en.md) · 🇪🇸 [Español](README.es.md)**

Multichannel personal assistant (Telegram, CLI, HTTP) with a durable SQLite queue, Ollama manager with RAM preflight, per-call costs with a budget, a brain with PT-BR memory and nightly consolidation. Successor to `openpcbotv2`, running **alongside** it (strangler pattern, not a cutover).

Plan and architecture: [PLANO-MIGRACAO-V3.md](PLANO-MIGRACAO-V3.md). Status by phase: [CHANGELOG.md](CHANGELOG.md). Failures: [FALHAS.md](FALHAS.md).

Telegram bot: **@inemav3bot** (v2 continues at @inemaclaudebot).

**Connect email, calendars, and Telegram to the brain:** [docs/CONECTORES.md](docs/CONECTORES.md).

## Jev for observing routing

`/jev observar` enables comparison of the route, agent, and skill via OpenRouter in this chat; `/jev` shows the result and `/jev off` turns it off. Since 3.4.4, each comparison is saved: `/jev historico` lists them and `/jev relatorio dia|semana` summarizes them (sent automatically on Telegram at 8:05 a.m. and Mondays at 8:10 a.m.). The current router continues to make decisions. Costs go through the gateway and appear in `/usage`. [Configuration, limits, and live test](docs/JEV.md).

Jev commands are also in the bot's help: send `/help` or `/ajuda` to see the list and `/ajuda jev` to read the detailed explanation. Observation sends the current message and classification criteria to the provider, without memory or history; suggestions do not change routes or run skills.

## 📖 User Guide

Full guide (landing page + walkthrough): **https://inematds.github.io/openpcbotv3/guia/en/**

---

## 1. Start

```bash
npm install
cp .env.exemplo .env          # TELEGRAM_BOT_TOKEN_V3 = its OWN bot, from BotFather
npm run doctor                # checks env, Ollama, RAM, CLIs, v2, unit
npx tsx src/cli/importar.ts   # (once) imports memories from v2 via snapshot
bash scripts/instalar-servico.sh   # systemd --user unit, MemoryMax=2G, Restart=on-failure
```

Without a Telegram token, the service still starts with HTTP (`127.0.0.1:3142`) and CLI. The v2 token is **rejected** (two `getUpdates` calls = 409 and an unresponsive bot).

## 2. Operate

| What | How |
|---|---|
| Health (the `wifi` hub consumes this) | `GET http://127.0.0.1:3142/health` |
| Dashboard | `http://127.0.0.1:3142/` |
| Talk to the bot without Telegram | `npm run cli -- "mensagem"` or `POST /mensagem {"texto":"..."}` |
| Logs | `journalctl --user -u openpcbotv3 -f -o cat` |
| Restart after changing `src/` or `.env` | `bash scripts/instalar-servico.sh` |
| Diagnostics | `npm run doctor` (config) · `npm run doctor -- --deep` (live probes: sends a Telegram message and runs a job) |
| Stop everything now | `/parar tudo <motivo>` in the chat; `/retomar` resumes |
| Tests | `npm test` (202) |

---

## 3. How it works (the path of a message)

```
Telegram / CLI / HTTP
   │  adapter translates to the BUS ("mensagem.recebida")
   ▼
ORCHESTRATOR
   ├─ starts with "/"?  → command (section 4), responds immediately
   ├─ 2 s collect window: consecutive messages become one
   ├─ ROUTER: llama3.2 (local, free) returns JSON {rota, agente, tier, motivo}
   │     "direto"  → conversation, short question, summary, translation
   │     "agente"  → needs a tool: file, shell, repo, web, skill, calendar
   ├─ BRAIN builds the memory context (up to 600 tokens, section 6)
   │
   ├─ direct → LLM GATEWAY (local tier = resident qwen3.8:27b) → response
   │           records turn + memory; if it's a durable fact, proposes an entry in the vault
   │
   └─ agent → job in the QUEUE (`agente` lane, 1 at a time)
               worker runs `claude -p --output-format json` with a layered prompt
               (identity + agent + memory + skills + message)
               result returns through the bus to the originating chat; actual cost is recorded
   ▼
EXFILTRATION GUARD: all outgoing text is scanned (tokens, keys, JWT, .env values) → [REDACTED]
```

Parallel specialists (grokky pattern): when the router indicates `consultar`, up to 2 **read-only** agents (e.g., `research`) run first and the `lead` receives their outputs in the prompt. Only the lead writes.

---

## 4. Chat Commands

| Command | Does |
|---|---|
| `/status [id]` | queue by lane (running/pending) or details of a job with result/error |
| `/cancelar <id>` · `/prioridade <id> <n>` | operates the queue |
| `/usage` | cost today/week/month, by tier and agent, budget |
| `/health` | Ollama (loaded models, latency), RAM/swap, process RSS, queue, heartbeat, channels |
| `/ollama status\|preflight <m>\|descarregar <m>` | Ollama manager (unload refuses models that aren't from v3) |
| `/memoria lista\|buscar <t>\|salvar <t>\|esquecer <id>\|propostas\|aprovar <id>\|descartar <id>` | brain and vault |
| `/tarefa add [quando] <texto>` · `/tarefa lista` · `/tarefa feita <id>` | your tasks; `quando` = `em 2h`, `amanhã 9h`, `sex 10h`, `15/09 14:30` |
| `/daily` | summary: tasks, completed in the last 24 h, daily cost, queue, Ollama, MEMORY.md |
| `/cron lista\|on <nome>\|off <nome>` | scheduled tasks |
| `/fontes` · `/fontes ingerir [gmail|agenda]` | observed chats and what has become memory ([docs/CONECTORES.md](docs/CONECTORES.md)) |
| `/agentes` · `/skills` | what's installed |
| `/novo` | clears CLI session and chat history · `/compress` only the session |
| `/consolidar` | runs memory consolidation now |
| `/parar [tudo\|agentes\|<agente>] [motivo]` · `/retomar [alvo]` | persistent switches; `/parar` by itself lists them |
| `/fila [collect\|followup\|steer\|interrupt]` | how to handle a message that arrives while another is in progress (per chat) |
| `/personality [nome\|off]` | persona for this chat (`personalidades/*.md`), added to `IDENTIDADE.md` |
| `/context [detail] [texto]` | tokens by prompt layer, direct and agent |
| `/jev [observar\|off]` | enables/disables comparison in this chat; with no argument, shows the status and last suggestion with cost |
| `/jev historico [n]` | last n comparisons (default 10, max 50) with cumulative agreement |
| `/jev relatorio dia\|semana` | summary of the last 24 h or 7 days: agreement, confidence, divergences, cost |
| `/ajuda jev` | explains Jev observation, data sent, and its limits |
| `/chatid` · `/versao` · `/ajuda` · `/help` | chat ID, version, and command list |

---

## 5. Queue (`src/fila/`, ported from inemaccbot)

SQLite with atomic claim (`UPDATE ... RETURNING`), lease with heartbeat every 30 s, exponential backoff, idempotency via `idem_key`, race-free cancellation, graceful drain on `SIGTERM` (renews lease while waiting, aborts after 110 s). Jobs are never deleted: they are the history.

Lanes and concurrency (`src/fila/filas.ts`):

| lane | conc. | use |
|---|---|---|
| `chat` | 2 | direct response that arrived while another is in progress |
| `agente` | 1 | `claude -p` (each uses ~500 MB of RAM) |
| `ollama` | 1 | consolidation, embeddings |
| `cron` | 1 | scheduled tasks |
| `io` | 4 | network/file, specialist coordination |

Every job with a `chat_id` notifies the chat when it finishes (success or failure). If sending fails, a scan every 20 s retries delivery.

---

## 6. Brain (`src/cerebro/`)

**Memories** (the `memories` table, same as in v2): each of your messages over 20 characters becomes a memory, classified by PT-BR + English regex as `semantic` (durable: "my," "I prefer," "always," "never," "remember," "I live in," "my name"...) or `episodic`. Questions never become facts. Deduplication by normalized sentence hash.

**Salience**: starts at 1.0, +0.1 per use; decays per day without use (semantic 0.5%, episodic 2%); below 0.05 and with no access for 30 days, it is deleted.

**Search**: FTS5 (keyword) + `bge-m3` vector (BLOB of 1024 floats, cosine in JS). Vectors are indexed by the `indexar-memoria` cron every 15 min.

**Prompt context** (3 layers, 600-token limit): 3 by keyword, 3 by vector, 3 most important, 3 most recent, no duplicates, plus 3 insights.

**Nightly consolidation** (4 a.m. cron, in Ollama, zero cost): merges duplicates (keeps the most recent), detects contradictions by date (the older one gets `superseded_by`, never deleted), and generates up to 3 insights per chat.

**Curated vault** (`~/vault/MEMORY.md` and `USER.md`): the bot proposes; you approve (`/memoria aprovar <id>`). Nothing is written without approval. `USER.md` is included in every conversation prompt.

**v2 import**: `VACUUM INTO` creates a consistent snapshot of the v2 database (which remains in use) and inserts it with `origem='v2'`. Idempotent.

**Skills learning loop**: drafts go to `skills/_rascunhos/`; they are never promoted automatically.

---

## 7. Ollama Manager (`src/ollama/`)

HTTP only with the systemd service (never `ollama serve`). `config/ollama.yaml`:

| role | model | why |
|---|---|---|
| `roteador` | `llama3.2` | JSON classification, 2 s, 4 GB |
| `geral` | `qwen3.8:27b`, resident | **same tag as v2**: one model serves both bots |
| `embed` | `bge-m3` | memory vectors, 0.7 GB |
| `pesado` | `llama3.1:70b`, **disabled** | 42 GB; only after cutover |

**Preflight** before any local call: an already resident model passes; a small one needs its size + 4 GB free; a large nonresident one needs `PISO_RAM_GB` (40) and **no other large model loaded**. If it fails, falls back to the cheap tier and alerts. v3 **never unloads** a model it did not load (it may belong to v2).

**Probe** every 60 s: `/api/ps`, latency of an "ok" from the router, RAM. Alerts if Ollama is down, latency > 5 s, RAM < 10 GB, two large resident models.

---

## 8. Cost (`src/custo/`)

`gateway.ts` is the **only** point through which an LLM call passes (including embeddings). Order: budget → choose provider by tier → RAM preflight (if local) → call → measure latency → calculate cost → record in `chamadas_llm`.

| tier | provider | model | when |
|---|---|---|---|
| `local` | Ollama | qwen3.8:27b | default; cost 0 |
| `barato` | OpenRouter | claude-haiku-4.5 | long reasoning for a direct response, or Ollama without enough RAM |
| `premium` | `claude -p` (CLI) | sonnet/opus per agent | agent route; actual cost comes from the CLI itself |

Budget (`config/orcamento.yaml`, `ORCAMENTO_MENSAL_USD`): warning at 70%, **blocks at 100%** (only Ollama passes). Moving up a tier records the reason.

---

## 9. Tasks, cron, and heartbeat (`src/tarefas/`)

- **Cron** becomes a job in the queue with `idem_key = name@occurrence` (never fires twice). `isolada` (clean context) or `principal` session. Defaults: `lembretes` (1 min), `indexar-memoria` (15 min), `decaimento` (3h30), `consolidacao-noturna` (4h), `backup-noturno` (4h15), `daily-8h`.
- **Heartbeat** every 30 min: recovers expired leases, cancels zombies (running > 2× the 20 min timeout), alerts on 3 failures of the same task in 1 h.
- **Your tasks** (`tarefas_usuario`): reminders by date, summary in `/daily`.

---

## 9b. Conversation control (phase 9: switches, queue modes, persona, context)

Everything in this section is stored in the `prefs` table (KV per chat; `'*'` is global) and survives restarts.

### Switches (`/parar`, `/retomar`)

| Target | What it blocks | What continues |
|---|---|---|
| `tudo` | any response (Telegram, CLI, HTTP, cron→responder) and any agent | slash commands; maintenance in the `ollama` lane (consolidation, ingestion, indexing, backup) |
| `agentes` | dispatch of `claude -p` (lead and specialists) | direct response via Ollama |
| `agente:<id>` | only that agent (`/parar ops quebrou`) | everything else |

- `/parar` by itself lists what's enabled, with the reason. `/retomar` with no target turns everything back on.
- Enabling cancels in-flight work in the `chat`, `agente`, and `io` lanes that matches the target. A running `claude -p` process dies on the worker's next check (up to 30 s).
- A job queued **before** `/parar` fails when picked up, with the reason, without spending tokens.

### Queue modes (`/fila`)

What to do with a message that arrives while another is in progress. Per chat; default is `collect`.

| Mode | Behavior | Difference from openclaw |
|---|---|---|
| `collect` | combines consecutive messages for 2 s and responds once | same |
| `followup` | no window; if busy, queues the message and responds later | same |
| `steer` | if busy, **replaces** what was in this chat's queue with the new message, high priority | openclaw injects it into the running agent; with `claude -p` in a subprocess this isn't possible, so the message only enters after the current agent finishes |
| `interrupt` | cancels this chat's queue and agents (by `flow_ref = canal:chat`) and responds to the new message now | a direct response already in flight in Ollama cannot be aborted: it finishes and is discarded (generation counter per chat) |

### Persona (`/personality`, `SOUL.md`)

Three layers, always combined, in this order in the prompt:

1. `IDENTIDADE.md` (root): the foundation, never removed.
2. `agents/<id>/SOUL.md`: fixed persona for that agent (optional; restart required for the registry to reread it).
3. `personalidades/<nome>.md`: selected per chat with `/personality <nome>`; `/personality off` returns to the default. Applies to direct responses and agents.

Changing the personality clears the chat's `--resume` sessions; otherwise, the agent would continue with the old voice for up to 6 h. Examples included: `curto`, `professor`. To create one, add a new `.md` file to the folder.

### `/context [detail] [texto]`

Measures how much of the prompt each layer uses, without calling a chat model (identity, persona, `USER.md`, memory and insights, history, skills, rules, message), for both direct responses and agents. `detail` lists memory and history items. Without `texto`, uses your last message in the chat as the query. Retrieval runs in read-only mode: `/context` does not increase salience.

### `doctor --deep`

`npm run doctor -- --deep` adds four probes that **exercise** the system, marked as probes: the service's `GET /health`; `sendMessage` to `ALLOWED_CHAT_ID` on Telegram (never `getUpdates`); a call to the `roteador` model through the cost gateway in an in-memory database (not added to `chamadas_llm`); and a `doctor-probe` job in the `io` lane that the service worker must pick up and complete in 30 s (fails with "old service" if the running binary doesn't have the task: reinstall).

### MCP per agent (`mcp_config`)

In `agents/<id>/agent.yaml`, `mcp_config: mcp.json` (path relative to the folder) makes `claude -p` start with `--mcp-config <arquivo> --strict-mcp-config`: the agent sees **only** those servers. Without the key, it inherits MCPs from `~/.claude` as usual. Template in `agents/_template/mcp.json.example`. A native MCP client in the Ollama path is noted as phase 10 in [docs/INCORPORAR-V3.md](docs/INCORPORAR-V3.md), with no start date.

---

## 10. Channels (`src/canais/`)

- **Telegram** (grammy): only `ALLOWED_CHAT_ID`; simple Markdown becomes HTML; long messages are split; 409 becomes a log, not a loop.
- **CLI**: stdin/stdout when there's a TTY or `--cli`.
- **HTTP**: `127.0.0.1` by default (`POST /mensagem` dispatches an agent with permissions). Expose on the LAN only with `HTTP_BIND_V3=0.0.0.0` **and** `DASHBOARD_TOKEN_V3`.
- **Slack**: Web API via fetch, OAuth probe in doctor; disabled until cutover (token belongs to v2).
- **WhatsApp**: stub that refuses while v2 is active (one session per number; whatsapp-web.js starts a Chromium instance). Actual implementation in phase 8, in a separate daemon.

---

## 11. Telemetry and alerts

Pino JSON logs in the journal. `GET /health` returns `ok` (Ollama online, RAM ≥ 10 GB, heartbeat < 90 min) plus queue, models, RAM, budget. Alerts with 30 min deduplication per key, delivered to the allowed Telegram chat: Ollama down, low RAM, dead lease, zombie, 3 failures, budget 70%/100%.

Dashboard (`/`): health, Ollama/RAM, queue by lane, cost for 14 days (sparkline) and by tier/agent, memory, recent jobs. Updates every 10 s.

Nightly backup: `VACUUM INTO` + `age` (if `AGE_RECIPIENT`) or gzip, retention 14, in `store/backups/`.

---

## 12. Memory guarantees while coexisting with v2

- **Same tags as v2**: one resident model for both bots. Changing the `geral` tag without changing it in v2 = two large models = OOM.
- **RAM preflight** and one large resident model policy; never unloads another bot's model; 70b disabled.
- **Unit with `MemoryHigh=1.5G` / `MemoryMax=2G`** (delegated cgroup v2, verified) and `--max-old-space-size=1024`. Observed peak: ~1 GB with one `claude -p`.
- `agente` lane with concurrency 1. WhatsApp/Slack disabled.
- The general model's `keep_alive: -1` holds 17 GB in RAM (the machine went from 57 GB to 35 GB free). This is the plan's design; to release it, change it to `10m` in `config/ollama.yaml`.

---

## 13. Configuration

The v3 `.env` (specific settings only; shared keys are loaded at runtime from the v2 `.env`):

| variable | default | |
|---|---|---|
| `TELEGRAM_BOT_TOKEN_V3` | | its own token; the v2 token is rejected |
| `PORT_V3` | 3142 | |
| `HTTP_BIND_V3` | 127.0.0.1 | |
| `DASHBOARD_TOKEN_V3` | | protects `/` and `/api/*` |
| `PISO_RAM_GB` | 40 | GB free to load a large model |
| `ORCAMENTO_MENSAL_USD` | 50 | |
| `SLACK_ENABLED` / `WHATSAPP_ENABLED` | 0 | |
| `AGE_RECIPIENT` | | encrypted backup |
| (`prefs` table) | | switches, queue mode, and personality per chat; `/parar`, `/fila`, `/personality` write here |
| `CLAUDE_BIN` / `CODEX_BIN` | claude / codex | |

YAML in `config/`: `ollama.yaml` (roles, threshold, probe), `precos.yaml` (USD/1M tokens, tiers), `orcamento.yaml`.

---

## 14. Layout

```
src/
  bus/           typed event bus
  canais/        telegram · cli · http(+dashboard) · slack · whatsapp(stub) · exfiltration guard
  fila/          store/worker/runner ported from inemaccbot (lanes: chat, agente, ollama, cron, io)
  orquestrador/  orchestrator · router · commands · agent-cli · skills · agents · queue-tasks
  ollama/        manager (registry, preflight, probe) · HTTP client · RAM
  custo/         gateway (only LLM entry point) · records · budget · prices
  provedores/    ollama · openrouter · anthropic
  cerebro/       memory (FTS5+vector) · context (3 layers) · consolidation · vault · import-v2
  tarefas/       cron · heartbeat · user · default
  telemetria/    pino logger · deduplicated alerts
  dashboard/     html
  cli/           doctor · import · chat
  db/            open · migrations (with checksum) · backup
config/          ollama.yaml · precos.yaml · orcamento.yaml
systemd/         openpcbotv3.service
skills/, agents/ copied from v2 as is (skills/_rascunhos = learning loop)
IDENTIDADE.md    bot persona and limits (included in every prompt)
```

Rules: no module over 500 lines; all LLM calls go through `custo/gateway.ts`; Ollama only via HTTP; every real failure gets a line in `FALHAS.md`.

## 15. What's still missing

- **Phase 8 (cutover)**: replace the production token, v2 read-only for 30 days, archive. Only by explicit instruction.
- **Phase 10 (noted)**: native MCP client in the Ollama path, inemavox MCP server, voice on Telegram ([docs/VOZ-TELEGRAM.md](docs/VOZ-TELEGRAM.md) — currently only v2 has it), `/retry` `/undo`, usage footer, skill health ([docs/INCORPORAR-V3.md](docs/INCORPORAR-V3.md)).
- Real WhatsApp (separate daemon), Slack enabled.
- `steer` does not inject into a running agent (see 9b).
- Retention for the `jobs` table (currently never purged; ~1.5 k rows/day with the reminders cron).
- Memory stores the entire sentence, not an extracted fact.
