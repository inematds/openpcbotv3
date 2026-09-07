#!/usr/bin/env bash
# Ponte para o pipeline Agnes AI (~/projetos/videos-agnes).
#
#   ping
#   imagem "<prompt em INGLES>" [dest.png] [--ref url_ou_png]...
#   clipe  <img_a.png> "<prompt em INGLES>" [segundos] [--para img_b.png] [--out dest.mp4]
#   filme  <historia>            -> roda historias/<historia>.py de ponta a ponta
#   historias                    -> lista as historias disponiveis
#
# Prompts em INGLES: em portugues a API bloqueia conteudo legitimo com HTTP 400.
set -euo pipefail

AGNES_DIR="${AGNES_DIR:-/home/nmaldaner/projetos/videos-agnes}"
AGNES_ENV="${AGNES_ENV:-/home/nmaldaner/projetos/agnes-nei/.env}"
OUT_DIR="${AGNES_OUT_DIR:-/home/nmaldaner/projetos/output/agnes-bot}"

require_setup() {
  [ -d "$AGNES_DIR" ] || { echo "[agnes] pipeline nao encontrado em $AGNES_DIR"; exit 2; }
  [ -f "$AGNES_ENV" ] || { echo "[agnes] falta a AGNES_API_KEY em $AGNES_ENV"; exit 2; }
}

cmd="${1:-}"; shift || true

case "$cmd" in
  ping)
    require_setup
    if curl -fsS --max-time 8 -o /dev/null https://apihub.agnes-ai.com/v1/images/generations -X OPTIONS 2>/dev/null; then
      echo "[agnes] OK apihub.agnes-ai.com"
    else
      echo "[agnes] setup OK, API sem resposta no OPTIONS (normal). Teste real: agnes.sh imagem \"a red cube on white\""
    fi
    ;;

  imagem)
    require_setup
    PROMPT="${1:?imagem \"<prompt em INGLES>\" [dest.png] [--ref X]}"; shift
    DEST=""; REFS=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --ref) REFS+=("$2"); shift 2 ;;
        *) [ -z "$DEST" ] && DEST="$1"; shift ;;
      esac
    done
    mkdir -p "$OUT_DIR"
    [ -n "$DEST" ] || DEST="$OUT_DIR/img-$(date +%s).png"
    AGNES_PROMPT="$PROMPT" AGNES_DEST="$DEST" AGNES_REFS="$(printf '%s\n' "${REFS[@]:-}")" \
    python3 - "$AGNES_DIR" <<'PY'
import os, sys, base64
sys.path.insert(0, sys.argv[1])
import pipeline as P
refs = [r for r in os.environ.get('AGNES_REFS', '').splitlines() if r.strip()]
refs = [r if r.startswith('http') else 'data:image/png;base64,' + base64.b64encode(open(r, 'rb').read()).decode()
        for r in refs]
if len(refs) > 2:
    sys.exit('[agnes] no maximo 2 referencias (3+ destroem a saida)')
dest = os.environ['AGNES_DEST']
url = P.gerar_imagem(dest, os.environ['AGNES_PROMPT'], refs or None)
if not url:
    sys.exit('[agnes] falhou ao gerar a imagem')
print(f'[agnes] imagem: {dest}')
print(f'[agnes] url: {url}')
PY
    ;;

  clipe)
    require_setup
    IMG_A="${1:?clipe <img_a.png> \"<prompt em INGLES>\" [segundos]}"; shift
    PROMPT="${1:?prompt obrigatorio}"; shift
    SEGS="${1:-5}"; case "$SEGS" in ''|*[!0-9.]*) SEGS=5 ;; *) shift || true ;; esac
    IMG_B=""; DEST=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --para) IMG_B="$2"; shift 2 ;;
        --out)  DEST="$2";  shift 2 ;;
        *) shift ;;
      esac
    done
    [ -f "$IMG_A" ] || { echo "[agnes] imagem nao existe: $IMG_A"; exit 1; }
    mkdir -p "$OUT_DIR"
    [ -n "$DEST" ] || DEST="$OUT_DIR/clipe-$(date +%s).mp4"
    AGNES_A="$IMG_A" AGNES_B="$IMG_B" AGNES_PROMPT="$PROMPT" AGNES_SEGS="$SEGS" AGNES_DEST="$DEST" \
    python3 - "$AGNES_DIR" <<'PY'
import os, sys
sys.path.insert(0, sys.argv[1])
import pipeline as P
a = P.keyframe(os.environ['AGNES_A'])
b = P.keyframe(os.environ['AGNES_B']) if os.environ.get('AGNES_B') else a
frames = P.frames_para(float(os.environ['AGNES_SEGS']))
dest = os.environ['AGNES_DEST']
out = P.gerar_video(dest, a, b, os.environ['AGNES_PROMPT'], frames)
if not out:
    sys.exit('[agnes] falhou ao gerar o clipe (rate limit e 5 req/min)')
print(f'[agnes] clipe: {out}')
PY
    ;;

  filme)
    require_setup
    H="${1:?filme <historia> — veja: agnes.sh historias}"
    cd "$AGNES_DIR" && python3 rodar.py "$H"
    ;;

  historias)
    ls "$AGNES_DIR/historias/"*.py 2>/dev/null | xargs -n1 basename | sed 's/\.py$//' | grep -v '^__'
    ;;

  *)
    echo "uso: agnes.sh <ping|imagem|clipe|filme|historias> ..."
    exit 1 ;;
esac
