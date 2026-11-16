# Agentes por assinatura — etapa 1 (3.36.17)

O openpcbotv3 executa os agentes por Codex ou Claude Code, exclusivamente pelas assinaturas. O padrão passou a ser Codex `gpt-6.1-sol`, esforço `medium`, para operar enquanto o Claude está limitado. Não há troca automática de motor nem novas APIs habilitadas.

## Operação

- `/motor`: mostra o motor, modelo e esforço deste chat.
- `/motor codex`: próximos pedidos deste chat usam Codex.
- `/motor claude`: próximos pedidos deste chat usam Claude; depende da disponibilidade da assinatura.
- `/motor padrao`: remove a escolha do chat e segue `config/agentes-ia.yaml`.
- `/status <id>`: mostra o perfil e a sessão do job.
- `/novo`: sessão nova dos agentes nas próximas mensagens; não cancela o que já está rodando.
- `/job <id> <texto>`: continua no motor selecionado ao criar a continuação. Se o motor for diferente, leva o pedido original e contexto recente, sem reaproveitar o identificador de sessão do outro motor.

O YAML tem comentários e é lido nos próximos pedidos. Edição manual preserva os comentários; `npm run ia -- ver` e `npm run ia -- validar` só leem/validam, sem login nem rede. Não há editor automático do YAML nesta etapa. Motor/modelo/esforço são congelados ao criar o job; alterar a preferência depois não muda o trabalho já enfileirado. Jobs legados sem perfil são resolvidos e fixados ao iniciar.

O modelo/esforço Codex desta etapa são explícitos no YAML do projeto, independentemente do terminal ou dos níveis centrais (que podem selecionar Astra). Claude continua com os modelos dos agentes e a fonte central já existente. Não foi acionado Astra para apoio.

## Continuidade e ferramentas

Sessões separadas por chat, agente e motor (migração 12). Sessões legadas continuam pertencendo ao Claude. Codex usa `exec --json` e `exec resume <thread>`; apenas a resposta final é entregue. Logs de comando e raciocínio ficam fora da resposta. Resposta incompleta ou erro de cota é falha do job.

Ao trocar de motor, ou após a janela de retomada de 55 min, uma sessão nova recebe até seis mensagens recentes e o resumo disponível. Ao voltar a um motor cuja sessão foi ultrapassada pelo outro, também abre sessão nova. Isso é continuidade limitada: não substitui um registro durável de etapas, decisões e efeitos externos. O resumo antigo do Claude só atende sessões Claude; não tenta resumir identificadores Codex pelo CLI Claude.

Agentes Codex com escrita usam o perfil/conectores já instalados na conta dos robôs; a conta vem de `~/.config/inema/codex-conta.env`. Especialistas de leitura usam sandbox `read-only` e `--ignore-user-config` para não herdar conectores pessoais com escrita. MCP configurado especificamente para Claude é recusado no Codex até adaptação explícita. Disponibilidade de todo conector/skill não é garantida por um teste de shell.

O gateway central envolve as execuções, registra uso e falhas, sem contabilizar assinatura como despesa de API. Codex informa tokens, mas o custo monetário não é medido nesta etapa (campo zero significa não informado). Chaves/seletores de API de modelo são retirados do ambiente do CLI, e Codex exige login ChatGPT. Os scripts de ferramentas continuam responsáveis por carregar credenciais autorizadas em runtime. Os adaptadores e tiers antigos de API não foram ampliados nem ativados por esta adaptação.

## Validação

- `npm run typecheck`
- `npm test` (inclui migração, seleção, perfil congelado, `/novo`, `/job`, isolamento de sessão, protocolo e cancelamento)
- `npm run ia -- validar`
- `timeout 300s node_modules/.bin/tsx scripts/teste-codex-real.ts` (duas chamadas REAIS pela assinatura, banco isolado, shell e retomada, entrega no bus HTTP; nenhuma publicação)

O script manual grava evidência em `~/projetos/output/openpcbotv3-codex/`. Não pertence à suíte automática. O serviço usa o CLI atual em `~/.npm-global/bin/codex` (ou `CODEX_BIN` explícito), teto de memória próprio e os limites/cancelamento já existentes. Reiniciar somente após verificar a fila de agentes; usar `bash scripts/instalar-servico.sh`.

## Retorno ao Claude

Por chat: `/motor claude`. Para todos os chats sem preferência: editar `motor: claude` no YAML. Chats com preferência explícita precisam de `/motor padrao` ou `/motor claude`. Não desfazer a migração 12 nem voltar binário antigo sobre o banco migrado. Backup anterior à ativação fica em `store/backups/`.

## Evidência desta ativação (15/11/2026)

- Typecheck e build aprovados; 384 testes em 54 arquivos aprovados.
- Teste real isolado: `~/projetos/output/openpcbotv3-codex/2026-11-15T19-36-31-299Z/resultado.json` (arquivo via shell, retomada da sessão, duas entregas no bus e uso registrado).
- Worker instalado: job 119999 concluído pelo Codex, resposta `CODEX_V3_OPERACIONAL`, notificação HTTP interna e uso em `codex-cli`. Evidência: `~/projetos/output/openpcbotv3-codex/servico-2026-11-15T19-40-09-553Z/resultado.json`.
- Health local retornou `ok: true`, versão 3.36.17, canais Telegram/HTTP/WhatsApp. v2 permaneceu ativo.
- Backup íntegro anterior à migração: `store/backups/pre-codex-3.36.17-20261115T193945Z.db` (ignorado pelo git).
- Não foram testados todos os conectores/skills, publicação, geração de mídia ou indisponibilidade real do Codex. A troca automática permanece fora desta etapa.

## Como poderia funcionar a troca automática sem tokens para decidir

Proposta explicativa, não implementação. O processo do bot permanece ativo mesmo sem cota no Codex. Ao receber erro explícito de limite, código determinístico pode classificar a recusa, suspender temporariamente o motor, conferir capacidades da alternativa e retomar com o estado salvo. A decisão em código não chama LLM e não exige tokens restantes no motor recusado.

A execução no Claude consome a assinatura Claude; receber o contexto também consome tokens. O Codex pode ter executado/consumido parte do pedido antes da falha. Testar disponibilidade com outra chamada de modelo também pode consumir cota. Não confundir decisão sem inferência com execução gratuita ou saldo compartilhado.

Antes de repetir um pedido com efeito externo, reconciliar o resultado: consultar identificador de publicação/envio/geração já iniciado, registrar a etapa concluída e retomar apenas o que falta. Se o resultado for incerto ou ambos os motores estiverem limitados, aguardar ou pedir intervenção. Retentativa sem essa conferência pode duplicar ações.

Hoje o procedimento é manual: `/status <id>` → `/motor claude` ou `/motor codex` → `/job <id> <continuação>`. A etapa completa continua aguardando aprovação.
