#!/usr/bin/env bash
#
# ThorSMM Admin – tek seferlik VPS kurulum scripti
# Kullanim: sudo bash deploy.sh
#
# - Ubuntu / Debian sunucuda calisir
# - Node 20 + PostgreSQL 16 + nginx + PM2 + Let's Encrypt SSL kurar
# - Repo'yu klonlar, .env'i olusturur (guclu sifreler ile), build alir, baslar
# - Cron 10 dakikada bir senkron yapar
#
# Calistirildiktan sonra https://thor.kisisel.ai uzerinden erisilebilir.

set -euo pipefail

###############################################################################
# Yapilandirma
###############################################################################
DOMAIN="thor.kisisel.ai"
LETSENCRYPT_EMAIL="admin@${DOMAIN}"
APP_USER="thorsmm"
APP_DIR="/home/${APP_USER}/thorsmm-admin"
REPO_URL="https://github.com/MuhammedAliDamar/smm_package_sites_control.git"
DB_NAME="thorsmm_admin"
DB_USER="thorsmm"
APP_PORT="3000"
THORSMM_API_KEY="yyoa3mpknhp6yt840517jycwdo209qkwjmjfhx1m3mgttgg4iy6nokyclq5mu5l7"
THORSMM_API_BASE="https://thorsmmprovider.com/adminapi/v2"
CREDS_FILE="/root/thorsmm-credentials.txt"

###############################################################################
# Yardimcilar
###############################################################################
log()  { printf "\033[1;34m[%s]\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }
ok()   { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then err "Bu scripti sudo ile calistirin: sudo bash deploy.sh"; fi

if ! command -v apt-get >/dev/null 2>&1; then
  err "Bu script yalnizca Debian/Ubuntu uzerinde calisir."
fi

gen_secret() { openssl rand -hex 32; }
gen_pw()     { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-20}"; }

DB_PASSWORD="$(gen_pw 24)"
SESSION_SECRET="$(gen_secret)"
CRON_SECRET="$(gen_pw 40)"
ADMIN_PASSWORD="$(gen_pw 20)"
ADMIN_EMAIL="admin@${DOMAIN}"

###############################################################################
# 1) Sistem paketleri
###############################################################################
log "Sistem paketleri guncelleniyor..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -yqq
apt-get install -yqq curl git build-essential ca-certificates gnupg \
  nginx ufw openssl rsync

###############################################################################
# 2) Node.js 20
###############################################################################
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1)" != "v20" ]]; then
  log "Node.js 20 kuruluyor..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -yqq nodejs
fi
ok "Node $(node -v), npm $(npm -v)"

###############################################################################
# 3) PostgreSQL
###############################################################################
log "PostgreSQL kuruluyor..."
apt-get install -yqq postgresql postgresql-contrib
systemctl enable --now postgresql

# DB user + database (idempotent)
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"

sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

ok "Postgres hazir (db: ${DB_NAME}, user: ${DB_USER})"

###############################################################################
# 4) Uygulama kullanicisi
###############################################################################
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  log "Kullanici olusturuluyor: ${APP_USER}"
  adduser --disabled-password --gecos "" "${APP_USER}"
fi

###############################################################################
# 5) PM2
###############################################################################
if ! command -v pm2 >/dev/null 2>&1; then
  log "PM2 kuruluyor..."
  npm install -g pm2 >/dev/null
fi
ok "PM2 $(pm2 -v)"

###############################################################################
# 6) Repo'yu klonla / guncelle
###############################################################################
if [[ -d "${APP_DIR}/.git" ]]; then
  log "Repo guncelleniyor..."
  sudo -u "${APP_USER}" git -C "${APP_DIR}" fetch --all -q
  sudo -u "${APP_USER}" git -C "${APP_DIR}" reset --hard origin/main -q
else
  log "Repo klonlaniyor..."
  sudo -u "${APP_USER}" git clone -q "${REPO_URL}" "${APP_DIR}"
fi
ok "Kod: ${APP_DIR}"

###############################################################################
# 7) .env
###############################################################################
log ".env yaziliyor..."
cat > "${APP_DIR}/.env" <<EOF
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
chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/.env"

###############################################################################
# 8) Bagimliliklar + build + migrate + seed
###############################################################################
log "npm ci..."
sudo -u "${APP_USER}" -H bash -lc "cd ${APP_DIR} && npm ci --no-audit --no-fund"

log "Prisma generate + db push..."
sudo -u "${APP_USER}" -H bash -lc "cd ${APP_DIR} && set -a && source .env && set +a && npx prisma generate && npx prisma db push --accept-data-loss"

log "Admin seed..."
sudo -u "${APP_USER}" -H bash -lc "cd ${APP_DIR} && set -a && source .env && set +a && npm run db:seed"

log "Next.js build..."
sudo -u "${APP_USER}" -H bash -lc "cd ${APP_DIR} && set -a && source .env && set +a && npm run build"

###############################################################################
# 9) PM2 ile uygulamayi baslat + cron
###############################################################################
log "PM2 ile uygulama ve cron baslatiliyor..."

# Eski islemleri temizle
sudo -u "${APP_USER}" -H bash -lc "pm2 delete thorsmm-app thorsmm-cron 2>/dev/null || true"

# Uygulama
sudo -u "${APP_USER}" -H bash -lc "cd ${APP_DIR} && set -a && source .env && set +a && pm2 start npm --name thorsmm-app -- run start"

# Cron: 10 dakikada bir local API'yi cagirir (Bearer secret ile)
CRON_CMD="curl -s -m 270 -X POST -H 'Authorization: Bearer ${CRON_SECRET}' http://localhost:${APP_PORT}/api/cron/sync >/dev/null"
sudo -u "${APP_USER}" -H bash -lc "pm2 start --name thorsmm-cron --cron-restart '*/10 * * * *' --no-autorestart /bin/bash -- -c \"${CRON_CMD}\""

sudo -u "${APP_USER}" -H pm2 save

# Reboot sonrasi otomatik baslatma
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" >/dev/null

ok "Uygulama PM2 ile calisiyor (port ${APP_PORT})"

###############################################################################
# 10) Nginx reverse proxy
###############################################################################
log "Nginx yapilandiriliyor..."
cat > /etc/nginx/sites-available/thorsmm <<NGINX
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
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/thorsmm /etc/nginx/sites-enabled/thorsmm
[[ -L /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
ok "Nginx aktif (http://${DOMAIN})"

###############################################################################
# 11) Firewall
###############################################################################
log "UFW ayarlaniyor..."
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ok "Firewall: SSH + Nginx acik"

###############################################################################
# 12) SSL (Let's Encrypt)
###############################################################################
log "SSL sertifikasi aliniyor (Let's Encrypt)..."
apt-get install -yqq certbot python3-certbot-nginx

if certbot --nginx --non-interactive --agree-tos --email "${LETSENCRYPT_EMAIL}" \
   --redirect -d "${DOMAIN}"; then
  ok "HTTPS aktif: https://${DOMAIN}"
else
  warn "SSL alinamadi. Domain'in A kaydi sunucu IP'sine yonlendirildiginden emin olun, sonra:"
  warn "  sudo certbot --nginx -d ${DOMAIN}"
fi

###############################################################################
# 13) Bilgileri kaydet
###############################################################################
cat > "${CREDS_FILE}" <<EOF
ThorSMM Admin – Kurulum Bilgileri
Olusturulma: $(date)

URL:                https://${DOMAIN}
Login email:        ${ADMIN_EMAIL}
Login password:     ${ADMIN_PASSWORD}

DB user:            ${DB_USER}
DB password:        ${DB_PASSWORD}
DB name:            ${DB_NAME}

SESSION_SECRET:     ${SESSION_SECRET}
CRON_SECRET:        ${CRON_SECRET}

App dir:            ${APP_DIR}
Env file:           ${APP_DIR}/.env

Yararli komutlar:
  pm2 status
  pm2 logs thorsmm-app
  pm2 logs thorsmm-cron
  pm2 reload thorsmm-app
  sudo -u ${APP_USER} bash -c 'cd ${APP_DIR} && git pull && npm ci && npx prisma db push && npm run build && pm2 reload thorsmm-app'
EOF
chmod 600 "${CREDS_FILE}"

echo
echo "================================================================"
ok "Kurulum tamamlandi!"
echo "================================================================"
echo
echo "  URL:       https://${DOMAIN}"
echo "  Email:     ${ADMIN_EMAIL}"
echo "  Sifre:     ${ADMIN_PASSWORD}"
echo
echo "  Tum bilgiler: ${CREDS_FILE}"
echo
