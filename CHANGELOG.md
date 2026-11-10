# CHANGELOG — openpcbotv3

## 3.13.7 — 2026-11-09

Painel pela rede local e pronto para o túnel (Nei: "quero o painel acessando pelo 192.168 e pelo ccc.inema.pro com uma senha ou autenticado pelo Google"; "salve ela no PC para não ficar toda hora autenticando").

- Servidor do painel em porta PRÓPRIA (`PAINEL_PORT`, 3143; `0` desliga), `src/painel/servidor-painel.ts`. Só existem `/login`, `/logout`, `/` e `/painel`, `/api/painel*`, `POST /api/vagas`; qualquer outra rota (inclusive `/mensagem`, `/api/fila`, `/health`) → 404. A 3142 não mudou e continua no loopback.
- `PAINEL_BIND` (padrão `127.0.0.1`): fora do loopback só sobe com senha definida; sem senha, loga e fica em 127.0.0.1.
- Senha: só o hash scrypt em `~/.config/inema/painel-senha.json` (600), conferência em tempo constante. `npm run painel-senha` (sem eco) ou `-- --gerar` (senha forte escrita UMA vez em `painel-senha-inicial.txt`, 600; nada impresso).
- Sessão: cookie HttpOnly, SameSite=Lax, `Secure` quando o túnel manda `X-Forwarded-Proto: https`; 365 dias deslizantes (cada uso estende, cookie regravado no máximo 1×/dia); só o SHA-256 do token em `store/painel-sessoes.json` (600), sobrevive a reinício; trocar a senha derruba todas. "Sair deste aparelho" e "Sair de todos (N aparelhos)" no topo.
- Login compatível com o gerenciador de senhas (usuário fixo "painel" oculto + `current-password`). 5 erros por IP em 15 min → 15 min bloqueado (`CF-Connecting-IP`/`X-Forwarded-For` só valem vindo de 127.0.0.1).
- `POST /api/vagas` na 3143: a sessão autentica (sem Bearer), com CSRF (cabeçalho `X-Painel: 1` + Origin do próprio host). Na 3142 a regra do token segue igual.
- Google via Cloudflare Access (desligado sem `PAINEL_CF_ACCESS_AUD` + `PAINEL_CF_ACCESS_TEAM`): JWT `Cf-Access-Jwt-Assertion` conferido (RS256 contra as chaves do time, cache 1 h; `aud`, `iss`, `exp`, `nbf`; e-mail em `PAINEL_EMAILS`).
- Cabeçalhos: CSP (inline + Google Fonts + miniaturas do YouTube), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, `no-store`.
- 19 testes novos (`src/painel/auth.test.ts`): login, bloqueio, 404 fora da lista, bind (inclusive `ligarServidorPainel` com listen real), JWT válido/expirado/aud/e-mail/assinatura, freio de 5 min quando as chaves do Access não carregam, cookie malformado, CSRF, renovação deslizante e persistência após recriar o servidor, sair de todos.

## 3.13.6 — 2026-11-09

Painel de monitoramento para TV e celular (pedido do Nei: "uma tela com alertas e uma interface de monitoramento… desde que não consuma máquina e tokens").

- `src/painel/`: `GET /painel` (também em `/`; o antigo foi para `/dashboard`), `GET /api/painel` (9 grupos, cada um com `ok`, `gerado_em`, `dados`/`erro`, `ausentes`), `/api/painel/<grupo>`, `/api/painel/falha?bot=&id=` (resultado completo, aberto no clique).
- Fontes só locais e com cache: `/proc`, `statfs`, `journalctl` (boots 10 min, erro de memória da GPU 5 min), banco do v3 por faixa de id, `inemaccbot.db` só leitura (`readonly`, `fileMustExist`, timeout 300 ms), `rodadas.jsonl`, `continua/estado.json`, timers, histórico do yt-pubx (fim do arquivo), filas espanhol/cidades/r7ex, limites do Claude (statusline) e do Codex (fim do registro mais novo), `fila-vaga --status --json`, `terminais --json`, topo do `pendencias.md`. Nenhum modelo, nenhuma API.
- Alertas numa lista única (`alertas.ts`) com chave estável; erros antigos de fila/continua não acendem a TV (janelas de 24/48 h).
- `POST /api/vagas {classe, valor}`: única escrita; exige `DASHBOARD_TOKEN_V3` + Bearer (sem token = 403, `?token=` não vale), inteiro ≥ 1 e ≤ teto, grava pelo comando `vagas` (`execFile`). Aviso para gpu > 1.
- Sites (`~/.config/inema/painel-sites.json`): GET a cada 5 min só enquanto o painel está aberto; `PAINEL_SITES=0` desliga.
- Alerta no Telegram pronto e desligado (`PAINEL_ALERTA_TELEGRAM=1`), sem repetir chave (`store/painel-avisados.json`).
- `src/cli/painel-teste.ts`: sobe só o HTTP do painel numa porta de teste, sem bot nem polling.
- 20 testes novos (`src/painel/painel.test.ts`, `src/painel/tela.test.ts`: desenhos do cliente nos 3 modos com dados reais, rota de falha).

## 3.12.6 — 2026-11-05

Retomada sem reler a conversa inteira. Antes o bot retomava a sessão do chat por até 6 h; depois de 1 h o cache já tinha vencido e cada retomada relia tudo (job #89966: 154 mil tokens).

- `src/orquestrador/resumo-sessao.ts` + cron `resumo-sessoes` (1/min): sessão parada há 40–52 min ganha um resumo de retomada escrito por uma cópia dela (`--fork-session`, cache quente, sem Bash/Edit/Write). Tentativa marcada antes de rodar: falha não repete a cada minuto; chat com job aberto é pulado.
- `Sessoes.obter`: retoma só até 55 min (era 6 h). Depois disso, sessão nova com `[Retomada …]` = resumo + 6 últimas mensagens do chat (até 24 h; `/novo` zera).
- Migração 11: `sessions.resumo`, `resumo_de`, `resumo_em`.

## 3.11.6 — 2026-11-05

Pedido barrado por hook não morre mais calado (job #89966, tornados PR/SC: o aviso de "cache venceu" do hook-longrun saiu como resposta e o job ficou `done` sem fazer nada).

- `claude -p` do bot roda com `LONGRUN_PAUSA_TOKENS=0`: o bloqueio de pausa do hook-longrun é para o terminal, não para o bot.
- `comRepeticaoSemBloqueio` (agente-cli.ts): se um hook barrar a sessão retomada, repete UMA vez em sessão nova (sem `--resume`); se barrar de novo, o job falha com o motivo em vez de entregar o texto do hook.

## 3.11.5 — 2026-10-23

O bot passa a receber arquivos. Antes só lia texto/legenda: um vídeo mandado no chat sumia sem aviso (22/10).

- `src/canais/anexo.ts`: vídeo, foto (a maior), documento, áudio, voz, vídeo redondo e GIF são baixados para `store/anexos/<data>/<msg>-<nome>` nos chats em que o bot responde; o texto que vai ao agente ganha `[anexo recebido: vídeo · 12,3 MB · salvo em <caminho>]`.
- Acima de 20 MB (limite do Bot API do Telegram) não baixa: a linha diz `NÃO baixado` e o motivo, para o agente avisar em vez de ignorar.
- Mensagem só com arquivo (sem legenda) agora chega ao agente. Grupos só observados continuam sem download.

## 3.10.5 — 2026-10-18

Agente de projeto escolhido sem depender do roteador.

- `gatilhos:` no `agent.yaml`: uma palavra da lista na mensagem manda direto para aquele agente (antes das heurísticas e do LLM).
- `@<id>` no começo da mensagem escolhe o agente na hora (`@mostratec ...`, `@ops ...`).
- Novo agente `mostratec` (cwd `~/projetos/mostratec`, modelo topo): trocar ideias e desenvolver o projeto INEMA na MOSTRATEC pelo Telegram.

## 3.9.5 — 2026-10-14

Incidente de 13/10: dois reels r7e pedidos pelo Telegram (#57172 às 00:57 e #58262 às 16:35) morreram como
"lease vencido sem ack". O agente, a montagem (`reel7etapas.py montar`, pico de 1,49 GB num só processo) e o
ffmpeg rodavam DENTRO do cgroup do serviço (MemoryHigh 1,5G / MemoryMax 2G): o serviço entrou em thrashing
(pressão 96%, swap 2,8 G) e o systemd-oomd matou o bot inteiro, junto com a aventuras-fila, terminais e o Firefox.

- Cada agente roda num escopo systemd próprio (`systemd-run --user --scope`, `MemoryMax=16G`, sem swap). O teto do
  serviço volta a valer só para o bot. Estourou → morre só aquele job, com o erro "provável falta de memória".
- `AGENTE_MEMORIA_MAX` muda o teto (`off` = comportamento antigo). `--scope` faz exec no mesmo PID: cancelar,
  timeout e vigia continuam matando a árvore toda (testado).

## 3.8.5 — 2026-10-11

Incidente da madrugada de 11/10: três pedidos seguidos morreram no timeout de 20 min retomando a mesma sessão
gigante (~286k tokens), e o `/status` não mostrava o pedido (enterrado pelo cron `lembretes`).

- `/novo` em ordem, sem cancelar: grava o momento (`prefs.sessao_novo_em`). Job criado antes segue na conversa
  velha e não grava por cima; job criado depois começa conversa nova. Antes, o job em voo regravava a sessão velha.
- `/job <id> <texto>`: continuação de um job de agente na conversa DAQUELE job (coluna `jobs.sessao`, migração 10),
  na vez dele (lane agente é 1 por vez). Só job do próprio chat.
- `/status` mostra primeiro os seus jobs abertos (pedido + tempo); recentes sem cron e com o pedido. `/status <id>`
  mostra o pedido e se há conversa salva.
- Teto por tipo de pedido: produção (vídeo, 9:16, publicar, render, curso…) 3 h; o resto 20 min. Zumbi do
  heartbeat passa a ser 2× o maior teto (6 h).
- Vigia de sessão retomada: se o transcript não for escrito em 10 min, mata com "não respondeu" (não espera as
  3 h). Job morto por timeout ou vigia descarta a sessão do chat: a mensagem seguinte começa limpa.
- Heartbeat (30 min) avisa no chat "⏳ #id ainda rodando há N min" para job de agente com mais de 25 min.

## 3.7.5 — 2026-10-10

- Roteador (direto × agente) passa do `llama3.2` para o `qwen3.8:27b` (mesmo modelo do `geral`, já residente; sem
  RAM extra). Com o prompt real do roteador e 14 frases típicas: llama3.2 7/14 (mandava "lê meus emails",
  "o render terminou?", "espaço no disco" para a rota sem ferramentas), qwen 14/14, ~3 s/msg contra 0,7 s.
- Roteador usa o keep_alive do papel (30m, igual ao geral) e o probe de 60 s não pinga o roteador quando ele é
  o modelo geral: o ping renovaria o keep_alive e o qwen nunca sairia da GPU (decisão de 2026-09-28, renders).

## 3.6.5 — 2026-10-10

- Especialistas só-leitura (`consulta:*`) também recebem o quadro do chat. No teste ao vivo o `research` recebeu
  só "ah, conta também os da pasta raiz" e respondeu "me perdi no contexto".
- Teste ao vivo (chat http `teste-triagem`): outro assunto esperou o #53772 e foi respondido depois; complemento
  com especialistas guardado (#53778) e executado DEPOIS do pedido (#53779 → #53780, mesma sessão do lead);
  "qual situação?" respondido por código.

## 3.6.4 — 2026-10-10

- Quadro do chat (`src/orquestrador/quadro.ts`): assunto ativo, o que roda, a fila e a última entrega, lidos da
  fila na hora de cada chamada (nunca guardado). Entra no prompt do roteador, da rota direta (qwen) e do agente
  (`claude -p`, e no Codex quando virar motor, via `montarPrompt`); o agente se vê como "você está executando #N".
- Prefixo de quem respondeu: `🏠` rota local, `🧠 #N agente` entrega do agente, `📋` situação por código.
- Triagem com agente trabalhando no chat (`src/orquestrador/triagem.ts`), sem interromper o agente:
  "para/cancela" cancela; mesmo assunto vira complemento no MESMO agente e sessão, rodando logo depois do atual;
  outro assunto espera a vez (tarefa `apos-agente`) e só então é roteado. Com especialistas consultando, o
  complemento também espera, para não rodar antes do pedido original.
- Classificador da triagem = qwen (`geral`, residente): 6/6 em frases reais; o llama3.2 marcou "outro assunto"
  em tudo (3/6). `steer` passa a valer só com resposta rápida em voo; com agente aberto vale a triagem.
- Verificação: 221 testes.

## 3.5.4 — 2026-10-09

- Status por código: pergunta de andamento ("qual situação?", "terminou?") com job aberto no chat é respondida
  lendo a fila (número, agente, há quanto tempo, pedido), sem modelo (`src/orquestrador/situacao.ts`).
- Na dúvida → agente: consulta/estado/projeto/vídeo/publicação vão ao `lead` antes do LLM roteador; fallback
  do roteador (sem JSON ou indisponível) passa a ser o agente, não a rota local.
- Trava da rota direta: o qwen recebe a regra "sem ferramentas, nunca prometa; responda [ESCALAR]"; resposta com
  promessa ("vou verificar…", "um momento") ou [ESCALAR] não é enviada e vira job do agente.
- Caso real: 18:41/18:53 de 09/10, "vou verificar a situação…" sem job. Verificação: 216 testes.

## 3.4.4 — 2026-09-25

- Histórico das comparações Jev na tabela `jev_comparacoes` (migration 9), sem o texto da mensagem.
  Antes só a última comparação por chat ficava guardada.
- `/jev historico [n]` e `/jev relatorio dia|semana` (também `npm run jev -- historico|relatorio dia`).
- Crons `jev-relatorio-diario` (8h05) e `jev-relatorio-semanal` (segunda 8h10) entregam o relatório no chat principal;
  `/cron off <nome>` desliga.
- Plano do jev-gw anotado em `docs/PLANO-JEV-GW.md` (não implementado).
- Verificação: 203 testes.

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
