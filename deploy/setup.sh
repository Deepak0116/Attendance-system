#!/usr/bin/env bash
# One-command setup for a fresh Ubuntu server (e.g. Oracle Cloud Always Free).
#
#   git clone <your repo> attendance-system && cd attendance-system
#   sudo bash deploy/setup.sh asten-attendance.duckdns.org 'YourStrongAdminPassword'
#
# Re-run the same command after "git pull" to update the app. Data in /opt/attendance-data is kept.
set -euo pipefail

DOMAIN="${1:?Usage: sudo bash deploy/setup.sh <domain> <admin-password>}"
ADMIN_PASSWORD="${2:?Usage: sudo bash deploy/setup.sh <domain> <admin-password>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing Docker and Caddy"
apt-get update -y
apt-get install -y curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg iptables-persistent
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> Opening web ports 80/443 in the server firewall"
for p in 80 443; do
  iptables -C INPUT -m state --state NEW -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$p" -j ACCEPT
done
netfilter-persistent save

echo "==> Preparing data folder and settings"
mkdir -p /opt/attendance-data
ENV_FILE="$HERE/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '=+/\n')" > "$ENV_FILE"
fi
grep -v '^ADMIN_PASSWORD=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"

echo "==> Building and starting the app"
(cd "$HERE" && docker compose up -d --build)

echo "==> Setting up HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:10000
}
EOF
systemctl enable --now caddy
systemctl reload caddy

echo
echo "Done. Open https://$DOMAIN  (admin login: admin / the password you gave)"
echo "Backups: copy /opt/attendance-data/attendance_system.xlsx somewhere safe regularly."
