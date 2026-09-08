# CHANGELOG — openpcbotv3

## 3.1.0 — 2026-09-07

Conectores e ingestão: as fontes externas passam a virar **memória**, não só resposta.

- **Conectores Google versionados** em `conectores/google/`: `gmail.py` (novo, multi-conta) e
  `gcal.py` (portado do v2, agora sem e-mail hardcoded). Uma credencial OAuth serve N contas;
  cada conta tem seu token em `~/.config/google/`. `--conta` aceita alias, lista ou `todas`.
  Uma conta com token quebrado não derruba as outras.
- **Telegram multi-chat com modo observador**: `TELEGRAM_CHATS_RESPONDER` e
  `TELEGRAM_CHATS_OBSERVAR`. Chat observado grava no cérebro e **nunca** responde; o adaptador
  passou a ler também legenda de foto/vídeo e a guardar autor e nome do grupo.
- **Ingestão** (`src/cerebro/ingestao.ts`): converte texto bruto em fatos duráveis em LOTE, uma
  chamada no Ollama residente por bloco (custo zero). `ingestao_estado` (migration 7) marca até
  onde cada fonte foi lida — rodar duas vezes não reprocessa. Erro de chamada não avança o
  marcador; resposta ilegível avança, para um bloco ruim não travar a fonte para sempre.
- **Crons**: `ingestao-observados` (30 min, ligado), `gmail-ingestao` (2 h) e `agenda-ingestao`
  (7h05) criados **desligados** — ligar com `/cron on` depois de autenticar as contas.
- **`/fontes`** mostra chats observados e o que já virou memória; `/fontes ingerir` roda na hora.
- **`doctor`** checa `contas.json` e o token de cada conta por serviço.
- **[docs/CONECTORES.md](docs/CONECTORES.md)**: passo a passo de vários e-mails, várias agendas e
  Telegram no cérebro, com os limites reais da Bot API e o que exigiria uma sessão de usuário.

Verificado no ar: 5 mensagens de um grupo observado → 4 fatos gravados, custo US$ 0, 3,6 s.
Testes: 172.

## 3.0.0 — 2026-09-06

Primeira versão no ar, ao lado do v2 (v2 intocado, continua em produção).

- **Fase 0 (esqueleto)**: `src/` por camadas, bus tipado, config em YAML com defaults, logger pino, vitest, unit systemd `--user` com `Restart=on-failure`, `MemoryHigh=1.5G`, `MemoryMax=2G` (cgroup verificado) e `--max-old-space-size=1024`.
- **Fase 1 (fila + Ollama)**: `fila/` portada do inemaccbot com os 107 testes originais (claim atômico, lease + heartbeat, backoff, idempotência, drain); lanes `chat|agente|ollama|cron|io`; gestor do Ollama novo: registry de papéis, preflight de RAM, política de 1 modelo grande residente, nunca descarrega modelo alheio, probe a cada 60 s; `/status`, `/ollama`.
- **Fase 2 (custo + telemetria)**: `chamadas_llm`, gateway único de LLM com tiers local→barato→premium, custo real do OpenRouter, orçamento com aviso a 70 % e trava a 100 %, `/usage`, `/health`, `GET /health`, alertas com dedupe (Ollama fora, RAM baixa, lease morto, zumbi, 3 falhas, orçamento).
- **Fase 3 (canal Telegram + orquestrador)**: adaptador grammy com guarda contra o token do v2 e chat permitido; canais CLI e HTTP; roteador em Ollama pequeno (JSON) com heurística; modo `collect` de 2 s; agente por `claude -p --output-format json` na lane `agente` (sessão retomada, custo real do CLI registrado); especialistas read-only em paralelo + lead; skills e agents do v2 copiados como estão.
- **Fase 4 (cérebro)**: 291 memórias do v2 importadas por snapshot `VACUUM INTO`; regex PT-BR (TODO #1 do v2); embeddings bge-m3 em BLOB com cosseno; retrieval em 3 camadas com teto de tokens; consolidação noturna (duplicatas, contradições → `superseded`, insights); propostas para `MEMORY.md`/`USER.md` com aprovação por comando; rascunhos de skill em `skills/_rascunhos`.
- **Fase 5 (tarefas + heartbeat + cron)**: cron como jobs com `idem_key` por ocorrência, sessão principal/isolada; heartbeat a cada 30 min com recuperação de lease e detecção de zumbi; `/tarefa`, lembretes, `/daily` às 8h.
- **Fase 6 (canais extras)**: Slack via Web API com probe de OAuth (desligado até o corte); WhatsApp com guarda que recusa enquanto o v2 é dono da sessão (implementação real na fase 8, em daemon separado).
- **Fase 7 (dashboard + doctor + backup)**: dashboard compacto em `/` (fila, custo por dia/agente/tier, memória, Ollama/RAM, heartbeat); `npm run doctor`; backup noturno `VACUUM INTO` + `age`/gzip com retenção 14.
- **Fase 8 (corte)**: não iniciada, de propósito.

Testes: 160 passando (`npm test`).
