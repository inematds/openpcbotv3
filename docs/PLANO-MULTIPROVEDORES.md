# Openpcbotv3 — etapas de adaptação multiprovedor

## Decisão do usuário (15/11/2026)

Adaptar primeiro para Codex pela assinatura e preparar a base da versão completa. Salvar tudo para continuar em nova sessão. A implementação completa exige aprovação posterior do usuário. Se for necessário apoio do Astra, perguntar antes; não acioná-lo automaticamente. Não usar o v2 como alvo desta adaptação.

## Etapa 1 — escopo autorizado

- Motor padrão Codex, modelo `gpt-6.1-sol`, esforço `medium`; Claude selecionável por chat.
- Perfis congelados por job, sessões nativas separadas e contexto recente ao trocar.
- Executores pelo gateway, protocolo de resposta e uso do Codex, ambiente de assinatura e limites de processo.
- Preservar fila SQLite, canais, cancelamento e os dados existentes; nenhuma nova API habilitada.
- Critério de pronto: typecheck + suíte, teste real com arquivo e retomada, serviço atualizado e prova local do worker em produção.

Etapa 1 implementada e ativada em 15/11/2026, versão 3.36.17. Prova no worker instalado: job 119999. Operação, evidências e limites: `docs/MOTORES-ASSINATURA.md`.

## Etapa 2 — proposta completa, NÃO autorizada para implementar

### 2A. Continuidade e troca entre assinaturas

1. Criar registro durável de tarefa: pedido, decisões, arquivos, etapas concluídas, próximo passo e efeitos externos com identificador.
2. Registrar o progresso durante a execução, sem depender de resumo feito pelo motor já sem cota.
3. Classificar cota, indisponibilidade, autenticação e erro da tarefa. Suspender temporariamente o motor indisponível.
4. Selecionar alternativa somente se tiver as capacidades necessárias. Troca automática antes de efeitos; em execução parcial, conferir estado antes de retomar.
5. Confirmar resultado externo antes de repetir publicação, envio ou geração. Estado incerto deve parar para reconciliação.
6. Adaptar resumos, observação de atividade e conectores para os motores suportados. Preservar cancelamento, propriedade do job e `/novo`.

Portão: simular cota Claude → Codex; reiniciar durante execução; cancelar; alternar motores; simular efeito externo concluído seguido de queda. Nenhum teste pode duplicar o efeito. Testes reais somente em alvos isolados, sem publicar para comprovar troca.

### 2B. Configuração por função e capacidades

- Separar conversa, roteamento, agente executor, especialista, resumo e memória. Configuração comentada por função, com validação local e alterações atômicas que preservem comentários.
- Modelo/esforço explícitos e matriz de capacidades: shell, arquivos, visão, navegador, imagem, conectores. Recusar combinação incompatível.
- Definir como os níveis centrais do ecossistema se relacionam com a configuração própria do bot; não mudar defaults globais.
- Mostrar motor efetivo, tentativas e motivo de troca no uso/painel, sem expor credenciais ou raciocínio privado.

### 2C. APIs como executores (aprovação separada)

Os adaptadores atuais Anthropic/OpenRouter são de mensagens. Para executar tarefas faltam o ciclo de ferramentas, autorização das operações, devolução de resultados e limites. OpenAI direto também exige adaptação própria. Implementar autorização por serviço/função ANTES de ler credencial ou conectar; não copiar autorização do gitbombando.

Permissões: APIs de modelo/serviço novas continuam desativadas até autorização explícita com finalidade. Pedido de implementação da etapa 2A/2B não autoriza consumo de API. CLIs continuam exclusivamente pela assinatura. Astra para apoio também depende de perguntar ao usuário.

## Ordem proposta para a próxima sessão

1. Ler o handoff exato e conferir o serviço/configuração da etapa 1.
2. Apresentar o escopo 2A/2B e pedir aprovação antes de editar; discutir 2C separadamente.
3. Se aprovado, começar pelo registro de progresso e testes de efeitos externos; depois habilitar a troca automática controlada.

## Preservação de trabalho alheio

Já existiam alterações em `agents/comms/CLAUDE.md`, `config/ollama.yaml`, `evolution/docker-compose.yml`, `src/painel/fontes/producao.ts` e `docs/projetos-n8n/`. Não são parte desta adaptação e não devem entrar nos commits dela. Não reiniciar Evolution, não alterar v2, não mudar modelos do Ollama.


## Trava de cota (3.37.17, 17/11/2026)

Implementada a parte de *detectar a recusa explícita por limite e marcar o motor como indisponível*, compartilhada com os crons (`src/fila/cota.ts`, tabela `pools` do EngineBridge). A troca automática para a alternativa continua proposta: hoje o job falha com mensagem clara e o Nei troca com `/motor`.
