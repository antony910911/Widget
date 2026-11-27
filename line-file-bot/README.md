# LINE 檔案櫃 Bot

> 💡 不想租主機？另有免費的 **Google Apps Script 版**，檔案可存到 Google 雲端硬碟 / OneDrive / Dropbox：見 [`../line-file-bot-gas`](../line-file-bot-gas/)。

把 Bot 加進 LINE 群組後，成員在群組裡傳的**檔案、圖片、影片、語音**會自動：

1. **下載**到伺服器
2. 依**檔名 / 副檔名分類**到資料夾（文件、試算表、簡報、圖片…；檔名有「報價」「發票」「合約」等關鍵字會再放進子資料夾）
3. 自動加上**標籤**：`@上傳者名稱`、分類、關鍵字標籤、`群:群組名稱`
4. 在**網頁管理介面**中瀏覽：點上傳者就列出這個人傳的所有東西，可切換**清單**或**檔案類型圖示**顯示

## 完整的網頁工具

部署好之後只要打開網址，**所有設定都在網頁上完成**，不需要改任何檔案：

- 第一次開啟：建立管理密碼（登入頁，之後 30 天內免重新登入）
- 「設定」頁：貼上 LINE 金鑰、一鍵複製 Webhook 網址、測試連線，並自動檢查 LINE 後台的 Webhook 設定是否正確
- 「開始使用」清單：每完成一步自動打勾，直到收到第一個檔案
- 在網頁上編輯分類規則，並可一鍵套用到現有檔案
- 活動紀錄：即時看到 Bot 收到哪些檔案、有沒有錯誤
- 下載 ZIP：目前篩選的檔案（例如某個人傳的全部檔案），或完整備份

> 為什麼不能只是一個靜態網頁？LINE 必須把訊息送到一個 24 小時運作的網址，所以程式要放在伺服器上執行。
> 部署方式請看 **[DEPLOY.md](DEPLOY.md)**（可以全程用雲端平台的網頁操作）。

## 檔案管理功能

- 左側：分類資料夾、上傳者、群組、標籤，點選即可篩選（可多選，條件為「且」）
- 搜尋：檔名、上傳者、標籤
- 排序：最新 / 最早 / 檔名 / 大小
- 圖示模式：圖片顯示縮圖，其他檔案顯示依類型上色的圖示（PDF、DOCX、XLSX、ZIP…）
- 點檔案開啟詳細資訊：預覽（圖片、影片、音訊、PDF）、下載、重新命名、刪除、**改分類（實際搬移資料夾）**、**新增 / 移除標籤**
- 支援手動上傳（按鈕或直接拖放到頁面）
- 手機版可用，每 30 秒自動更新

## 資料夾結構範例

```
storage/
├── 文件/
│   ├── 報價單/2026Q4_報價單_客戶A.pdf
│   ├── 合約/合約_範本_最終版.docx
│   └── 會議紀錄_1125.docx
├── 試算表/年度預算表.xlsx
├── 圖片/圖片_20261127_103015.jpg   ← LINE 圖片沒有檔名，用「類型_日期_時間」命名
└── 壓縮檔/素材包.zip
```

同名檔案會自動改名為 `檔名 (1).pdf`，不會覆蓋。

## 安裝與執行

需要 Node.js 20.12 以上。

```bash
cd line-file-bot
npm install
npm start                # 打開 http://localhost:3000，建立密碼後到「設定」頁填 LINE 金鑰
```

先想看看介面長怎樣？執行 `npm run seed-demo` 會建立 18 筆示範檔案。

## 設定 LINE Bot

網頁「設定」頁的「開始使用」清單會一步一步帶你做，簡要流程：

1. 到 [LINE Developers Console](https://developers.line.biz/console/) 建立 Provider 與 **Messaging API channel**
2. **Basic settings** 複製 `Channel secret`，貼到網頁「設定 › LINE 連線」
3. **Messaging API** 分頁最下方發行 `Channel access token (long-lived)`，貼到同一處，按「儲存並測試」
4. **Messaging API** 分頁：
   - Webhook URL 貼上設定頁顯示的網址，開啟 **Use webhook**，按 Verify
   - **Allow bot to join group chats** 設為「啟用」
   - 到 LINE Official Account Manager 把「自動回應訊息」關掉（不然 Bot 會在群組亂回話）
5. 用手機掃 QR code 加 Bot 好友，再把它**邀請進群組**

> Webhook 必須是 **HTTPS** 公開網址。本機測試可用 `ngrok http 3000`，把產生的網址填進 Webhook URL。

## 部署建議

👉 **雲端主機一步一步教學與一鍵安裝腳本：請看 [DEPLOY.md](DEPLOY.md)**

這個程式會把檔案存在磁碟上，所以要部署在**有永久磁碟**的地方：

- 自己的電腦 / NAS + ngrok 或 Cloudflare Tunnel（最簡單，檔案直接在自己硬碟上）
- VPS（Linode、GCP、AWS Lightsail…）+ Nginx/Caddy 提供 HTTPS
- Render / Railway / Fly.io：記得掛 Persistent Disk / Volume，並把 `STORAGE_DIR`、`DATA_DIR` 指到那個路徑

部署後請**馬上打開網址建立管理密碼**：在密碼建立之前，第一個打開網頁的人可以設定密碼。

## 環境變數（可選）

一般不需要設定，LINE 金鑰與密碼在網頁上填即可。網頁上的設定優先於環境變數。

| 變數 | 說明 |
|---|---|
| `LINE_CHANNEL_SECRET` | Channel secret，用來驗證 webhook 簽章 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Channel access token，用來下載檔案、查詢成員名稱 |
| `ADMIN_PASSWORD` | 預設管理密碼（在網頁上改過密碼後就以網頁為準） |
| `PORT` | 埠號，預設 3000 |
| `HOST` | 監聽位址，預設全部；放在反向代理後面時設 `127.0.0.1` |
| `STORAGE_DIR` | 檔案存放位置，預設 `./storage` |
| `DATA_DIR` | 資料庫位置，預設 `./data`（`db.json`） |
| `REPLY_ON_SAVE` | `true` 時存檔後在群組回覆「已收到」 |
| `RULES_PATH` | 預設分類規則檔，預設 `config/rules.json` |

## 自訂分類規則

在網頁「設定 › 分類規則」編輯即可，立即生效。`config/rules.json` 是預設值（「還原預設規則」會回到這份）：

- `categories`：分類名稱、圖示類型、對應的副檔名
- `keywordRules`：檔名包含 `keywords` 任一字 → 加上 `tag`；有填 `folder` 就放進該子資料夾

```json
{ "keywords": ["報價", "quotation"], "tag": "報價單", "folder": "報價單" }
```

## 注意事項

- LINE 只保留訊息內容一段時間，Bot 必須在**收到訊息當下**下載，Bot 加入群組之前的舊檔案抓不到。
- LINE 群組裡的「相簿」與「記事本」內容不會送到 webhook，只有直接傳在聊天室的檔案 / 圖片 / 影片 / 語音會被收錄。
- 活動紀錄只存在記憶體中，伺服器重新啟動後會清空（檔案與設定不受影響）。
- 成員名稱是傳檔當下的 LINE 顯示名稱（快取 24 小時）。若成員改名，新檔案會用新名字的標籤；舊檔可在介面手動修改標籤。
- 只會下載檔案，不會記錄文字對話內容。

## 測試

```bash
npm test
```

測試會啟動一個假的 LINE API，驗證首次建立密碼與登入、在網頁設定金鑰、簽章檢查、下載、分類、標籤、依上傳者篩選、ZIP 匯出、改規則重新分類、搬檔與刪除。

## 程式結構

```
src/
├── index.js       啟動程式
├── app.js         Express：webhook 與管理 API
├── ingest.js      處理 LINE 事件：下載 → 分類 → 存檔 → 加標籤
├── line.js        LINE API（簽章驗證、下載內容、查詢名稱）
├── classifier.js  依副檔名 / 關鍵字分類
├── files.js       檔案搬移、避免重名、防路徑穿越
└── store.js       JSON 資料庫
public/            管理介面（純 HTML/CSS/JS，不需建置）
config/rules.json  分類規則
```
