#!/usr/bin/env bash
#
# smm_package_sites_control -> YENI SUNUCU tek-seferlik tasima scripti
#
# ONCE: repoyu clone et, kendi .env dosyani repo dizinine koy (ornek .env.local).
#       .env icindeki DATABASE_URL = ESKI (kaynak) DB olmali.
# SONRA: yeni sunucuda sudo yetkili kullaniciyla:
#     NEW_DOMAIN="panel.ornek.com" ./migrate-to-new-server.sh
#
# Yapar: on kosullar -> local DB -> ESKI DB'den pg_dump (SALT OKUNUR) -> restore
#        -> .env'de DATABASE_URL'i local'e cevir -> npm ci + build -> pm2
#        -> nginx -> certbot SSL
#
# GUVENLIK: Kaynak (eski) DB'ye SADECE pg_dump (okuma). Hicbir DROP/DELETE/
#           TRUNCATE/db-push kaynaga calismaz. Veri dump'tan geldigi icin
#           local'de de "prisma db push/seed" CALISMAZ. Secret yok -> .env'den okur.

set -euo pipefail

# ===================== AYARLAR =====================
PROJECT_NAME="${PROJECT_NAME:-thor_admin_panel}"       # proje adi: pm2 / nginx site / dizin
NEW_DOMAIN="${NEW_DOMAIN:-}"                           # ZORUNLU: yeni domain (DNS A kaydi bu sunucuya baksin)
LE_EMAIL="${LE_EMAIL:-admin@globadigital.com}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"   # scriptin bulundugu repo dizini
DB_NAME="${DB_NAME:-thorsmm_admin}"
DB_USER="${DB_USER:-thorsmm}"
APP_NAME="$PROJECT_NAME"
APP_PORT="${PORT:-1342}"
# ===================================================

log()  { printf "\033[1;34m▸\033[0m %s\n" "$*"; }
ok()   { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

[[ -z "$NEW_DOMAIN" ]] && err "NEW_DOMAIN ver:  NEW_DOMAIN=\"panel.ornek.com\" ./migrate-to-new-server.sh"
[[ -f "$APP_DIR/.env" ]] || err ".env bulunamadi ($APP_DIR/.env). Once .env.local'i buraya .env olarak kopyala."

# .env'den ESKI DB URL'ini ve local sifreyi al
OLD_DB_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"')"
[[ -z "$OLD_DB_URL" ]] && err ".env icinde DATABASE_URL yok."
# psql/pg_dump libpq, Prisma'ya ozgu "?schema=public" query parametresini kabul etmez -> soy.
SRC_DB_URL="${OLD_DB_URL%%\?*}"
# Kaynak URL'den sifreyi cek; local DB icin ayni sifreyi kullan
DB_PASS="$(printf '%s' "$OLD_DB_URL" | sed -E 's|^postgres(ql)?://[^:]+:([^@]+)@.*|\2|')"
[[ -z "$DB_PASS" || "$DB_PASS" == "$OLD_DB_URL" ]] && DB_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
LOCAL_DB_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public"

# --- 1) On kosullar ---
log "On kosullar (git, nginx, postgres, certbot, node20, pm2)..."
sudo apt update -y
sudo apt install -y git nginx postgresql postgresql-contrib certbot python3-certbot-nginx curl dnsutils
if ! command -v node >/dev/null || [[ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
command -v pm2 >/dev/null || sudo npm i -g pm2
ok "On kosullar hazir: node $(node -v)"

# --- 2) Kaynak DB erisim testi (SALT OKUNUR) ---
log "Kaynak DB okunabiliyor mu (yazma yok)..."
psql "$SRC_DB_URL" -c "\dt" >/dev/null 2>&1 \
  || err "Kaynak DB'ye baglanilamadi. Port kapali olabilir. pg_dump'i kaynak makineden calistiran versiyon icin haber ver."
ok "Kaynak DB erisimi OK"

# --- 3) Local DB + user ---
log "Local postgres DB + user hazirlaniyor..."
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
ok "Local DB hazir: $DB_NAME"

# --- 4) Veri tasima: pg_dump -> local psql (pipe, ekstra yedek dosyasi YOK) ---
log "Kaynak DB'den veri aktariliyor (pg_dump | psql, dosya tutulmuyor)..."
TABLE_COUNT=$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)
if [[ "${TABLE_COUNT:-0}" -gt 0 ]]; then
  warn "Local DB'de zaten $TABLE_COUNT tablo var; veri aktarimi atlaniyor (tekrar-calistirma korumasi)."
else
  pg_dump --no-owner --no-privileges "$SRC_DB_URL" \
    | PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" >/dev/null
  ok "Veri aktarildi"
fi
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -c "\dt"

# --- 5) .env: DATABASE_URL -> local + prod ayarlari ---
log ".env guncelleniyor (DATABASE_URL -> local)..."
cd "$APP_DIR"
sed -i "s#^DATABASE_URL=.*#DATABASE_URL=\"$LOCAL_DB_URL\"#" .env
grep -q '^NODE_ENV='     .env || echo 'NODE_ENV=production'       >> .env
grep -q '^PORT='         .env || echo "PORT=$APP_PORT"            >> .env
grep -q '^SYNC_INTERVAL' .env || echo 'SYNC_INTERVAL_MINUTES=10'  >> .env
grep -q '^SESSION_SECRET=' .env || echo "SESSION_SECRET=\"$(openssl rand -hex 32)\"" >> .env
grep -q '^CRON_SECRET='    .env || echo "CRON_SECRET=\"$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)\"" >> .env
chmod 600 .env
ok ".env hazir"

# --- 6) Bagimliliklar + build (db push/seed YOK) ---
log "npm ci + prisma generate + build..."
npm ci --no-audit --no-fund
set -a; source "$APP_DIR/.env"; set +a
npx prisma generate
npm run build
ok "Build tamam"

# --- 7) PM2 (app + 10dk cron) ---
log "PM2 baslatiliyor..."
pm2 delete "$APP_NAME" "${APP_NAME}-cron" 2>/dev/null || true
pm2 start npm --name "$APP_NAME" --update-env -- run start
pm2 start --name "${APP_NAME}-cron" --update-env npx -- tsx scripts/cron-local.ts
pm2 save
pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null | tail -1 | sudo bash || true
sleep 3
curl -sI "http://127.0.0.1:$APP_PORT" | head -1 || true
ok "PM2 calisiyor"

# --- 8) Nginx ---
log "Nginx yapilandiriliyor..."
sudo tee "/etc/nginx/sites-available/$PROJECT_NAME" >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${NEW_DOMAIN};
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
        proxy_buffering off;
    }
}
NGINX
sudo ln -sf "/etc/nginx/sites-available/$PROJECT_NAME" "/etc/nginx/sites-enabled/$PROJECT_NAME"
[[ -L /etc/nginx/sites-enabled/default ]] && sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
ok "Nginx aktif"

# --- 9) SSL ---
log "Let's Encrypt SSL ($NEW_DOMAIN)..."
SERVER_IP="$(curl -s -4 ifconfig.me || true)"
DNS_IP="$(dig +short "$NEW_DOMAIN" | tail -1 || true)"
[[ -n "$SERVER_IP" && -n "$DNS_IP" && "$SERVER_IP" != "$DNS_IP" ]] && \
  warn "DNS ($NEW_DOMAIN -> $DNS_IP) sunucu IP ($SERVER_IP) ile eslesmiyor; SSL basarisiz olabilir."
if sudo certbot --nginx --non-interactive --agree-tos --email "$LE_EMAIL" --redirect -d "$NEW_DOMAIN"; then
  sudo certbot renew --dry-run >/dev/null 2>&1 && ok "Otomatik yenileme calisiyor"
  ok "HTTPS aktif: https://$NEW_DOMAIN"
else
  warn "SSL alinamadi. DNS kontrol edip sonra: sudo certbot --nginx -d $NEW_DOMAIN"
fi

echo
echo "==============================================="
ok  "KURULUM TAMAM"
echo "==============================================="
echo "  URL:   https://$NEW_DOMAIN"
echo "  Login: .env ADMIN_EMAIL / ADMIN_PASSWORD"
echo "  pm2 status ; pm2 logs $APP_NAME"
echo
curl -sI "https://$NEW_DOMAIN" | head -1 || true
pm2 status
