# O que incorporar no v3 — Hermes, OpenClaw e repos locais (2026-09-14)

Cruzamento entre o que o v3 já entrega (fases 0–7, `CHANGELOG.md`) e o que Hermes Agent
(Nous Research), OpenClaw (v2026.8.1), nanobot e os repos em `~/projetos` oferecem.
Atualiza a tabela §2 do `PLANO-MIGRACAO-V3.md` (2026-09-01). Fontes no fim.

## 0. O que o v3 já cobre (não repetir)

Fila SQLite com lanes · gestor do Ollama com preflight · gateway único de custo, `/usage`,
orçamento · roteador local + especialistas read-only em paralelo + lead · cérebro FTS5 +
bge-m3 + consolidação noturna + propostas para `MEMORY.md`/`USER.md` · rascunhos de skill ·
cron (sessão principal/isolada) · heartbeat 30 min · `/tarefa`, `/daily` · conectores Gmail,
Agenda e Telegram observado · dashboard · `doctor` · backup cifrado · `/compress`, `/novo`.

## 1. Lacunas, por prioridade

Legenda de esforço: **P** (≤1 dia) · **M** (2–3 dias) · **G** (semana+).

### A — alto valor, esforço pequeno/médio (candidatos à fase 9)

| # | Lacuna | De onde vem | Como encaixa no v3 | Esf. |
|---|---|---|---|---|
| A1 | **Voz no Telegram**: áudio recebido → texto; resposta em áudio opcional | OpenClaw `src/telegram/voice.ts`, `src/tts/`; claudeclaw-os `src/voice.ts`, `agent-voice-bridge.ts` | STT pelo **inemavox** (`transcrever_v1.py`, Parakeet/Whisper) ou **Groq** quando a GPU estiver ocupada; TTS chatterbox/`rachel`. Job na lane `io`. Regra global já define isso. | M |
| A2 | **Modos de fila** `steer` / `followup` / `interrupt` (v3 só tem `collect`) | OpenClaw `docs/concepts/queue.md`; claudeclaw-os `src/message-queue.ts` | `/fila <modo>` por chat; `interrupt` cancela o job ativo da lane `chat:<id>` e roda o mais novo. Fila já tem cancelamento sem corrida. | P |
| A3 | **`/context list\|detail`**: quanto do prompt é skill, memória, histórico, sistema | OpenClaw `docs/reference/token-use.md` | `cerebro/contexto.ts` já monta as camadas com teto de tokens; falta só expor a contagem. Base pra cortar overhead fixo (Hermes: ~73 % do request). | P |
| A4 | **Rodapé de uso por resposta** (`/usage off\|tokens\|full\|cost`) | OpenClaw; claudeclaw-os `src/cost-footer.ts` | `chamadas_llm` já registra tudo; é formatação no adaptador Telegram. | P |
| A5 | **`/retry` e `/undo`** | Hermes (tabela de comandos) | Reenfileirar o último job com a mesma `idem_key` + sufixo; `undo` esconde a última resposta e memórias derivadas (`superseded`). | P |
| A6 | **`SOUL.md` + `/personality`** | Hermes | Hoje só `MEMORY.md`/`USER.md`. Um `SOUL.md` por agente em `agents/*/` entra na camada de identidade do prompt. | P |
| A7 | **Kill switches + guarda antiexfiltração** | claudeclaw-os `src/kill-switches.ts`, `src/exfiltration-guard.ts` | Planejado na fase 6 e não entregue. `/parar tudo`, `/parar agente <x>`; guarda checa URLs/anexos de saída contra lista de domínios. | M |
| A8 | **`doctor --deep`** com probe sintético | OpenClaw `docs/gateway/doctor.md`, `src/commands/doctor*.ts` (18 checadores) | `cli/doctor.ts` tem 88 linhas; adicionar: manda mensagem de teste no Telegram, roda 1 job na fila, 1 chamada Ollama, mede tudo. | P |
| A9 | **Saúde de skills** (registry + health) | claudeclaw-os `src/skill-registry.ts`, `src/skill-health.ts` | `/skills` hoje só lista. Checar dependências (binários, keys em `.env`) e marcar quebradas. | P |

### B — valor claro, esforço médio (fase 10)

| # | Lacuna | De onde vem | Como encaixa | Esf. |
|---|---|---|---|---|
| B1 | **Fechar o loop de skills** (criar após tarefa complexa, auto-melhorar) | Hermes | v3 já gera rascunhos em `skills/_rascunhos/`. Falta: `/skill aprovar <nome>`, avaliação de uso (quantas vezes ajudou) e reescrita periódica. Depende da decisão 6 do plano. | M |
| B2 | **Cliente MCP** (usar servidores MCP como ferramentas) | Hermes, nanobot | Só faz sentido no motor SDK; o runner `claude -p` já herda os MCP do `~/.claude`. Decisão 1 do plano. | M |
| B3 | **`execute_code`** (tool calling programático: um script encadeia N tools) | Hermes | Pra Ollama local: reduz turnos e tokens. Sandbox mínimo (`node --experimental-permission` ou container). | M |
| B4 | **Failover de modelo** com política declarada | OpenClaw `docs/concepts/model-failover.md`; nanobot `providers/` | `custo/gateway.ts` já tem tiers; falta cadeia de fallback por erro/timeout e rate-limit (`rate-tracker.ts` do claudeclaw-os). | P |
| B5 | **Chat temporário** (fora do histórico e da memória) | nanobot | `/temp on\|off` por chat: pula ingestão e consolidação. | P |
| B6 | **`/insights --days N`** | Hermes | Relatório sobre `chamadas_llm` + memórias: temas, custo por tema, skills mais usadas. Roda no Ollama. | P |
| B7 | **Fluxos com fases e portões** + runners `opencode`/`chrome` | inemaccbot `src/fluxos/*`, `src/fila/runner-{opencode,chrome}.ts` | Fila é a mesma (portada de lá). Runners entram por cópia; fluxos servem pra pipelines de vídeo/curso com aprovação no meio. | M |
| B8 | **Cérebro por conversa** (Codex OAuth / Claude OAuth / OpenRouter) | jarvisv7 `apps/server/providers/brains.ts` | `/modelo <nome>` por chat, respeitando o gateway de custo. | P |
| B9 | **Política econômica texto vs voz vs humano** | agentevoz `src/agentevoz/policy/` | Contrato pra decidir quando responder em áudio, quando escalar pro usuário. Complementa A1. | M |
| B10 | **Compactação visível** (progresso do `/compress` no chat) | nanobot (2026-09-05) | Mensagem editada com progresso; barato. | P |

### C — grande ou de valor incerto para um assistente pessoal (só com ordem)

| # | Lacuna | De onde vem | Observação |
|---|---|---|---|
| C1 | **Bot Mode**: time de bots especialistas em grupo via @menção | Hermes (2026) | v3 já tem especialistas internos; expor cada um como bot do Telegram é outro produto. |
| C2 | **Nodes/devices**: câmera, voice wake, Talk mode, apps companion | OpenClaw `src/node-host/`, `docs/nodes/` | Exige app no celular. |
| C3 | **Canvas host** (UI dinâmica servida ao usuário) | OpenClaw `src/canvas-host/` | Dashboard atual cobre o uso operacional. |
| C4 | **OTEL** (traces/metrics/logs) | OpenClaw `extensions/diagnostics-otel` | Sem coletor na máquina hoje; `chamadas_llm` + pino bastam. |
| C5 | **Sandbox Docker** para execução | OpenClaw, Hermes (7 backends) | Relevante se B3 crescer. |
| C6 | **ClawHub** (registro público de skills) | OpenClaw | Skills aqui são privadas; `~/.openclaw/skills` já tem 27 instaladas que podem ser copiadas à mão. |
| C7 | **API HTTP compatível com OpenAI** | OpenClaw, nanobot | Canal HTTP existe; formato OpenAI só se outro app for consumir. |
| C8 | **Modelagem de usuário Honcho** | Hermes | Substituído por `USER.md` + consolidação. |
| C9 | **Trajetórias em batch / export RL** | Hermes | Fora de escopo. |

## 2. Repos locais: veredito

| Repo | Tipo | Vale copiar |
|---|---|---|
| `openclaw` | código TS (3,1k arquivos) | cron/run-log, `auto-reply/heartbeat.ts`, `commands/doctor*`, `telegram/voice.ts`, `tts/` |
| `claudeclaw-os` | código TS | `kill-switches`, `exfiltration-guard`, `cost-footer`, `rate-tracker`, `skill-health`, `voice`, `oauth-health` |
| `inemaccbot` | código TS (origem da fila) | `runner-opencode`, `runner-chrome`, `fluxos/*`, `gateway/pareamento` |
| `nanobot` | código Python | referência de arquitetura (bus, temp chat, Dream memory); não copiar código |
| `jarvisv7` | código TS pequeno | `providers/brains.ts`, `secrets.ts`, `services/focus.ts` |
| `agentevoz` | código Python | contratos STT/TTS/Policy como desenho; reimplementar em TS |
| `claw-code` | código Python/Rust | `cost_tracker`, `command_graph`; pouco além do que o v3 já tem |
| `jarvis`, `gravityclaw`, `agentes-voz`, `hermes*` | curso/doc | só vocabulário e checklist; nada de código |
| `~/.openclaw` (instalação) | config | Ollama `qwen-agentic` como primário, OpenRouter com tabela de custo, 27 skills; zero cron, zero devices |

## 3. Proposta de sequência

- **Fase 9 — "Jarvis fala e obedece"**: A1, A2, A5, A6, A7 (≈5 dias).
- **Fase 10 — "Jarvis se explica"**: A3, A4, A8, A9, B4, B6, B10 (≈4 dias).
- **Fase 11 — "Jarvis aprende"**: B1, B5, B7, B8; B2/B3 dependem da decisão 1 do plano (≈6 dias).
- Fase 8 (corte) continua sem ordem, independente das acima.

## 4. Fontes

- Hermes: github.com/NousResearch/hermes-agent · hermes-agent.nousresearch.com/docs/ (não confirmado: Ollama nativo, hooks)
- OpenClaw: docs.openclaw.ai/concepts/queue · /gateway/doctor · /reference/token-use · /nodes · /clawhub · en.wikipedia.org/wiki/OpenClaw (não confirmado: pruning por TTL de cache, "prompt em camadas" como termo oficial)
- nanobot: github.com/HKUDS/nanobot (v0.3.0)
- Locais: caminhos citados nas tabelas, varridos em 2026-09-14
