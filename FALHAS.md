# Falhas — openpcbotv3

| data | o que quebrou | menor correção | prompt \| infra |
|---|---|---|---|
| 2026-09-06 | Primeira conversa direta no v3 falhou com `Ollama error 400: time: missing unit in duration "-1"` — `keep_alive` do papel `geral` estava como string `"-1"` no YAML; o Ollama aceita `-1` só como número (ou `"10m"` como duração) | `config/ollama.yaml`: `keep_alive: -1` numérico; tipo `string \| number` no cliente e no gateway | prompt |
| 2026-09-06 | `doctor` acusava "2 processos ollama serve" e "porta 3142 em uso" com o serviço parado — `pgrep -f` contava o próprio `sh -c` e `grep -c` sem match sai com 1 (virava `null`) | `pgrep -c -x ollama`; `\|\| true` no grep e default `'0'` | prompt |
| 2026-09-06 | Primeiro job de agente (`claude -p`) falhou no ack com `NOT NULL constraint failed: sessions.chat_id` — o orquestrador gravava o input do job como `{entrada, consultas, origem}` mas o `promptDe` e o entregador liam o input como a própria `EntradaAgente`; `chatId` vinha `undefined`. O CLI rodou certo (saída preservada em `store/saidas/job-5.txt`) | input do job de agente = `EntradaAgente` pura (só o `agente-lead` embrulha); guard explícito de `chatId` + teste do round-trip | prompt |
| 2026-09-06 | HTTP do v3 subiu em `0.0.0.0:3142` sem token: qualquer host da LAN podia dar `POST /mensagem` e disparar `claude -p --dangerously-skip-permissions` (apontado pelo revisor antes de virar incidente) | bind `127.0.0.1` por padrão; `HTTP_BIND_V3` fora do loopback só com `DASHBOARD_TOKEN_V3` | prompt |
