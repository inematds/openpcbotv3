# openpcbot v3

Assistente pessoal multicanal (Telegram, CLI, HTTP) com fila durável em SQLite, gestor do Ollama com preflight de RAM, custo por chamada com orçamento, cérebro com memória PT-BR e consolidação noturna. Sucessor do `openpcbotv2`, rodando **ao lado** dele (estrangulamento, não corte).

Plano e arquitetura: [PLANO-MIGRACAO-V3.md](PLANO-MIGRACAO-V3.md). Estado por fase: [CHANGELOG.md](CHANGELOG.md). Falhas: [FALHAS.md](FALHAS.md).

Bot no Telegram: **@inemav3bot** (o v2 continua no @inemaclaudebot).

---

## 1. Subir

```bash
npm install
cp .env.exemplo .env          # TELEGRAM_BOT_TOKEN_V3 = bot PRÓPRIO, do BotFather
npm run doctor                # checa env, Ollama, RAM, CLIs, v2, unit
npx tsx src/cli/importar.ts   # (uma vez) importa memórias do v2 por snapshot
bash scripts/instalar-servico.sh   # unit systemd --user, MemoryMax=2G, Restart=on-failure
```

Sem token do Telegram o serviço sobe mesmo assim com HTTP (`127.0.0.1:3142`) e CLI. O token do v2 é **recusado** (dois `getUpdates` = 409 e bot surdo).

## 2. Operar

| O quê | Como |
|---|---|
| Health (o hub `wifi` consome) | `GET http://127.0.0.1:3142/health` |
| Dashboard | `http://127.0.0.1:3142/` |
| Falar com o bot sem Telegram | `npm run cli -- "mensagem"` ou `POST /mensagem {"texto":"..."}` |
| Logs | `journalctl --user -u openpcbotv3 -f -o cat` |
| Restart após mudar `src/` ou `.env` | `bash scripts/instalar-servico.sh` |
| Diagnóstico | `npm run doctor` |
| Testes | `npm test` (161) |

---

## 3. Como funciona (o caminho de uma mensagem)

```
Telegram / CLI / HTTP
   │  adaptador traduz para o BUS ("mensagem.recebida")
   ▼
ORQUESTRADOR
   ├─ começa com "/"?  → comando (seção 4), responde na hora
   ├─ janela collect 2 s: mensagens seguidas viram uma só
   ├─ ROTEADOR: llama3.2 (local, grátis) devolve JSON {rota, agente, tier, motivo}
   │     "direto"  → conversa, pergunta curta, resumo, tradução
   │     "agente"  → precisa de ferramenta: arquivo, shell, repo, web, skill, calendário
   ├─ CÉREBRO monta o contexto de memória (até 600 tokens, seção 6)
   │
   ├─ direto → GATEWAY LLM (tier local = qwen3.8:27b residente) → resposta
   │           grava turno + memória; se for fato durável, propõe entrada no vault
   │
   └─ agente → job na FILA (lane `agente`, 1 por vez)
               worker roda `claude -p --output-format json` com prompt em camadas
               (identidade + agente + memória + skills + mensagem)
               resultado volta pelo bus ao chat de origem; custo real registrado
   ▼
GUARDA DE EXFILTRAÇÃO: todo texto que sai é varrido (tokens, keys, JWT, valores do .env) → [REDIGIDO]
```

Especialistas em paralelo (padrão grokky): quando o roteador indica `consultar`, até 2 agentes **só leitura** (ex.: `research`) rodam antes e o `lead` recebe as saídas deles no prompt. Só o lead escreve.

---

## 4. Comandos no chat

| Comando | Faz |
|---|---|
| `/status [id]` | fila por lane (rodando/pendente) ou detalhe de um job com resultado/erro |
| `/cancelar <id>` · `/prioridade <id> <n>` | opera a fila |
| `/usage` | custo hoje/semana/mês, por tier e por agente, orçamento |
| `/health` | Ollama (modelos carregados, latência), RAM/swap, RSS do processo, fila, heartbeat, canais |
| `/ollama status\|preflight <m>\|descarregar <m>` | gestor do Ollama (descarregar recusa modelo que não é do v3) |
| `/memoria lista\|buscar <t>\|salvar <t>\|esquecer <id>\|propostas\|aprovar <id>\|descartar <id>` | cérebro e vault |
| `/tarefa add [quando] <texto>` · `/tarefa lista` · `/tarefa feita <id>` | suas tarefas; `quando` = `em 2h`, `amanhã 9h`, `sex 10h`, `15/09 14:30` |
| `/daily` | resumo: tarefas, feitas nas últimas 24 h, custo do dia, fila, Ollama, MEMORY.md |
| `/cron lista\|on <nome>\|off <nome>` | tarefas agendadas |
| `/agentes` · `/skills` | o que está instalado |
| `/novo` | limpa sessão do CLI e histórico do chat · `/compress` só a sessão |
| `/consolidar` | roda a consolidação de memória agora |
| `/chatid` · `/versao` · `/ajuda` | |

---

## 5. Fila (`src/fila/`, portada do inemaccbot)

SQLite com claim atômico (`UPDATE ... RETURNING`), lease com heartbeat a cada 30 s, backoff exponencial, idempotência por `idem_key`, cancelamento sem corrida, drain gracioso no `SIGTERM` (renova lease enquanto espera, aborta após 110 s). Jobs nunca são apagados: são o histórico.

Lanes e concorrência (`src/fila/filas.ts`):

| lane | conc. | uso |
|---|---|---|
| `chat` | 2 | resposta direta que chegou durante outra em curso |
| `agente` | 1 | `claude -p` (cada um ~500 MB de RAM) |
| `ollama` | 1 | consolidação, embeddings |
| `cron` | 1 | tarefas agendadas |
| `io` | 4 | rede/arquivo, junção de especialistas |

Todo job com `chat_id` avisa o chat ao terminar (sucesso ou falha). Se o envio falhar, uma varredura a cada 20 s reentrega.

---

## 6. Cérebro (`src/cerebro/`)

**Memórias** (tabela `memories`, igual à do v2): cada mensagem sua com mais de 20 caracteres vira uma memória, classificada por regex PT-BR + inglês em `semantic` (durável: "meu", "prefiro", "sempre", "nunca", "lembra", "moro em", "meu nome"...) ou `episodic`. Pergunta nunca vira fato. Dedupe por hash da frase normalizada.

**Salience**: começa em 1.0, +0.1 a cada uso; decai por dia sem uso (semântica 0,5 %, episódica 2 %); abaixo de 0.05 e sem acesso há 30 dias, é apagada.

**Busca**: FTS5 (palavra-chave) + vetor `bge-m3` (BLOB de 1024 floats, cosseno em JS). Vetores são indexados pelo cron `indexar-memoria` a cada 15 min.

**Contexto no prompt** (3 camadas, teto 600 tokens): 3 por palavra-chave, 3 por vetor, 3 mais importantes, 3 mais recentes, sem repetir, mais 3 insights.

**Consolidação noturna** (cron 4h, no Ollama, custo zero): funde duplicatas (fica a mais recente), detecta contradições por data (a antiga recebe `superseded_by`, nunca é apagada) e gera até 3 insights por chat.

**Vault curado** (`~/vault/MEMORY.md` e `USER.md`): o bot propõe, você aprova (`/memoria aprovar <id>`). Nada é escrito sem aprovação. `USER.md` entra no prompt de toda conversa.

**Importação do v2**: `VACUUM INTO` faz um snapshot consistente do banco do v2 (que continua em uso) e insere com `origem='v2'`. Idempotente.

**Loop de aprendizado de skills**: rascunhos vão para `skills/_rascunhos/`; nunca são promovidos sozinhos.

---

## 7. Gestor do Ollama (`src/ollama/`)

Só HTTP com o serviço systemd (nunca `ollama serve`). `config/ollama.yaml`:

| papel | modelo | por quê |
|---|---|---|
| `roteador` | `llama3.2` | classificação em JSON, 2 s, 4 GB |
| `geral` | `qwen3.8:27b`, residente | **mesma tag do v2**: um único modelo serve os dois bots |
| `embed` | `bge-m3` | vetores da memória, 0,7 GB |
| `pesado` | `llama3.1:70b`, **desligado** | 42 GB; só depois do corte |

**Preflight** antes de qualquer chamada local: modelo já residente passa; pequeno precisa de tamanho + 4 GB livres; grande não residente precisa de `PISO_RAM_GB` (40) e de **nenhum outro grande carregado**. Se falhar, cai para o tier barato e alerta. O v3 **nunca descarrega** modelo que não carregou (pode ser do v2).

**Probe** a cada 60 s: `/api/ps`, latência de um "ok" no roteador, RAM. Alerta se Ollama fora, latência > 5 s, RAM < 10 GB, dois modelos grandes residentes.

---

## 8. Custo (`src/custo/`)

`gateway.ts` é o **único** ponto por onde uma chamada de LLM passa (inclusive embeddings). Ordem: orçamento → escolhe provedor pelo tier → preflight de RAM (se local) → chama → mede latência → calcula custo → grava em `chamadas_llm`.

| tier | provedor | modelo | quando |
|---|---|---|---|
| `local` | Ollama | qwen3.8:27b | padrão; custo 0 |
| `barato` | OpenRouter | claude-haiku-4.5 | raciocínio longo em resposta direta, ou Ollama sem RAM |
| `premium` | `claude -p` (CLI) | sonnet/opus por agente | rota agente; custo real vem do próprio CLI |

Orçamento (`config/orcamento.yaml`, `ORCAMENTO_MENSAL_USD`): aviso a 70 %, **trava a 100 %** (só Ollama passa). Subir de tier registra o motivo.

---

## 9. Tarefas, cron e heartbeat (`src/tarefas/`)

- **Cron** vira job na fila com `idem_key = nome@ocorrência` (nunca dispara duas vezes). Sessão `isolada` (contexto limpo) ou `principal`. Padrão: `lembretes` (1 min), `indexar-memoria` (15 min), `decaimento` (3h30), `consolidacao-noturna` (4h), `backup-noturno` (4h15), `daily-8h`.
- **Heartbeat** a cada 30 min: recupera leases vencidos, cancela zumbi (rodando > 2× o timeout de 20 min), alerta 3 falhas da mesma tarefa em 1 h.
- **Suas tarefas** (`tarefas_usuario`): lembrete por data, resumo no `/daily`.

---

## 10. Canais (`src/canais/`)

- **Telegram** (grammy): só o `ALLOWED_CHAT_ID`; markdown simples vira HTML; mensagens longas fatiadas; 409 vira log, não loop.
- **CLI**: stdin/stdout quando há TTY ou `--cli`.
- **HTTP**: `127.0.0.1` por padrão (`POST /mensagem` dispara agente com permissões). Expor na LAN só com `HTTP_BIND_V3=0.0.0.0` **e** `DASHBOARD_TOKEN_V3`.
- **Slack**: Web API via fetch, probe de OAuth no doctor; desligado até o corte (token é do v2).
- **WhatsApp**: stub que recusa enquanto o v2 está ativo (sessão única do número; whatsapp-web.js sobe um Chromium). Implementação real na fase 8, em daemon separado.

---

## 11. Telemetria e alertas

Logs pino JSON no journal. `GET /health` devolve `ok` (Ollama online, RAM ≥ 10 GB, heartbeat < 90 min) mais fila, modelos, RAM, orçamento. Alertas com dedupe de 30 min por chave, entregues no chat permitido do Telegram: Ollama fora, RAM baixa, lease morto, zumbi, 3 falhas, orçamento 70 %/100 %.

Dashboard (`/`): health, Ollama/RAM, fila por lane, custo 14 dias (sparkline) e por tier/agente, memória, jobs recentes. Atualiza a cada 10 s.

Backup noturno: `VACUUM INTO` + `age` (se `AGE_RECIPIENT`) ou gzip, retenção 14, em `store/backups/`.

---

## 12. Garantias de memória na coexistência com o v2

- **Mesmas tags do v2**: um modelo residente para os dois bots. Mudar a tag do `geral` sem mudar no v2 = dois modelões = OOM.
- **Preflight de RAM** e política de 1 grande residente; nunca descarrega modelo alheio; 70b desligado.
- **Unit com `MemoryHigh=1.5G` / `MemoryMax=2G`** (cgroup v2 delegado, verificado) e `--max-old-space-size=1024`. Pico observado: ~1 GB com um `claude -p`.
- Lane `agente` com concorrência 1. WhatsApp/Slack desligados.
- O `keep_alive: -1` do modelo geral fixa 17 GB na RAM (a máquina foi de 57 para 35 GB livres). É o desenho do plano; para soltar, troque para `10m` em `config/ollama.yaml`.

---

## 13. Configuração

`.env` do v3 (só o específico; keys compartilhadas vêm em runtime do `.env` do v2):

| variável | default | |
|---|---|---|
| `TELEGRAM_BOT_TOKEN_V3` | | token próprio; o do v2 é recusado |
| `PORT_V3` | 3142 | |
| `HTTP_BIND_V3` | 127.0.0.1 | |
| `DASHBOARD_TOKEN_V3` | | protege `/` e `/api/*` |
| `PISO_RAM_GB` | 40 | GB livres para carregar modelo grande |
| `ORCAMENTO_MENSAL_USD` | 50 | |
| `SLACK_ENABLED` / `WHATSAPP_ENABLED` | 0 | |
| `AGE_RECIPIENT` | | backup cifrado |
| `CLAUDE_BIN` / `CODEX_BIN` | claude / codex | |

YAML em `config/`: `ollama.yaml` (papéis, piso, probe), `precos.yaml` (USD/1M tokens, tiers), `orcamento.yaml`.

---

## 14. Layout

```
src/
  bus/           barramento de eventos tipado
  canais/        telegram · cli · http(+dashboard) · slack · whatsapp(stub) · guarda de exfiltração
  fila/          store/worker/runner portados do inemaccbot (lanes: chat, agente, ollama, cron, io)
  orquestrador/  orquestrador · roteador · comandos · agente-cli · skills · agentes · tarefas-fila
  ollama/        gestor (registry, preflight, probe) · cliente HTTP · ram
  custo/         gateway (único ponto de LLM) · registro · orçamento · preços
  provedores/    ollama · openrouter · anthropic
  cerebro/       memoria (FTS5+vetor) · contexto (3 camadas) · consolidacao · vault · importar-v2
  tarefas/       cron · heartbeat · usuario · padrao
  telemetria/    logger pino · alertas com dedupe
  dashboard/     html
  cli/           doctor · importar · chat
  db/            abrir · migrations (com checksum) · backup
config/          ollama.yaml · precos.yaml · orcamento.yaml
systemd/         openpcbotv3.service
skills/, agents/ copiados do v2 como estão (skills/_rascunhos = loop de aprendizado)
IDENTIDADE.md    persona e limites do bot (entra em todo prompt)
```

Regras: nenhum módulo acima de 500 linhas; toda chamada de LLM passa por `custo/gateway.ts`; Ollama só por HTTP; falha real vira linha em `FALHAS.md`.

## 15. O que ainda não está

- **Fase 8 (corte)**: trocar o token de produção, v2 só leitura por 30 dias, arquivar. Só com ordem explícita.
- WhatsApp real (daemon separado), Slack ligado.
- Retenção da tabela `jobs` (hoje nunca purga; ~1,5 k linhas/dia com o cron de lembretes).
- Memória guarda a frase inteira, não um fato extraído.
