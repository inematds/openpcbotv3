# openpcbot v3

Assistente pessoal multicanal (Telegram, CLI, HTTP) com fila durável em SQLite, gestor do Ollama com preflight de RAM, custo por chamada com orçamento, cérebro com memória PT-BR e consolidação noturna. Sucessor do `openpcbotv2`, rodando **ao lado** dele (estrangulamento, não corte).

Plano e arquitetura: [PLANO-MIGRACAO-V3.md](PLANO-MIGRACAO-V3.md). Estado por fase: [CHANGELOG.md](CHANGELOG.md).

## Subir

```bash
npm install
cp .env.exemplo .env      # preencha TELEGRAM_BOT_TOKEN_V3 (bot PRÓPRIO, do BotFather)
npm run doctor            # checa env, Ollama, RAM, CLI, v2, unit
npx tsx src/cli/importar.ts   # (uma vez) importa memórias do v2 por snapshot
bash scripts/instalar-servico.sh   # unit systemd --user com MemoryMax=2G, Restart=on-failure
```

Sem token do Telegram o serviço sobe mesmo assim com HTTP (`:3142`) e CLI. O token do v2 é **recusado** (dois `getUpdates` = 409 e bot surdo).

## Operar

| O quê | Como |
|---|---|
| Health (o hub `wifi` consome) | `GET http://localhost:3142/health` |
| Dashboard | `http://localhost:3142/` (com `DASHBOARD_TOKEN_V3`, `?token=`) |
| Falar com o bot sem Telegram | `npm run cli -- "sua mensagem"` ou `POST /mensagem {"texto":...}` |
| Logs | `journalctl --user -u openpcbotv3 -f -o cat` |
| Restart após mudar `src/` ou `.env` | `bash scripts/instalar-servico.sh` |
| Diagnóstico | `npm run doctor` |

Comandos no chat: `/status`, `/usage`, `/health`, `/ollama`, `/memoria`, `/tarefa`, `/daily`, `/cron`, `/agentes`, `/skills`, `/novo`, `/consolidar`, `/ajuda`.

## Garantias de memória (coexistência com o v2)

- **Mesmas tags do v2** (`qwen3.8:27b` geral, `llama3.2` roteador, `bge-m3` embed): um único modelo residente serve os dois bots.
- **Preflight de RAM**: modelo grande não residente só carrega com `MemAvailable ≥ PISO_RAM_GB` (40). Senão cai para o tier barato (OpenRouter) e alerta.
- **1 modelo grande residente**; o v3 **nunca descarrega** modelo que não carregou (pode ser do v2). Tier `pesado` (70b) desligado.
- **Unit com `MemoryHigh=1.5G` / `MemoryMax=2G`** (cgroup v2 delegado, verificado) e `--max-old-space-size=1024`.
- Lane `agente` com concorrência 1: um `claude -p` (~500 MB) por vez.
- WhatsApp desligado (Chromium + sessão única do número, que é do v2). Slack desligado (token do v2).

## Layout

```
src/
  bus/           barramento de eventos tipado
  canais/        telegram · cli · http(+dashboard) · slack · whatsapp(stub) · guarda de exfiltração
  fila/          store/worker/runner portados do inemaccbot (lanes: chat, agente, ollama, cron, io)
  orquestrador/  roteador (Ollama pequeno) · comandos · agente CLI · skills · agentes · tarefas da fila
  ollama/        gestor (registry, preflight, probe) · cliente HTTP · ram
  custo/         gateway (único ponto de LLM) · registro · orçamento · preços
  provedores/    ollama · openrouter · anthropic
  cerebro/       memória FTS5+vetor · contexto 3 camadas · consolidação · vault · importar-v2
  tarefas/       cron · heartbeat · tarefas do usuário · crons padrão
  telemetria/    logger pino · alertas com dedupe
  cli/           doctor · importar · chat
config/          ollama.yaml · precos.yaml · orcamento.yaml
systemd/         openpcbotv3.service
skills/, agents/ copiados do v2 como estão (skills/_rascunhos = loop de aprendizado, nunca auto-promove)
```

Regras: nenhum módulo acima de 500 linhas; toda chamada de LLM passa por `custo/gateway.ts`; Ollama só por HTTP.
