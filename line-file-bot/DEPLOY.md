# 部署到雲端主機（VPS）

整個流程約 15 分鐘。完成後會有：
- 24 小時運作的 Bot，開機自動啟動，當掉會自動重啟
- 自動申請、自動續期的 HTTPS 憑證（LINE webhook 規定要用 HTTPS）
- 管理介面：`https://你的網域`

## 0. 你需要準備

| 項目 | 說明 |
|---|---|
| 一台雲端主機 | **Ubuntu 24.04**，1 GB 記憶體就夠。硬碟依檔案量決定，建議 25 GB 以上 |
| LINE 金鑰 | Channel secret、Channel access token（取得方式見 README「設定 LINE Bot」） |
| 網域（可選） | 沒有網域也可以，腳本會自動用免費的 `你的IP.sslip.io` |

常見的雲端主機（每月約 US$4–6）：Vultr、DigitalOcean、Linode、AWS Lightsail、GCP（e2-micro 有免費額度）。
建立時選 **Ubuntu 24.04**，並且在主機商的防火牆／安全群組**開放 22、80、443 埠**。

## 1. 連線到主機

主機建立好後會拿到一個 IP（例如 `203.0.113.10`）。在自己電腦的終端機（Windows 用 PowerShell）輸入：

```bash
ssh root@203.0.113.10
```

（AWS Lightsail / GCP 可以直接在網頁上按「SSH」連線，預設使用者不是 root，下面的指令前面都要加 `sudo`。）

## 2.（有網域才需要）設定 DNS

到網域商的 DNS 設定新增一筆 **A 記錄**：

| 類型 | 名稱 | 值 |
|---|---|---|
| A | `bot`（或 `@`） | 主機 IP |

等幾分鐘生效，可用 `ping bot.你的網域.com` 確認是否指到主機 IP。

## 3. 下載程式並執行安裝腳本

```bash
apt-get update && apt-get install -y git
git clone -b claude/confident-tesla-r7k3hb https://github.com/antony910911/Widget.git
cd Widget/line-file-bot

# 有網域：
sudo bash deploy/install.sh bot.你的網域.com
# 沒有網域：
sudo bash deploy/install.sh
```

> 如果 GitHub 專案是私人的，`git clone` 會要求帳號密碼：帳號填 GitHub 使用者名稱，密碼要用
> [Personal access token](https://github.com/settings/tokens)（不是登入密碼）。

腳本會問你三件事：
1. LINE Channel secret
2. LINE Channel access token
3. 管理介面密碼（之後登入帳號是 `admin`）

腳本會自動完成：安裝 Node.js 22 與 Caddy → 把程式放到 `/opt/line-file-bot` → 設定開機自動啟動 → 設定 HTTPS。
最後會印出你的管理介面網址和 Webhook 網址。

## 4. 回 LINE Developers Console 設定 Webhook

**Messaging API** 分頁：
1. Webhook URL 填腳本印出來的 `https://…/webhook`
2. 按 **Verify** → 出現 Success 就成功了
3. 開啟 **Use webhook**
4. **Allow bot to join group chats** → 啟用
5. 到 LINE Official Account Manager 關閉「自動回應訊息」

把 Bot 邀進群組，傳一個檔案，再打開管理介面就會看到。

## 日常維護

| 想做什麼 | 指令 |
|---|---|
| 看即時紀錄（有沒有收到檔案、有沒有錯誤） | `journalctl -u line-file-bot -f` |
| 重新啟動 | `systemctl restart line-file-bot` |
| 修改金鑰 / 密碼 | `nano /opt/line-file-bot/.env`，存檔後重新啟動 |
| 修改分類規則 | `nano /opt/line-file-bot/config/rules.json`，存檔後重新啟動 |
| 查看硬碟剩餘空間 | `df -h /` |
| 檔案實際位置 | `/opt/line-file-bot/storage/` |

### 更新程式

```bash
cd ~/Widget && git pull
cd line-file-bot && sudo bash deploy/install.sh
```
重新執行安裝腳本就是更新；`.env`、資料庫、已下載的檔案都會保留，網域也會沿用上次的設定。

注意：`config/rules.json` 會被 repo 裡的版本覆蓋，如果你在主機上直接改過，請先把修改同步回 repo。

### 備份

```bash
sudo bash /opt/line-file-bot/deploy/backup.sh /root/backups
```
會把檔案、資料庫、`.env` 打包成 `line-file-bot-日期.tar.gz`，保留最近 14 份。
要每天凌晨 3 點自動備份：執行 `crontab -e`，加入這一行

```
0 3 * * * bash /opt/line-file-bot/deploy/backup.sh /root/backups
```

主機壞掉時備份也會一起消失，所以重要的話請定期把備份下載回自己電腦：
```bash
scp root@主機IP:/root/backups/line-file-bot-*.tar.gz .
```
也可以開啟主機商提供的自動快照（Snapshot / Backup）功能。

### 從自己電腦直接把全部檔案抓下來

```bash
scp -r root@主機IP:/opt/line-file-bot/storage ./LINE檔案
```

## 疑難排解

| 狀況 | 怎麼處理 |
|---|---|
| 網頁打不開 | 確認主機商防火牆有開 80、443；剛安裝完要等幾十秒申請憑證。看 `journalctl -u caddy -n 50` |
| Verify 失敗 | 看 `journalctl -u line-file-bot -n 50`。出現 `bad signature` 代表 Channel secret 填錯 |
| 群組傳檔案沒反應 | 確認 Use webhook 已開、Bot 有在群組裡；紀錄出現 `LINE API 401` 代表 access token 錯誤 |
| 上傳者顯示「成員xxxx」 | 查不到成員名稱（通常是 token 權限問題），檔案仍會正常存下 |
| 硬碟滿了 | 在管理介面刪除不需要的檔案，或到主機商擴充硬碟 |

## 不用安裝腳本、想自己手動裝？

腳本做的事情都在 `deploy/install.sh` 裡，可以照著一行一行做：
1. 安裝 Node.js 22（NodeSource）和 Caddy
2. 程式複製到 `/opt/line-file-bot`，執行 `npm ci --omit=dev`
3. 建立 `.env`（`HOST=127.0.0.1` 讓程式只接受本機連線，外部一律經過 Caddy 的 HTTPS）
4. `deploy/line-file-bot.service` 複製到 `/etc/systemd/system/` 並 `systemctl enable --now line-file-bot`
5. `/etc/caddy/Caddyfile` 寫入 `你的網域 { reverse_proxy 127.0.0.1:3000 }`，`systemctl reload caddy`
