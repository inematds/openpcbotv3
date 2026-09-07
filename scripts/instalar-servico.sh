#!/usr/bin/env bash
# Instala/atualiza a unit de usuário do v3 e (re)inicia. NÃO toca no v2.
set -euo pipefail
cd "$(dirname "$0")/.."
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
mkdir -p ~/.config/systemd/user
cp systemd/openpcbotv3.service ~/.config/systemd/user/openpcbotv3.service
npm run build
systemctl --user daemon-reload
systemctl --user enable openpcbotv3 >/dev/null
systemctl --user restart openpcbotv3
sleep 2
systemctl --user --no-pager status openpcbotv3 | head -12
echo
echo "MemoryMax: $(systemctl --user show openpcbotv3 -p MemoryMax --value)"
echo "health:    curl -s localhost:${PORT_V3:-3142}/health"
