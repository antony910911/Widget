# 部署教學

LINE 會把群組訊息送到一個「24 小時開著的網址」，所以這個工具需要放在一台伺服器上執行，
不能只是一個靜態網頁（例如 GitHub Pages）。部署好之後，**所有設定都在網頁上完成**：

1. 打開網址 → 建立管理密碼
2. 「設定」頁貼上 LINE 金鑰 → 複製 Webhook 網址貼到 LINE 後台
3. 照著「開始使用」清單做，每完成一步會自動打勾

下面兩種方式擇一。

---

## 方式 A：雲端平台（全程用網頁操作，不用打指令）

適用於 Zeabur、Railway、Render 這類「從 GitHub 部署」的平台。專案裡已經有 `Dockerfile`，平台會自動辨識。

> ⚠️ 平台的介面常改版，按鈕名稱可能和下面不完全一樣。這幾個平台都**沒有**實際測試過，以下是通用步驟。

1. 在平台上選「從 GitHub 部署」，選擇 `Widget` 這個 repo，分支選 `claude/confident-tesla-r7k3hb`
2. **Root Directory（根目錄）** 設為 `line-file-bot`
3. **新增永久磁碟（Volume / Disk）**，掛載路徑（Mount path）填 **`/data`**
   - 這一步很重要：沒有永久磁碟的話，每次重新部署，下載的檔案和設定都會消失
4. 對外埠號（Port）是 `3000`。平台通常會自動偵測，或自己提供 `PORT` 環境變數，兩種都可以
5. 產生公開網址（Generate Domain），平台會自動提供 HTTPS
6. 用瀏覽器打開那個網址，照畫面做

費用參考：需要永久磁碟的方案通常不是免費方案，約每月 US$5 起，依平台而定。

---

## 方式 B：自己的雲端主機（VPS）

便宜（約每月 US$4–6）、檔案容量大，適合檔案很多的群組。只需要在主機上貼幾行指令。

### 1. 租一台主機
Vultr、DigitalOcean、Linode、AWS Lightsail、GCP 都可以。選 **Ubuntu 24.04**、1 GB 記憶體，
硬碟依檔案量決定（建議 25 GB 以上），並在主機商防火牆**開放 22、80、443 埠**。

### 2.（可選）設定網域
有網域的話，到網域商新增一筆 **A 記錄**指向主機 IP。沒有網域也沒關係，會自動使用免費的 `你的IP.sslip.io`。

### 3. 連線並安裝
在自己電腦的終端機（Windows 用 PowerShell）輸入 `ssh root@主機IP`，然後貼上：

```bash
apt-get update && apt-get install -y git
git clone -b claude/confident-tesla-r7k3hb https://github.com/antony910911/Widget.git
cd Widget/line-file-bot
sudo bash deploy/install.sh                  # 沒有網域
# sudo bash deploy/install.sh bot.你的網域.com  # 有網域
```

腳本會自動安裝 Node.js 與 Caddy、設定開機自動啟動與 HTTPS，最後印出網址。
接下來用瀏覽器打開那個網址，其餘都在網頁上設定。

> 如果 GitHub repo 是私人的，`git clone` 時帳號填 GitHub 使用者名稱，密碼要用
> [Personal access token](https://github.com/settings/tokens)。

### 更新程式
```bash
cd ~/Widget && git pull && cd line-file-bot && sudo bash deploy/install.sh
```
設定、資料庫、已下載的檔案都會保留。

---

## 平常會用到的（都在網頁上）

| 想做什麼 | 在哪裡 |
|---|---|
| 確認 Bot 有沒有正常收到檔案 | 設定 › 活動紀錄 |
| 換 LINE 金鑰 / 測試連線 | 設定 › LINE 連線 |
| 改分類規則、套用到舊檔案 | 設定 › 分類規則 |
| 備份全部檔案 | 設定 › 備份 › 下載完整備份 |
| 下載某個人傳的所有檔案 | 檔案頁點選上傳者 › 「下載這些檔案 (ZIP)」 |
| 改密碼 | 設定 › 變更管理密碼 |

## 疑難排解

| 狀況 | 處理方式 |
|---|---|
| 網頁打不開 | VPS：確認防火牆有開 80、443；剛裝好要等幾十秒申請憑證。平台：確認有產生公開網址 |
| LINE 後台按 Verify 失敗 | 看「活動紀錄」：出現「簽章錯誤」代表 Channel secret 填錯；沒有任何紀錄代表網址貼錯 |
| 測試連線顯示 401 | Channel access token 錯誤或過期，重新產生一組貼上 |
| 群組傳檔案沒反應 | 看「開始使用」清單哪一步沒打勾 |
| 忘記管理密碼 | VPS：刪除 `/opt/line-file-bot/data/settings.json` 裡的 `passwordHash` 那一行後執行 `systemctl restart line-file-bot`，再打開網頁重新建立 |
| 伺服器重開後活動紀錄不見 | 正常，活動紀錄只保留在記憶體中；檔案與設定不受影響 |
