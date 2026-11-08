#!/usr/bin/env bash
# Xserver VPS (Ubuntu 22.04 / 24.04) 初回セットアップ
# 使い方 (VPS上で root として):
#   curl -fsSL https://raw.githubusercontent.com/joehisa1203-tech/hostoneai.aitem-inc.co.jp/main/deploy/setup-vps.sh | bash
# もしくはリポジトリを clone 後: sudo bash deploy/setup-vps.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/joehisa1203-tech/hostoneai.aitem-inc.co.jp.git}"
APP_DIR="${APP_DIR:-/opt/hostoneai}"
DOMAIN="${DOMAIN:-hostoneai.aitem-inc.co.jp}"

echo "==> パッケージ更新・Docker インストール"
apt-get update -y
apt-get install -y ca-certificates curl git ufw
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> ファイアウォール (SSH/HTTP/HTTPS)"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "==> アプリ取得: $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
mkdir -p data

if [ ! -f .env ]; then
  cp .env.example .env
  PW="$(openssl rand -base64 18 | tr -d '/+=')"
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${PW}|" .env
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://${DOMAIN}|" .env
  echo ""
  echo "!!! .env を作成しました。管理画面パスワード: ${PW}"
  echo "!!! ANTHROPIC_API_KEY / BEDS24_REFRESH_TOKEN / LINE / Slack / Twilio を設定してください:"
  echo "!!!   nano $APP_DIR/.env"
  echo "!!! 設定後:  cd $APP_DIR && docker compose up -d --build"
  exit 0
fi

echo "==> 起動"
docker compose up -d --build
docker compose ps
echo "完了: https://${DOMAIN}/  管理画面: https://${DOMAIN}/admin/"
