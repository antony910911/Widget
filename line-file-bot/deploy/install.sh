#!/usr/bin/env bash
# LINE 檔案櫃 Bot：Ubuntu / Debian 雲端主機一鍵安裝（也可用來更新）
#
#   用法（在 line-file-bot 資料夾內執行）：
#     sudo bash deploy/install.sh               # 沒有網域：自動使用 <IP>.sslip.io
#     sudo bash deploy/install.sh bot.example.com
#
#   重複執行 = 更新程式；.env、data/、storage/ 都會保留。
set -euo pipefail

APP_DIR=/opt/line-file-bot
APP_USER=linebot
PORT=3000
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then echo "請用 sudo 執行：sudo bash deploy/install.sh [網域]"; exit 1; fi
step() { echo; echo "==> $*"; }

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" && -f /etc/caddy/Caddyfile ]] && grep -q '# line-file-bot' /etc/caddy/Caddyfile; then
  DOMAIN="$(awk '/# line-file-bot/{getline; print $1; exit}' /etc/caddy/Caddyfile)"
fi
if [[ -z "$DOMAIN" ]]; then
  IP="$(curl -fsS4 https://api.ipify.org || true)"
  if [[ -z "$IP" ]]; then echo "抓不到公開 IP，請自行指定網域：sudo bash deploy/install.sh 你的網域"; exit 1; fi
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "使用網域：$DOMAIN"

step "安裝系統套件"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  step "安裝 Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js $(node -v)"

if ! command -v caddy >/dev/null; then
  step "安裝 Caddy（自動申請 HTTPS 憑證）"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

step "建立系統帳號與複製程式到 $APP_DIR"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude node_modules --exclude .env --exclude data --exclude storage --exclude .git \
  "$SRC_DIR/" "$APP_DIR/"
mkdir -p "$APP_DIR/data" "$APP_DIR/storage"

step "安裝 npm 套件"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

if [[ ! -f "$APP_DIR/.env" ]]; then
  step "設定 LINE 金鑰與管理密碼（之後可編輯 $APP_DIR/.env 修改）"
  read -rp "LINE Channel secret: " SECRET
  read -rp "LINE Channel access token: " TOKEN
  read -rsp "管理介面密碼（帳號為 admin）: " PASS; echo
  while [[ -z "$PASS" ]]; do read -rsp "密碼不可空白，請再輸入一次: " PASS; echo; done
  cat > "$APP_DIR/.env" <<ENV
LINE_CHANNEL_SECRET=$SECRET
LINE_CHANNEL_ACCESS_TOKEN=$TOKEN
ADMIN_PASSWORD=$PASS
PORT=$PORT
HOST=127.0.0.1
STORAGE_DIR=$APP_DIR/storage
DATA_DIR=$APP_DIR/data
REPLY_ON_SAVE=false
ENV
fi
chmod 600 "$APP_DIR/.env"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

step "設定 systemd 服務（開機自動啟動、當掉自動重啟）"
install -m 644 "$APP_DIR/deploy/line-file-bot.service" /etc/systemd/system/line-file-bot.service
systemctl daemon-reload
systemctl enable line-file-bot >/dev/null
systemctl restart line-file-bot

step "設定 Caddy 反向代理 + HTTPS"
cat > /etc/caddy/Caddyfile <<CADDY
# line-file-bot
$DOMAIN {
	encode gzip
	request_body {
		max_size 200MB
	}
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  step "開啟防火牆 80 / 443"
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  echo; echo "✅ 程式已啟動"
else
  echo; echo "⚠️  程式似乎沒有正常啟動，請執行：journalctl -u line-file-bot -n 50"
fi
cat <<DONE

-------------------------------------------------------------
 管理介面：  https://$DOMAIN        （帳號 admin）
 Webhook ：  https://$DOMAIN/webhook  ← 貼到 LINE Developers Console
 檔案位置：  $APP_DIR/storage
 查看紀錄：  journalctl -u line-file-bot -f
-------------------------------------------------------------
第一次開啟時 Caddy 需要幾十秒申請 HTTPS 憑證，打不開請稍等再試。
DONE
