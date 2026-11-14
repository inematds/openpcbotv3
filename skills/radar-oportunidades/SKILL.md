---
name: radar-oportunidades
description: Aprova as pautas do "📡 Radar de oportunidades" (lista diária das 08:15 com o que bomba no YouTube → kit + vídeos). Use quando o Nei responder a essa mensagem com "faz 1", "faz 1 3", "faz todas", "nenhum", ou perguntar "como está o radar / as pautas de hoje".
---

# Radar de oportunidades — aprovação do Nei

A mensagem "📡 Radar de oportunidades dd/mm/aaaa — N pauta(s)" chega todo dia às 08:15 (timer
`radar-oportunidades`). Cada pauta tem número. A resposta do Nei é o OK de TODA a produção daquela pauta
(kit + guia + portal + Telegram + vídeo 16:9 + Shorts + Metricool), sem pedir de novo.

Script: `python3 ~/projetos/wifi/radar-oportunidades/oportunidades.py`

| O Nei disse | Rode |
|---|---|
| "faz 1", "faz 1 e 3", "faz a 2" | `... aprovar 1 3` (sem data = lista mais recente) |
| "faz todas", "faz tudo" | `... aprovar <data> <todos os números da mensagem>` |
| "nenhum", "nenhuma", "pula hoje" | `... nenhum <data>` |
| "como está o radar", "e as pautas?" | `... status [<data>]` |

- `<data>` = a data da mensagem a que ele respondeu (AAAA-MM-DD). A própria mensagem traz a linha
  "(v3: aprovar = ... aprovar AAAA-MM-DD <números>)". Sem resposta a uma mensagem específica, use a de hoje.
- Responda curto com o que o script imprimiu ("lançado 1) slug (unit …)"). O script já avisa e é idempotente:
  repetir "faz 1" não lança de novo.
- Número que não existe na lista: diga quais existem; não invente pauta.
- Não lance sessão, não edite BRIEF nem COMUM à mão: só o script.
- Se ele pedir para mudar a régua (cortes, teto, canais por assunto): o arquivo é
  `~/projetos/wifi/radar-oportunidades/regua.json`; mude só o que ele pediu e diga o antes → depois.
