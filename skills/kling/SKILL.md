---
name: kling
description: Gera imagem e vídeo com o Kling AI pelo CLI oficial (conta Pro do Nei, já logada). Aceita imagem LOCAL no image-to-video (upload automático). Use quando o usuário citar "kling", pedir vídeo cinematográfico, animar uma foto com o Kling, ou personagem falando com áudio nativo. Toda geração é paga e não cancela — nada de job de teste.
---

# Kling AI

CLI oficial `@klingai/cli-global`, instalado em `~/.npm-global/bin/kling` e **logado**
(userId 3422648, plano Pro/SVIP, sem limite de tarefas concorrentes).

```bash
bash skills/kling/kling.sh ping                 # CLI + login + créditos
bash skills/kling/kling.sh modelos              # who_am_i: modelos e parâmetros de cada comando
bash skills/kling/kling.sh img "<prompt>"                        [--out DIR]
bash skills/kling/kling.sh t2v "<prompt>" [--seg 5|10] [--audio] [--model X]
bash skills/kling/kling.sh i2v "<prompt>" --img <arquivo|URL> [--fim <img>] [--seg 5|10] [--audio]
bash skills/kling/kling.sh status <generation_id>
```

## Regras que não se negocia

1. **Toda geração é cobrada e não cancela.** Não dispare job de teste. Na dúvida sobre um
   parâmetro, pergunte ao usuário antes de submeter.
2. **O servidor entrega 4K por padrão** — em vídeo e em imagem. O wrapper força barato: `720p` no
   vídeo (`--res`) e `1k` na imagem (`KLING_IMG_RES`). 1080p ou 4K só quando o usuário pedir
   explicitamente. Repare que o parâmetro tem nome diferente nos dois: `resolution` no vídeo,
   `img_resolution` na imagem.
3. **Personagem falando: prompt INTEIRO em PT-BR**, com a fala entre aspas. Prompt em inglês faz
   a boca articular errado. Isso é o oposto da regra do agnes-video, que exige inglês.
4. **`--audio` ligado quando houver fala.** O áudio nativo, mesmo ruim, é o guia de tempo da
   dublagem posterior com a voz do Nei.
5. **As URLs de resultado expiram em 24h.** Baixe na hora. O wrapper já salva a resposta crua em
   JSON antes de qualquer parse, porque job pago com id perdido é crédito perdido.

## i2v aceita arquivo local

Diferente da maioria, o CLI faz upload sozinho: `--img /caminho/foto.png` funciona. Foto que chega
pelo Telegram pode ir direto. Imagem precisa ser PNG/JPG, abaixo de 4K, ≤30MB, proporção não mais
estreita que 1:2.

## Escolha do modelo e o limite de duração

Em vídeo, sem `--model` o wrapper usa **`kling-video-v3_0_omni`** (`KLING_VIDEO_MODEL` muda).
Motivo: o flag `--omni` do CLI resolve para `kling-video-o1`, que **trava em 10s** e recusa
`--seg 15` com HTTP 400.

| Modelo | Duração máxima |
|---|---|
| `kling-video-v2_5`, `kling-video-v2_6` | só 5 ou 10 |
| `kling-video-o1` | 3 a 10 |
| `kling-video-v3_0`, `v3_0_omni`, `v3_0_turbo` | 3 a 15 |

**Nenhum modelo passa de 15s por geração.** Vídeo mais longo é montagem de vários clipes.
Para escolher outro, rode `modelos` e passe o nome canônico — não invente nome nem valor.

## Onde está o resto

- `~/projetos/klingaimcp` — guia operacional do MCP/CLI, modelos, limites e créditos.
- `~/projetos/klingai-nei` — defaults pessoais e o pipeline de **dublagem timeada** (`scripts/dub3.py`):
  o Kling não aceita áudio de entrada, então lip-sync com a voz do Nei é dublagem por cima, guiada
  pelos timestamps do áudio nativo.

## Saída

`~/projetos/output/klingaimcp/` por padrão (`KLING_OUT_DIR` muda). Para entregar no Telegram, use
`[SEND_FILE:/caminho/arquivo.mp4]`.
