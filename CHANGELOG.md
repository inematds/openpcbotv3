# CHANGELOG — openpcbotv3

## 3.3.4 — 2026-09-19

- Adiciona Jev via OpenRouter Decisions para observar rota, agente e skill sem alterar o dispatcher.
- Passa as consultas pelo gateway, orçamento e registro de custo, com timeout, limite de frequência e isolamento por chat.
- Acrescenta /jev observar|off, consulta da última comparação e CLI local de operação/teste.
- Verificação: 202 testes e uma chamada real registrada pelo gateway.

## 3.2.4 — 2026-09-17

- Corrige o argumento de conta do Calendar e preserva tokens existentes no auth.
- OAuth sugere a conta correta e solicita consentimento para acesso offline.
- Skills Gmail/Calendar alinhadas aos conectores locais; seis autorizações validadas
  com leitura e escrita temporária, sem envio de e-mail. Segredos fora do repositório.

## 3.2.3 — 2026-09-14

- Documentação da fase 9: seção 9b do README (interruptores, modos de fila com os limites frente ao
  openclaw, camadas de persona, `/context`, `doctor --deep`, `mcp_config`); `/ajuda` ganhou bloco
  "Controle da conversa" e `/ajuda <comando>` com o detalhe de cada um.

## 3.2.2 — 2026-09-14

- **`interrupt` não pegava agente em voo**: o teste `emCurso` só cobre resposta direta; no caso
  comum (agente rodando na fila, resposta direta já encerrada) o `claude -p` seguia. Agora o
  interrupt avança a geração e cancela por `flow_ref` antes de qualquer checagem, `responder()`
  descarta também antes de despachar agente, e o `finally` só limpa `emCurso` se a geração ainda
  for a vigente. Achado em revisão, não em produção.

## 3.2.1 — 2026-09-14 (fase 9: "Jarvis obedece")

Seis itens de `docs/INCORPORAR-V3.md`, um commit cada. Tudo em `prefs` (migration 8), sem tocar
o que já existia.

- **Interruptores** `/parar [tudo|agentes|<agente>] [motivo]` e `/retomar`: persistem, cancelam o
  que está em voo nas lanes de conversa e o runner recusa job enfileirado antes do `/parar`.
  Manutenção na lane `ollama` segue livre. Processo em execução morre na batida seguinte (até 30 s).
- **Modos de fila por chat** `/fila collect|followup|steer|interrupt` (openclaw). `steer` substitui o
  que estava na fila do chat com prioridade alta, sem injetar no agente em voo; `interrupt` cancela
  fila e agentes do chat por `flow_ref` e descarta a resposta direta em voo (contador de geração).
  Processo `claude -p` cancelado morre na batida seguinte do worker (até 30 s).
- **SOUL** (Hermes): `agents/<id>/SOUL.md` fixo por agente e `/personality <nome|off>` por chat
  lendo `personalidades/*.md`, somados a `IDENTIDADE.md`. Trocar limpa as sessões retomadas.
- **`/context [detail] [texto]`**: tokens por camada do prompt (direto e agente), retrieval em modo
  somente leitura para não inflar saliência.
- **`npm run doctor -- --deep`**: probes que exercitam o sistema: `/health`, `sendMessage` no
  Telegram, Ollama pelo gateway em banco de memória, job `doctor-probe` que o worker precisa concluir.
- **`mcp_config` por agente** no `agent.yaml`: `--mcp-config <json> --strict-mcp-config`, o
  especialista vê só os servidores dele. Sem a chave, herda os do usuário como antes.

Testes: 187 passando (`npm test`).

Fora desta fase, anotado como fase 10 em `docs/INCORPORAR-V3.md`: cliente MCP nativo no caminho
Ollama e servidor MCP do inemavox como primeiro caso real.

## 3.1.1 — 2026-09-07

Correções encontradas em revisão, antes de qualquer conta ser ligada.

- **Agenda voltaria a ficar cega** depois da primeira passagem: o marcador guardava o `start` do
  evento mais distante da janela de 14 dias, então um compromisso criado depois — com data menor —
  nunca passava do filtro `id > ultimo_id`. A agenda é uma janela, não um fluxo: agora cada passagem
  usa o instante da leitura como id e o dedupe por hash do cérebro absorve o reprocesso.
  Coberto por `src/cerebro/google.test.ts` (o arquivo não tinha teste nenhum).
- **Descoberta de chat_id passou a funcionar como o doc promete**: um chat fora das duas listas era
  descartado sem deixar rastro, e o `journalctl | grep telegram` do §3.3 não mostrava nada. Agora
  aparece uma linha, uma vez por id.
- **`/fontes ingerir gmail|agenda`**: o doc mandava "enfileirar pelo dashboard", que é read-only.
- **`gcal.py`**: aliases de conta pessoal saíram do docstring (o repo é público).

Testes: 175.

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
