#!/usr/bin/env bash
# 備份檔案與資料庫：sudo bash /opt/line-file-bot/deploy/backup.sh [輸出資料夾]
# 可加到 crontab 每天自動執行，例如：
#   0 3 * * * bash /opt/line-file-bot/deploy/backup.sh /root/backups
set -euo pipefail
OUT="${1:-/root/backups}"
mkdir -p "$OUT"
FILE="$OUT/line-file-bot-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$FILE" -C /opt/line-file-bot data storage .env
echo "已備份到 $FILE"
# 只保留最近 14 份
ls -1t "$OUT"/line-file-bot-*.tar.gz | tail -n +15 | xargs -r rm -f
