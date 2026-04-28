#!/usr/bin/env bash
#
# PM2 ile uygulamayi + 10dk cron'u baslatir / yeniden baslatir.
# Onkosul: .env dosyasi mevcut, npm ci + build yapilmis.
# Kullanim: bash pm2-run.sh   (repo dizini icinden)

set -euo pipefail

APP_NAME="thorsmm-app"
CRON_NAME="thorsmm-cron"
APP_DIR="$(pwd)"
ENV_FILE="${APP_DIR}/.env"

ok()  { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || err ".env bulunamadi: $ENV_FILE"
command -v pm2 >/dev/null || err "pm2 kurulu degil:  npm i -g pm2"
[[ -d node_modules ]] || err "node_modules yok. once: npm ci"
[[ -d .next ]] || err ".next yok. once: npm run build"

set -a; source "$ENV_FILE"; set +a
[[ -n "${CRON_SECRET:-}" ]]  || err "CRON_SECRET .env'de yok"
[[ -n "${PORT:-3000}" ]]     || PORT=3000

pm2 delete "$APP_NAME" "$CRON_NAME" 2>/dev/null || true

# Uygulama
pm2 start npm --name "$APP_NAME" --update-env -- run start
ok "$APP_NAME baslatildi (port $PORT)"

# 10 dakikalik cron — local API'ye Bearer ile vurur
CRON_CMD="curl -s -m 270 -X POST -H 'Authorization: Bearer ${CRON_SECRET}' http://localhost:${PORT}/api/cron/sync >/dev/null"
pm2 start --name "$CRON_NAME" --cron-restart '*/10 * * * *' --no-autorestart \
  /bin/bash -- -c "$CRON_CMD"
ok "$CRON_NAME 10 dakikalik cron baslatildi"

pm2 save

# Reboot sonrasi otomatik baslatma (idempotent)
USER_NAME="$(whoami)"
HP="$HOME"
pm2 startup systemd -u "$USER_NAME" --hp "$HP" 2>/dev/null | tail -1 | bash || true

echo
pm2 status
echo
ok "Hazir. Loglar:  pm2 logs $APP_NAME"
