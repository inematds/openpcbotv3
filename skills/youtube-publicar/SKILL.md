---
name: youtube-publicar
description: Publica vídeo no YouTube — DIRETO (yt-pubx) ou pela FILA de uma instância yt-pub-lives ("fila do livesx", "fila do lives1"). Use quando o usuário pedir "publica esse vídeo no YouTube", "sobe no canal X", "coloca na fila do lives1/livesN/livesx", "agenda no YouTube", ou mandar MP4/URL de vídeo pedindo para ir ao canal. Texto e thumb saem do Codex (assinatura).
---

# Publicar no YouTube: direto ou pela fila

Duas rotas. **As duas começam igual**: gerar título, descrição, tags e thumb com o
**yt-pubx** (`~/projetos/yt-pubx/yt-pubx`) em `--dry-run`, e conferir.

| O usuário disse | Rota |
|---|---|
| "publica (direto) no YouTube", "sobe agora", "agenda pra <data>" | **Direto** → `yt-pubx publicar` |
| "coloca na fila do lives1 / livesN / livesx", "deixa na fila" | **Fila** → `enfileira.py` (pasta `imports/` da instância) |

Canal padrão: **lives1** (INEMA TDS). Outro só se o usuário disser (`livesN`).
Lista: `~/projetos/yt-pubx/yt-pubx canais`. "livesx" sem número = lives1.

## Passo 1 — gerar e conferir (sempre)

```bash
Y=~/projetos/yt-pubx/yt-pubx
$Y publicar <video.mp4|URL> --canal lives1 \
  --contexto "assunto + links oficiais (página do curso/projeto)" [--legenda video.srt] --dry-run
# imprime TÍTULO, DESCRIÇÃO, TAGS e "PLANO: ~/.local/share/yt-pubx/trabalhos/<pasta>/plano.json"
```

- Abra a `thumb.jpg` da pasta do plano e confira: frase legível, sem repetir a de outro vídeo do lote.
  Frase ruim → refaça só a composição: `--plano <plano.json> --frase-thumb "nova frase" --dry-run`
  (reaproveita a arte, não gera de novo).
- Vídeo grande ou lote: baixe para `/mnt/hd8t/...` (o `/` vive cheio) e passe o arquivo local.
- Vídeo vertical curto (até 3 min) vira Short: peça título com `#Shorts`.

## Passo 2a — DIRETO

```bash
$Y publicar <video.mp4> --canal lives1 --plano <plano.json>          # publica agora
$Y publicar <video.mp4> --canal lives1 --plano <plano.json> --agendar "2026-12-01 18:00"
```
Devolva ao usuário a URL e o link do Studio. Legenda: nos canais lives o token não tem o escopo
de legendas — o SRT só serve de contexto (a legenda vai pelo Studio).

## Passo 2b — FILA do yt-pub-lives

```bash
python3 ~/projetos/openpcbotv3/skills/youtube-publicar/enfileira.py <video.mp4> \
  --plano <plano.json> --canal lives1          # move o MP4 (use --copiar para manter o original)
```
- Cria `~/projetos/yt-pub-lives1/imports/<nome>/` com MP4 + `thumb.jpg` + `manifest.json`.
- O scheduler da instância importa na hora cheia e publica **1 vídeo por horário** de
  `import_pub_horarios` (no lives1: 07:00, 12:00, 18:00 → 3 por dia), na ordem de chegada.
- Para importar já: `cd ~/projetos/yt-pub-lives1 && python3 -c "import import_worker as w; print(w.process_imports())"`.
- Conferir a fila: `sqlite3 ~/projetos/yt-pub-lives1/data/lives.db "select video_id, clips_pendentes from lives where video_id like 'import_%' and clips_pendentes>0"`.

## Regras

- Texto e arte = Codex pela assinatura; nunca outra API de modelo ou de imagem.
- Antes de publicar/enfileirar um lote, conferir no `publicados` do canal se o vídeo já saiu
  (não duplicar).
- Não mexer em `config/`, `data/` nem `.env` das instâncias.
- Publicar é ação externa: só quando o usuário pediu publicar/enfileirar aquele vídeo.
