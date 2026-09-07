#!/usr/bin/env bash
# Ponte para o Kling AI via CLI oficial (@klingai/cli-global), conta do Nei (Pro/SVIP).
#
#   ping                       -> CLI, login e creditos
#   modelos                    -> who_am_i (modelos e parametros por comando)
#   t2v  "<prompt>" [opcoes]   -> text_to_video
#   i2v  "<prompt>" --img <arquivo|URL> [opcoes]   -> image_to_video (aceita arquivo LOCAL)
#   img  "<prompt>" [opcoes]   -> text_to_image
#   status <generation_id>     -> query_tasks
#
# Opcoes comuns: --model <nome> | --omni (default) --seg 5|10 --res 720p --audio
#                --fim <img>  --poll <segundos>  --out <dir>
#
# Defaults do Nei (~/projetos/klingai-nei): 720p sempre; personagem falando =>
# prompt INTEIRO em PT-BR com a fala entre aspas (prompt em ingles faz a boca
# articular errado); enable_audio ligado, porque o audio nativo e o guia de
# tempo da dublagem posterior.
#
# TODA geracao e paga e nao cancela. Nao dispare job de teste.
set -euo pipefail

# O CLI vive no npm global do usuario, que nao esta no PATH do servico systemd.
export PATH="$HOME/.npm-global/bin:$PATH"

OUT_DIR_DEFAULT="${KLING_OUT_DIR:-/home/nmaldaner/projetos/output/klingaimcp}"

have_cli() { command -v kling >/dev/null 2>&1; }

require_cli() {
  have_cli || {
    cat <<'MSG'
[kling] CLI nao encontrada. Instale e faca login:
  npm i -g @klingai/cli-global
  kling login
MSG
    exit 2
  }
}

# Guarda a resposta crua antes de qualquer parse: job pago sem id salvo = credito perdido.
save_raw() {
  local out="$1" tag="$2"
  mkdir -p "$out"
  tee "$out/${tag}-$(date +%s).json"
}

cmd="${1:-}"; shift || true

case "$cmd" in
  ping)
    if ! have_cli; then echo "[kling] DOWN: CLI nao instalada (npm i -g @klingai/cli-global)"; exit 1; fi
    if timeout 40 kling who_am_i >/dev/null 2>&1; then
      echo "[kling] OK $(kling --version 2>/dev/null || echo cli)"
      timeout 40 kling account 2>/dev/null | head -20 || true
    else
      echo "[kling] CLI instalada mas sem login. Rode: kling login"
      exit 1
    fi
    ;;

  modelos)
    require_cli
    timeout 60 kling who_am_i
    ;;

  status)
    require_cli
    GID="${1:?status <generation_id>}"
    timeout 60 kling query_tasks --generation_id "$GID"
    ;;

  t2v|i2v|img)
    require_cli
    PROMPT="${1:?$cmd \"<prompt>\" [opcoes]}"; shift
    MODEL=""; SEG=""; RES="720p"; AUDIO=""; IMG=""; FIM=""; POLL="600"; OUT="$OUT_DIR_DEFAULT"
    while [ $# -gt 0 ]; do
      case "$1" in
        --model) MODEL="$2"; shift 2 ;;
        --omni)  MODEL="";   shift ;;
        --seg)   SEG="$2";   shift 2 ;;
        --res)   RES="$2";   shift 2 ;;
        --img)   IMG="$2";   shift 2 ;;
        --fim)   FIM="$2";   shift 2 ;;
        --poll)  POLL="$2";  shift 2 ;;
        --out)   OUT="$2";   shift 2 ;;
        --audio) AUDIO="true"; shift ;;
        *) echo "[kling] arg desconhecido: $1"; exit 1 ;;
      esac
    done

    ARGS=()
    # O flag --omni do CLI resolve para kling-video-o1, que trava em 10s. Para
    # video o default aqui e o v3_0_omni, que aceita ate 15s e audio nativo.
    if [ -z "$MODEL" ] && [ "$cmd" != "img" ]; then MODEL="${KLING_VIDEO_MODEL:-kling-video-v3_0_omni}"; fi
    if [ -n "$MODEL" ]; then ARGS+=(--model "$MODEL"); else ARGS+=(--omni); fi
    [ -n "$SEG" ] && ARGS+=(--duration "$SEG")
    # O default do servidor e 4k em video E imagem — caro. Forcamos barato, e o
    # parametro tem nome diferente nos dois: resolution vs img_resolution.
    if [ "$cmd" = "img" ]; then
      ARGS+=(--img_resolution "${KLING_IMG_RES:-1k}")
    elif [ -n "$RES" ]; then
      ARGS+=(--resolution "$RES")
    fi
    [ -n "$AUDIO" ] && ARGS+=(--enable_audio true)
    ARGS+=(--poll "$POLL")

    case "$cmd" in
      t2v) timeout $((POLL + 120)) kling text_to_video "${ARGS[@]}" "$PROMPT" | save_raw "$OUT" t2v ;;
      img) timeout $((POLL + 120)) kling text_to_image "${ARGS[@]}" "$PROMPT" | save_raw "$OUT" img ;;
      i2v)
        [ -n "$IMG" ] || { echo "[kling] i2v exige --img <arquivo local ou URL>"; exit 1; }
        [ -f "$IMG" ] || case "$IMG" in http*) ;; *) echo "[kling] imagem nao existe: $IMG"; exit 1 ;; esac
        ARGS+=(--image "$IMG")
        [ -n "$FIM" ] && ARGS+=(--tailImage "$FIM")
        timeout $((POLL + 120)) kling image_to_video "${ARGS[@]}" "$PROMPT" | save_raw "$OUT" i2v
        ;;
    esac
    echo "[kling] resposta crua salva em $OUT (URLs do Kling expiram em 24h — baixe na hora)"
    ;;

  *)
    echo "uso: kling.sh <ping|modelos|t2v|i2v|img|status> ..."
    exit 1 ;;
esac
