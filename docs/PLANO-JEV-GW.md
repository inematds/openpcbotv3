# Plano — jev-gw no openpcbotv3

Status: **proposta** (2026-09-25). Nada implementado. Alvo: v3 3.4.4 → **3.5.4** (o 3.4.4 foi o histórico/relatórios). O v2 não é alterado.

## 1. Situação atual

O v3 3.3.4 já tem Jev nativo em TypeScript (`docs/JEV.md`):
`ObservadorJev` → `GatewayLLM.decidirJev` → `src/provedores/jev.ts` → OpenRouter `/api/alpha/decisions`.

O que o jev-gw (`~/projetos/jev-gw`, Python, porta 8770) oferece, comparado com o que o v3 já tem:

| Garantia jev-gw | No v3 hoje | O que falta |
|---|---|---|
| Orçamento | `orcamento.avaliar('barato')`, compartilhado com todo o tier barato | teto **só do Jev** |
| Registro | `chamadas_llm` (`/usage`) | — |
| Falha conservadora | `ObservadorJev` captura o erro e mantém a rota | — |
| Timeout | 3 s, sem retry | retry em 429/5xx |
| Cache 15 min (SHA-256 do pedido) | não | ganho pequeno no roteamento (mensagens idênticas são raras) |
| Política (`policy`: rótulos `incerto/insuficiente…`, `sensivel`) | limiar 0,9 escrito dentro do `jev.ts` | política reutilizável |
| **Porta única + teto único entre sistemas INEMA** | não existe | **esse é o ganho real** |
| Painel `/painel` | não | — |

Conclusão: pro roteamento sozinho o jev-gw acrescenta pouco. Ele compensa se o Jev for usado **por vários
sistemas** (v3, jev-open, n8n, scripts) e você quiser **um gasto diário só** e um registro só.

## 2. Contrato verificado (Fase 0 já feita na leitura)

- `validate_request` do jev-gw aceita o pedido do v3: `state` como objeto ✔, perguntas `choice` com 2–255 opções ✔.
- Exige `model` → o v3 manda `~typesafe/jev-latest`; com esse prefixo o jev-gw escolhe `openrouter` sozinho ✔.
- `timeoutMs` do v3 **não** vai no corpo (é só do cliente) ✔.
- A saída do jev-gw traz a resposta crua do Jev em `resposta` (com `usage.cost` sem arredondamento) → o v3
  pode rodar o seu próprio `validarRespostaJev` nela e usar o custo exato. O `custo_usd` do jev-gw (8 casas) não é usado.
- **Problema:** retries estão fixos em 3 (`range(3)` em `vendor/jev_core.py`), com backoff, e `JEV_GW_TIMEOUT` padrão 5 s.
  O `ObservadorJev` segura uma vaga em voo; no pior caso ela fica presa por mais de 15 s. Precisa de ajuste no jev-gw (Fase 1).
- jev-gw **não** está rodando como serviço hoje (nenhuma unit, porta 8770 livre). Há registro de 22/09 em `~/.jev-gw`.

## 3. Opções

**A — jev-gw como provedor por trás do `GatewayLLM.decidirJev` (recomendada, opt-in)**
Novo adaptador `src/provedores/jev-gw.ts` faz POST em `127.0.0.1:8770/decidir`. Escolha por config
(`jev.backend: openrouter | jev-gw`), **padrão continua `openrouter`**. jev-gw roda como segundo `systemctl --user`.
- Ganha: teto e registro únicos entre sistemas, cache, retry, painel.
- Custa: um processo Python a mais pra manter; contabilidade em dois lugares (v3 + JSONL do jev-gw); reverte a
  decisão "sem subprocesso Python" registrada em `docs/JEV.md` e no `CLAUDE.md`.

**B — portar as ideias pra TS, sem jev-gw**
Acrescentar no próprio `decidirJev`: teto diário só do Jev, 1 retry em 429/5xx, cache opcional em memória/SQLite,
e extrair `politicaJev()` (limiar, rótulos de abstenção, `sensivel`). Nenhum processo novo, nada revertido.
Não dá o teto compartilhado entre sistemas.

## 4. Regras que valem em qualquer opção

1. `GatewayLLM.decidirJev` continua a **única** porta. O jev-gw é provedor atrás dela; nunca chamado do `ObservadorJev`,
   de script ou de skill.
2. O orçamento do v3 (`barato`) roda **primeiro** e manda. `JEV_GW_TETO_DIARIO` é uma segunda rede, não substitui.
3. Custo sempre em `chamadas_llm` (e portanto em `/usage`):
   - `origem=api` → `usage.cost` da resposta crua, `ok:true`
   - `origem=cache` → custo 0, `motivoTier` "cache jev-gw", `ok:true`
   - `acao=review` com `origem=erro|bloqueado` → `ok:false`, "custo não confirmado" (igual a hoje)
4. `redigir()` continua rodando no v3 antes de qualquer coisa sair do processo.
5. Chave: a unit do jev-gw usa `EnvironmentFile=` apontando pro `.env` que já existe, com `JEV_PROVIDER=openrouter`.
   Nunca copiar a chave.
6. Observação continua sem efeito: a sugestão não muda rota, prompt nem permissão.

## 5. Fases (opção A)

**Fase 1 — ajuste no jev-gw** (repo `inematds/jev-gw`, commit próprio)
- `JEV_GW_TENTATIVAS` (padrão 3; o v3 usa 1) repassado ao `evaluate`.
- Teste novo na suíte (sem gastar crédito). Sincronizar nota em `ARQUITETURA.md §8`.

**Fase 2 — provedor TS** (`src/provedores/jev-gw.ts`, < 150 linhas)
- POST `/decidir` com `{model, state, questions}`, timeout do cliente 3,5 s (AbortController, igual ao `jev.ts`).
- HTTP 200 + `acao=suggest|review` com `resposta` → `validarRespostaJev(p, resposta)`.
- HTTP 200 sem `resposta` (bloqueado/erro) → erro `Jev: jev-gw recusou (<origem>)`.
- 400/413/422 → erro de contrato; conexão recusada → `Jev: jev-gw indisponível`.
- `RespostaJev` ganha `origem?: 'api' | 'cache'`.
- Testes com `fetch` falso (padrão do `jev.test.ts`): suggest, review com resposta, bloqueado, 422, porta fechada, cache → custo 0.

**Fase 3 — seleção no gateway + comando**
- `config`: `JEV_BACKEND=openrouter|jev-gw`, `JEV_GW_URL=http://127.0.0.1:8770`.
- `decidirJev` escolhe o adaptador; registro usa `provedor:'jev-gw'` quando for o caso.
- `/jev` mostra backend e `origem` da última comparação; `npm run doctor` checa `GET /saude` do jev-gw quando selecionado.
- **Sem fallback silencioso** pro OpenRouter direto se o jev-gw cair: vira `review`, rota preservada.
  (Fallback direto furaria o teto compartilhado, que é o motivo de usar o jev-gw.)

**Fase 4 — serviço**
- `scripts/instalar-jev-gw.sh`: unit `jev-gw.service` (`--user`), `WorkingDirectory=~/projetos/jev-gw`,
  `ExecStart=python3 -m jev_gw servir`, `EnvironmentFile=` do `.env` existente, `JEV_GW_TIMEOUT=2.5`,
  `JEV_GW_TENTATIVAS=1`, `JEV_GW_TETO_DIARIO` a definir, host só `127.0.0.1`.
- Smoke: `npm run jev -- teste` duas vezes com `JEV_BACKEND=jev-gw`. Esperado: 1ª ~US$ 0,00007 `origem=api`;
  2ª `origem=cache`, US$ 0. Conferir `/usage` e `http://127.0.0.1:8770/painel`.

**Fase 5 — docs, versão, push**
- `3.4.4 → 3.5.4` em `package.json`, `APP_VERSION`, CHANGELOG, README.
- `docs/JEV.md`: seção "Backend jev-gw"; corrigir a frase "sem subprocesso Python" (vale só pro backend padrão).
- `CLAUDE.md` seção Jev: "jev-gw só como provedor atrás de `decidirJev`".
- Commit por fase, push no fim, autor `inematds <inematds@gmail.com>`.

## 6. Critério de pronto

- Todos os testes passam (hoje 202 + os novos); nenhum módulo acima de 500 linhas.
- Com `JEV_BACKEND=openrouter` o comportamento é idêntico ao 3.4.4.
- Com `jev-gw`: smoke real registrado, cache confirmado, custo em `/usage`, `/jev` mostra `origem`.
- jev-gw parado → atendimento normal, `/jev` mostra "indisponível", rota preservada.
- v2 intocado.

## 7. Decisões pendentes (suas)

1. **A ou B?** A só compensa se outros sistemas também vão consultar o Jev pelo jev-gw.
2. **Teto compartilhado?** Se sim, `JEV_GW_DADOS` fica no padrão `~/.jev-gw` e todo sistema aponta pra mesma instância.
   Qual valor de `JEV_GW_TETO_DIARIO` (padrão US$ 1,00/dia)?
3. **Depois da observação:** o jev-gw também abre caminho pra usar o Jev em outras decisões do bot
   (triagem de e-mail do conector Gmail, escolha de skill), mas isso é outro plano e continuaria em modo observação.
