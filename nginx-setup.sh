#!/usr/bin/env bash
#
# Nginx reverse proxy + Let's Encrypt SSL kurar.
# Onkosul: nginx + certbot kurulu, app PM2 ile localhost:3000'da calisiyor,
#          domain'in A kaydi sunucu IP'sine yonlendirilmis.
# Kullanim: sudo bash nginx-setup.sh

set -euo pipefail

DOMAIN="${DOMAIN:-thor.kisisel.ai}"
EMAIL="${LETSENCRYPT_EMAIL:-admin@${DOMAIN}}"
APP_PORT="${APP_PORT:-3000}"
SITE_NAME="thorsmm"

ok()   { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || err "sudo ile calistirin: sudo bash nginx-setup.sh"
command -v nginx >/dev/null   || err "nginx kurulu degil:  apt install -y nginx"
command -v certbot >/dev/null || err "certbot kurulu degil:  apt install -y certbot python3-certbot-nginx"

# A kaydi kontrol (uyari, hata degil)
SERVER_IP="$(curl -s -4 ifconfig.me || true)"
DNS_IP="$(dig +short "$DOMAIN" | tail -1 || true)"
if [[ -n "$SERVER_IP" && -n "$DNS_IP" && "$SERVER_IP" != "$DNS_IP" ]]; then
  warn "Domain ($DOMAIN -> $DNS_IP) sunucu IP ($SERVER_IP) ile eslesmiyor."
  warn "SSL adimi basarisiz olabilir. Yine de devam ediliyor..."
fi

# Nginx config
cat > "/etc/nginx/sites-available/${SITE_NAME}" <<NGINX
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
        proxy_buffering off;
    }
}
NGINX

ln -sf "/etc/nginx/sites-available/${SITE_NAME}" "/etc/nginx/sites-enabled/${SITE_NAME}"

# Default site'i temizle (cakisma olmasin)
[[ -L /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
ok "Nginx config yazildi ve yuklendi"

# UFW acik mi kontrol et (kuruluysa)
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null || true
  ok "UFW: Nginx Full izni eklendi"
fi

# Certbot
echo
echo "▸ Let's Encrypt SSL aliniyor (${DOMAIN})..."
if certbot --nginx --non-interactive --agree-tos --email "$EMAIL" --redirect -d "$DOMAIN"; then
  ok "HTTPS aktif: https://${DOMAIN}"
else
  warn "SSL alinamadi. DNS yayilimini bekleyip tekrar deneyin:"
  echo "    sudo certbot --nginx -d ${DOMAIN}"
  exit 1
fi

# Otomatik renew test
if certbot renew --dry-run >/dev/null 2>&1; then
  ok "Otomatik yenileme calisiyor"
fi

echo
ok "Tamam: https://${DOMAIN}"
