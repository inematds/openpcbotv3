# CLAUDE.md — openpcbotv3

Sucessor do `~/projetos/openpcbotv2`. Plano de migração e arquitetura alvo em
[PLANO-MIGRACAO-V3.md](PLANO-MIGRACAO-V3.md) — ler antes de codar qualquer fase.

Estado: **fase 0 não iniciada** (2026-09-01). Só existe o plano.

## Regras herdadas do v2 e do hub `wifi`

- Nunca gerar mídia paga (HeyGen, render, etc.) sem confirmação explícita no momento.
- Ollama só via o serviço systemd (HTTP na 11434). Nunca `ollama serve` paralelo.
- Toda chamada de LLM passa pelo módulo de custo. Sem exceção.
- Nenhum módulo em `src/` acima de 500 linhas.
- Falha real → uma linha em `FALHAS.md` antes da próxima tarefa.

## Self-learning

When I correct you, or you catch yourself making a mistake: before continuing, add the lesson as a one-line rule under ## Lessons, so it never happens again.

## Lessons

- (vazio)
