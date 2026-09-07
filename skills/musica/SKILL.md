# musica — clonar ou criar música (Kie / Suno)

> O código canônico vive em `~/projetos/musicaclone` (repo `inematds/musicaclone`,
> guia em https://inematds.github.io/musicaclone/guia/). Os arquivos aqui são
> symlinks — editar um edita o outro; commitar é no repo musicaclone.


Dois fluxos **diferentes**, não misture:

- **CLONE** — parte de um link/áudio existente. Usa o áudio original como
  referência (`upload-cover`). Mantém melodia e estrutura, refaz a produção.
- **CRIAÇÃO** — parte de uma ideia/estilo/letra, sem referência (`generate`).

Nunca gerar sem passar pelo portão (`spec`) e ter o ok do Nei. Geração gasta
crédito.

## Comandos

```bash
S=/home/nmaldaner/projetos/openpcbotv2/skills/musica/musica.sh

# CLONE
bash $S prep <url> [slug]      # resolve link + baixa áudio + analisa (Gemini)
bash $S spec <slug>            # o portão: mostra fonte, estilo, letra, avisos
bash $S clone <slug> [flags]   # gera (só depois do ok)

# CRIAÇÃO
bash $S cria <slug> --style "epic viking pop, war drums, male gang vocals" \
                    --title "Viking Gods" --letra /caminho/letra.txt
bash $S regen <slug>           # gera / regera com os ajustes do spec

# comuns
bash $S status <slug|taskId>
bash $S get <slug|taskId>      # baixa as faixas (URL do Suno expira!)
bash $S saldo                  # créditos Kie
```

Saída em `~/projetos/output/musicas/<slug>/`: `ref.mp3`, `analise.json`,
`spec.json` (estado + taskId + custo medido), `faixa-1.mp3`, `faixa-2.mp3`.

## Fluxo que o bot deve seguir

1. `prep` (ou `cria`). 2. mostrar `spec` no Telegram. 3. esperar o ok.
4. `clone`/`regen` → devolver o `taskId` na hora. 5. `status` até `SUCCESS`.
6. `get` e mandar os MP3 por `[SEND_FILE:...]`.

Tarefa longa: `scripts/notify.sh` nos checkpoints.

## Portões que existem por um motivo

- **É música?** O Gemini classifica antes de qualquer coisa. Fala/entrevista/
  narração → `bloqueado`, não gera. (Foi o que faltou nas 3 tentativas antigas.)
- **A letra está completa?** Voz cantada corta fácil na transcrição. Se
  `letra_completa: false`, o portão avisa — não gerar em cima de letra pela
  metade. Colar a letra oficial e `--letra arquivo.txt`.
- **Trecho curto?** Link de rede social costuma ser teaser. O `spec` mostra a
  duração da fonte: 29 s não é a música, é um pedaço. Pegar o link da música
  inteira (a descrição do post geralmente tem — `push.fm`, Spotify, YouTube).

## Formatos e ajustes (o que dá pra mexer)

Modelos: `V4`, `V4_5`, `V4_5PLUS`, `V4_5ALL`, `V5` (default), `V5_5`.
Limites: V4 → prompt 3000 / style 200. Os demais → prompt 5000 / style 1000.
`title` 80 (100 em V5/V4.5 no cover). `duration` só existe em `V5_5`.

| Flag | O que faz | Quando mexer |
|---|---|---|
| `--style "tags"` | as tags de som (gênero, instrumentos, produção, vocal, andamento) | sempre que o timbre sair errado |
| `--negative "tags"` | o que evitar | saiu acústico e você queria pesado |
| `--voz m\|f` | gênero do vocal | vocal saiu trocado |
| `--style-weight 0-1` | adesão ao estilo descrito (0.7 default) | subir se ignorou o estilo |
| `--audio-weight 0-1` | (só clone) quanto puxa a referência (0.65 default) | 0.85–0.95 = mais colado no original; 0.4 = só inspirado |
| `--weirdness 0-1` | desvio criativo | subir pra fugir do óbvio |
| `--instrumental` | sem vocal | trilha/BGM |
| `--duration N` | duração alvo (só `V5_5`) | precisa caber num vídeo |
| `--sem-referencia` | clone vira recriação só por estilo | referência ruim, longa (>8 min) ou upload falhou |

**Estilo bom = tags curtas em inglês, separadas por vírgula.** Ex.:
`nordic folk metal, epic, male gang vocals, war drums, low brass, 140bpm,
cinematic production`. Frase corrida funciona pior que tags.

**Letra** vai em `prompt`, com marcadores de estrutura: `[Verse]`, `[Chorus]`,
`[Bridge]`, `[Outro]`.

Depois de um resultado bom dá pra criar uma **persona** (voz/estilo reutilizável)
a partir do `taskId` + `audioId` e usar `personaId` nas próximas. Ainda não
implementado no script, e **o endpoint não está confirmado** — só vi a página de
doc (`docs.kie.ai/suno-api/generate-persona`); conferir o path real antes de usar.

## API (verificado em 2026-08-05)

Auth `Authorization: Bearer $KIE_API_KEY` (lida em runtime de
`~/projetos/wifi/.env`, nunca copiar/imprimir).

| O quê | Endpoint |
|---|---|
| criar do zero | `POST https://api.kie.ai/api/v1/generate` |
| clone com referência | `POST https://api.kie.ai/api/v1/generate/upload-cover` |
| status/resultado | `GET .../api/v1/generate/record-info?taskId=` |
| créditos | `GET .../api/v1/chat/credit` |
| upload do áudio | `POST https://kieai.redpandaai.co/api/file-stream-upload` |

Assíncrono: POST devolve `taskId`, poll `record-info` até `status: SUCCESS`,
`data.response.sunoData[]` traz `audioUrl` (2 variantes por geração).
Referência: **máx 8 min**. Arquivo enviado some em 24 h; faixa gerada, em 15
dias. **Baixar na hora.**

## Custos (medido + mercado, 2026-08)

- **Kie/Suno** — o script mede sozinho: grava o saldo antes de gerar e o custo
  real em `spec.json` (`creditos_gastos`) quando você roda `get`. Saldo atual
  da conta: `bash musica.sh saldo`. **Medido em 2026-08-05: 12 créditos por
  geração** (V5, custom mode, 2 faixas de ~3 min). A ~US$ 0,005/crédito dá
  **~US$ 0,06 por geração**, ou ~US$ 0,03 por faixa utilizável. O Kie não
  publica o preço por chamada — esse número saiu da medição real
  (`creditos_gastos` no `spec.json`), não de tabela de terceiro.
- **Suno direto** (assinatura, sem API oficial): 5 créditos por música;
  Pro US$ 10/mês = 2.500 créditos ≈ 500 músicas (~US$ 0,02/música); Premier
  US$ 30/mês = 10.000 créditos.
- **ElevenLabs Music**: cobra por **minuto gerado**, ~US$ 0,30–0,40/min. Uma
  música de 3 min ≈ US$ 1,00–1,20 — ~17–20× o custo medido no Kie. Vantagem dele é
  edição por seção e licenciamento; não faz cover de referência.
- **Udio**: crédito por geração, sem API pública madura. Standard US$ 10/mês =
  2.400 créditos; ~1 crédito por trecho de até 32 s. Só web, ruim pra pipeline.

**Conclusão pra este projeto:** Kie/Suno ganha por ser o único dos três com
API de **cover a partir de áudio de referência** (o "clonar" de verdade) e por
custar ~1/20 do ElevenLabs por faixa. ElevenLabs só se o caso for trilha
instrumental limpa com licença comercial explícita.

## Onde furou antes (não repetir)

Link do Facebook caía no auto-trigger genérico do inemaVOX (transcrever), sem
checar se era música e sem checar se a letra estava inteira. O exemplo real
(`Viking Gods` / Bob Dominator) é um teaser de **29 s** com 75 palavras — gerar
em cima disso produz exatamente o resultado inconsistente que apareceu.
