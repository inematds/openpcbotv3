---
name: agnes-video
description: Gera IMAGEM e VÍDEO com a API Agnes AI (custo US$ 0) através do pipeline em ~/projetos/videos-agnes. Use quando o usuário pedir "faz um vídeo disso", "anima essa imagem", "gera uma imagem", "vídeo com agnes", "filme dessa história", ou mandar uma foto pedindo movimento/animação. NÃO é análise de imagem (isso é Gemini) — é geração.
---

# Agnes Video

Ponte para o pipeline `~/projetos/videos-agnes`. Imagem via `agnes-image-2.1-flash`,
vídeo via `agnes-video-v2.0` em modo keyframes.

```bash
bash skills/agnes-video/agnes.sh ping
bash skills/agnes-video/agnes.sh imagem "a red fox in a snowy forest, cinematic" [dest.png] [--ref url_ou_png]
bash skills/agnes-video/agnes.sh clipe <img_a.png> "camera pushes in slowly" [segundos] [--para img_b.png] [--out dest.mp4]
bash skills/agnes-video/agnes.sh filme <historia>
bash skills/agnes-video/agnes.sh historias
```

## Quando usar cada subcomando

- **`imagem`** — o usuário quer uma imagem gerada, ou uma variação de uma imagem que mandou (`--ref`).
- **`clipe`** — o usuário mandou UMA foto e quer movimento/animação. É o caso mais comum vindo do
  Telegram: a foto vira o keyframe inicial e o prompt descreve o movimento.
- **`filme`** — história completa narrada. Exige um arquivo `historias/<nome>.py` no projeto; não dá
  pra improvisar a partir de uma mensagem de chat. Se o usuário quiser um filme novo, avise que a
  história precisa ser escrita primeiro e ofereça o `clipe` como caminho curto.

## Regras que a API impõe (aprendidas na prática)

1. **Prompt em INGLÊS.** Em português a API bloqueia conteúdo legítimo com HTTP 400. Traduza antes.
2. **No máximo 2 referências** por imagem. Três ou mais destroem a saída.
3. **Rate limit de vídeo: 5 requisições por minuto** (HTTP 429). Não dispare clipes em paralelo.
4. Descritor de estilo só com estética — palavras como `fur` ou `expressive eyes` injetam
   personagem em prompt de cenário.
5. Imagem em 1K sai em ~32s; 4K custa ~150s e falha muito.
6. ~34% das chamadas de imagem voltam 503; o wrapper já faz retry com backoff.

## Saída

Vai para `~/projetos/output/agnes-bot/` por padrão (`AGNES_OUT_DIR` muda). Para mandar no Telegram,
use o marcador `[SEND_FILE:/caminho/arquivo.mp4]` na resposta.

## Pré-requisitos

A chave fica em `~/projetos/agnes-nei/.env` (`AGNES_API_KEY`) e o pipeline em
`~/projetos/videos-agnes`. O `ping` confere os dois. Nada disso é instalado pelo bot.
