# Jev no openpcbotv3

A versão 3.3.4 acrescenta comparação de roteamento com Jev pelo OpenRouter. A integração é nativa em TypeScript, sem subprocesso Python e sem dependência do clone Jev para operar.

## Usar

No chat do bot:

- `/jev observar`: ativa para esse chat.
- `/jev`: mostra modo e última comparação.
- `/jev off`: desliga novas consultas.
- `/usage`: inclui o custo sob o agente `jev-roteador`.

No terminal do projeto:

```bash
npm run jev -- status
npm run jev -- observar
npm run jev -- off
npm run jev -- teste
```

Os três primeiros comandos usam o chat principal configurado, ou `http` quando não houver. `teste` consulta um exemplo fictício em escopo separado, compara com uma referência manual e registra custo real. Não liga os canais, não envia mensagem ao Telegram e não executa agentes ou ferramentas.

Novas instalações começam desligadas. A preferência é persistida em SQLite e pode ser alterada sem reiniciar.

## Histórico e relatórios (3.4.4)

Cada observação (acerto ou erro) vira uma linha em `jev_comparacoes`: chat, trace, rota atual, sugestão, skill, confidence,
probabilidades, revisar, concorda, custo, latência e erro. **O texto da mensagem não é guardado.**

- `/jev historico [n]`: totais acumulados e as últimas n comparações (padrão 10, máximo 50).
- `/jev relatorio dia` / `/jev relatorio semana`: últimas 24 h ou 7 dias — concordância com o roteador, quantas o Jev
  respondeu confiante (rota e skill ≥ 0,9), divergências com Jev confiante (as que valem revisar), pares de divergência
  mais comuns, skills sugeridas, custo e latência média.
- Crons `jev-relatorio-diario` (`5 8 * * *`) e `jev-relatorio-semanal` (`10 8 * * 1`), fuso America/Sao_Paulo, entregam
  no chat principal. Desligar: `/cron off jev-relatorio-diario`.
- Terminal: `npm run jev -- historico 20`, `npm run jev -- relatorio semana`.

Comparações anteriores à 3.4.4 não existem no histórico: só a última ficava em `prefs`.

## O que acontece

1. O roteador existente escolhe rota, agente e tier.
2. Se habilitado, Jev recebe em segundo plano a mensagem atual (até 4.000 caracteres) e critérios derivados dos agentes/skills cadastrados.
3. Responde duas perguntas Choice: rota sugerida (`direto`, `agente:<id>` ou `incerto`) e skill sugerida (`skill:<id>`, `nenhuma` ou `incerto`). Skills em rascunho não entram.
4. O bot registra modelo, confidence, probabilidades selecionadas, custo, latência e concordância com a rota existente.
5. A resposta ao usuário e o dispatcher continuam usando exclusivamente o roteador atual. A sugestão Jev não entra no prompt do agente, não concede permissões nem executa a skill.

A observação inicia depois da escolha da rota, sem aguardar o resultado Jev para responder. Falhas não bloqueiam o atendimento. Interromper uma conversa ou desligar observação não cancela uma consulta Jev já iniciada; ela pode terminar em até o timeout configurado.

## Limites e dados

- Uma consulta Jev em voo por processo, sem fila adicional; intervalo mínimo de 15 segundos por chat. Eventos excedentes são ignorados, não reprocessados.
- Timeout de 3 segundos, sem retries automáticos.
- Até 60 KB locais de request e 255 opções por pergunta. Catálogo maior é recusado, sem truncar silenciosamente os candidatos.
- Mensagens com menos de 12 caracteres e comandos não são observados. Canais em modo somente observação de memória não passam por este caminho.
- Não envia histórico, memória, prompts de agentes, arquivos ou credenciais. Envia a mensagem atual e descrições do catálogo ao OpenRouter; detecção de segredo conhecido impede a consulta. Esse filtro não detecta todo dado pessoal possível.
- O registro de comparação guarda o último resultado por chat (para `/jev`) e, desde a 3.4.4, o histórico em `jev_comparacoes`, sem copiar a mensagem. O custo de todas as tentativas efetivamente iniciadas fica em `chamadas_llm`.
- Limiar didático de 0,9 para confidence e probabilidade selecionada, nas duas perguntas. Não há alegação de calibração. `revisar=false` não habilita ação automática.

## Gateway e orçamento

Toda chamada passa por `GatewayLLM.decidirJev`, verifica o orçamento `barato` e só então chama o provedor. Com orçamento esgotado ou chave ausente, preserva a rota atual. Não converte decisões em chamadas de chat ou fallback para outro modelo.

Endpoint: `https://openrouter.ai/api/alpha/decisions`. Modelo solicitado: `~typesafe/jev-latest`; o modelo resolvido é registrado. A chave `OPENROUTER_API_KEY` vem do carregamento de ambiente já existente, sem duplicação.

Custo válido de `usage.cost` é preservado sem arredondamento adicional. Se a chamada falha antes de uma resposta validada, o registro legado mantém custo numérico zero e a mensagem **custo não confirmado**; a comparação usa `custoUsd: null`. Esses zeros não comprovam gratuidade; confira o faturamento do provedor para conciliação.

## Verificação desta entrega

202 testes passaram, incluindo timeout, contrato, IDs inválidos, orçamento, redacção de segredos, isolamento por chat, frequência, exclusão de rascunhos, falha e preservação da decisão atual.

Uma chamada real pelo próprio gateway do bot respondeu `direto` e `nenhuma`, de acordo com o exemplo fictício. Modelo `typesafe/jev-1.13-20260917`, custo US$ 0,000068418, latência 619 ms. Isso valida conectividade e contabilização, não qualidade geral de roteamento.

Referências: [Jev no OpenRouter](https://openrouter.ai/~typesafe/jev-latest/api), [laboratório e dez pacotes](https://github.com/inematds/jev/tree/main/pacotes).

## Estado operacional verificado

Em 19/09/2026, o serviço foi atualizado via scripts/instalar-servico.sh. Health retornou ok e versão 3.3.4. A fila não tinha jobs running/queued antes do restart. A observação foi ativada no chat principal via CLI local; /jev respondeu pelo HTTP do serviço. Nenhuma mensagem de teste foi enviada ao Telegram. O v2 foi preservado.
