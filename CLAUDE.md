# CLAUDE.md — openpcbotv3

Sucessor do `~/projetos/openpcbotv2`, rodando **ao lado** dele. Plano e arquitetura alvo em
[PLANO-MIGRACAO-V3.md](PLANO-MIGRACAO-V3.md); estado por fase em [CHANGELOG.md](CHANGELOG.md);
como operar em [README.md](README.md).

Estado (2026-09-06): **fases 0–7 no ar** como `systemctl --user` `openpcbotv3` (porta 3142).
Fase 8 (corte) **não** começa sem ordem explícita. O v2 (`openpcbot`) continua em produção.

## Regras herdadas do v2 e do hub `wifi`

- Nunca gerar mídia paga (HeyGen, render, etc.) sem confirmação explícita no momento.
- Ollama só via o serviço systemd (HTTP na 11434). Nunca `ollama serve` paralelo.
- Toda chamada de LLM passa por `src/custo/gateway.ts`. Sem exceção.
- Nenhum módulo em `src/` acima de 500 linhas.
- Falha real → uma linha em `FALHAS.md` antes da próxima tarefa.

## Regras da coexistência com o v2 (até o corte)

- **Token do Telegram é próprio** (`TELEGRAM_BOT_TOKEN_V3`). O do v2 é recusado no boot. Nunca chamar `getUpdates` com token em uso.
- **Mesmas tags de modelo do v2** em `config/ollama.yaml` (`qwen3.8:27b`, `llama3.2`, `bge-m3`). Mudar a tag do `geral` = dois modelões residentes = OOM.
- **Nunca descarregar modelo que o v3 não carregou** (`descarregar_alheios: false`). Tier `pesado` fica desligado.
- **Banco próprio** (`store/openpcbotv3.db`). O banco do v2 só é lido por snapshot (`src/cli/importar.ts`).
- **WhatsApp e Slack desligados** aqui: o v2 é dono da sessão e do token.
- Restart: `bash scripts/instalar-servico.sh` (rebuild + `systemctl --user restart openpcbotv3`). Sem sudo.
- Diagnóstico: `npm run doctor`; logs `journalctl --user -u openpcbotv3 -n 50 --no-pager -o cat`.

## Git

Remote `inematds/openpcbotv3`; autor `inematds <inematds@gmail.com>` (regra global). Commit por fase; push no fim.

## Self-learning

When I correct you, or you catch yourself making a mistake: before continuing, add the lesson as a one-line rule under ## Lessons, so it never happens again.

## Lessons

- `keep_alive` do Ollama: `-1` é número, não string; durações são `"10m"`. Validar contra a API antes de assumir o formato do plano.
- Em `execSync('pgrep -f ...')` o próprio `sh -c` entra na contagem; usar `pgrep -x` ou filtrar. `grep -c` sem match sai com código 1: `|| true`.
