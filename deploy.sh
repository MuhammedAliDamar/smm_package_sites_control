#!/usr/bin/env bash
#
# ThorSMM Admin – basit deploy scripti
# Kullanim: bash deploy.sh   (repo dizini icinden)
#
# Onkosul: node 20+, postgres, nginx, pm2, certbot kurulu olmali.
# Yapacagi: npm ci -> .env -> prisma db push -> seed -> build -> pm2
#           -> nginx config -> certbot SSL

set -euo pipefail

DOMAIN="thor.kisisel.ai"
EMAIL="admin@${DOMAIN}"
APP_NAME="thorsmm-app"
APP_PORT="3000"
DB_NAME="thorsmm_admin"
DB_USER="thorsmm"
THORSMM_API_BASE="https://thorsmmprovider.com/adminapi/v2"
APP_DIR="$(pwd)"
ENV_FILE="${APP_DIR}/.env"

log()  { printf "\033[1;34m▸\033[0m %s\n" "$*"; }
ok()   { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

# API key
if [[ -z "${THORSMM_API_KEY:-}" ]]; then
  if [[ -t 0 || -e /dev/tty ]]; then
    read -rsp "ThorSMM API key: " THORSMM_API_KEY < /dev/tty
    echo
  else
    err "THORSMM_API_KEY env var verilmeli (export THORSMM_API_KEY='...')"
  fi
fi
[[ -z "$THORSMM_API_KEY" ]] && err "API key bos olamaz"

# 1) DB user + database
log "Postgres DB ve kullanici hazirlaniyor..."
DB_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"

# Eger .env zaten varsa eski sifreyi koru
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed 's/.*=//' | tr -d '"')"
  if [[ -n "$EXISTING_DB_URL" ]]; then
    OLD_PW="$(echo "$EXISTING_DB_URL" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')"
    [[ -n "$OLD_PW" ]] && DB_PASSWORD="$OLD_PW"
  fi
fi

sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" >/dev/null
sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" >/dev/null
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null
ok "DB hazir: ${DB_NAME}"

# 2) .env yaz
log ".env dosyasi yaziliyor..."
SESSION_SECRET="$(openssl rand -hex 32)"
CRON_SECRET="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"
ADMIN_EMAIL="admin@${DOMAIN}"
ADMIN_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)"

# Mevcut .env varsa sadece eksikleri tamamla, eski admin sifresini koru
if [[ -f "$ENV_FILE" ]]; then
  OLD_ADMIN_PW="$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | sed 's/.*=//' | tr -d '"')"
  OLD_SESS="$(grep -E '^SESSION_SECRET=' "$ENV_FILE" | sed 's/.*=//' | tr -d '"')"
  OLD_CRON="$(grep -E '^CRON_SECRET=' "$ENV_FILE" | sed 's/.*=//' | tr -d '"')"
  [[ -n "$OLD_ADMIN_PW" ]] && ADMIN_PASSWORD="$OLD_ADMIN_PW"
  [[ -n "$OLD_SESS" ]] && SESSION_SECRET="$OLD_SESS"
  [[ -n "$OLD_CRON" ]] && CRON_SECRET="$OLD_CRON"
fi

cat > "$ENV_FILE" <<EOF
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"
THORSMM_API_BASE="${THORSMM_API_BASE}"
THORSMM_API_KEY="${THORSMM_API_KEY}"
SESSION_SECRET="${SESSION_SECRET}"
CRON_SECRET="${CRON_SECRET}"
ADMIN_EMAIL="${ADMIN_EMAIL}"
ADMIN_PASSWORD="${ADMIN_PASSWORD}"
SYNC_INTERVAL_MINUTES=10
NODE_ENV=production
PORT=${APP_PORT}
EOF
chmod 600 "$ENV_FILE"
ok ".env yazildi"

# 3) npm ci + prisma + seed + build
log "npm ci..."
npm ci --no-audit --no-fund

log "Prisma generate + db push..."
set -a && source "$ENV_FILE" && set +a
npx prisma generate
npx prisma db push --accept-data-loss

log "Admin seed..."
npm run db:seed

log "Build..."
npm run build

# 4) PM2
log "PM2 ile baslatiliyor..."
pm2 delete "${APP_NAME}" "${APP_NAME}-cron" 2>/dev/null || true

pm2 start npm --name "${APP_NAME}" -- run start

CRON_CMD="curl -s -m 270 -X POST -H 'Authorization: Bearer ${CRON_SECRET}' http://localhost:${APP_PORT}/api/cron/sync >/dev/null"
pm2 start --name "${APP_NAME}-cron" --cron-restart '*/10 * * * *' --no-autorestart \
  /bin/bash -- -c "${CRON_CMD}"

pm2 save
pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null | tail -1 | bash || true
ok "PM2 calisiyor"

# 5) Nginx
log "Nginx yapilandiriliyor..."
sudo tee /etc/nginx/sites-available/thorsmm >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/thorsmm /etc/nginx/sites-enabled/thorsmm
[[ -L /etc/nginx/sites-enabled/default ]] && sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
ok "Nginx aktif"

# 6) SSL
log "Certbot ile SSL aliniyor..."
if sudo certbot --nginx --non-interactive --agree-tos --email "${EMAIL}" --redirect -d "${DOMAIN}"; then
  ok "HTTPS aktif: https://${DOMAIN}"
else
  echo "! SSL alinamadi. DNS A kaydini kontrol edin, sonra:"
  echo "    sudo certbot --nginx -d ${DOMAIN}"
fi

# Sonuc
echo
echo "==============================================="
ok "Kurulum tamam"
echo "==============================================="
echo "  URL:    https://${DOMAIN}"
echo "  Email:  ${ADMIN_EMAIL}"
echo "  Sifre:  ${ADMIN_PASSWORD}"
echo
echo "  pm2 status"
echo "  pm2 logs ${APP_NAME}"
