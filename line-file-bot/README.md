# LINE 檔案櫃 Bot

把 Bot 加進 LINE 群組後，成員在群組裡傳的**檔案、圖片、影片、語音**會自動：

1. **下載**到伺服器
2. 依**檔名 / 副檔名分類**到資料夾（文件、試算表、簡報、圖片…；檔名有「報價」「發票」「合約」等關鍵字會再放進子資料夾）
3. 自動加上**標籤**：`@上傳者名稱`、分類、關鍵字標籤、`群:群組名稱`
4. 在**網頁管理介面**中瀏覽：點上傳者就列出這個人傳的所有東西，可切換**清單**或**檔案類型圖示**顯示

## 管理介面功能

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
cp .env.example .env     # 填入 LINE 金鑰與管理密碼
npm start                # http://localhost:3000
```

先想看看介面長怎樣？執行 `npm run seed-demo` 會建立 18 筆示範檔案。

## 設定 LINE Bot

1. 到 [LINE Developers Console](https://developers.line.biz/console/) 建立 Provider 與 **Messaging API channel**
2. **Basic settings** 複製 `Channel secret` → `.env` 的 `LINE_CHANNEL_SECRET`
3. **Messaging API** 分頁最下方發行 `Channel access token (long-lived)` → `LINE_CHANNEL_ACCESS_TOKEN`
4. **Messaging API** 分頁：
   - Webhook URL 填 `https://你的網域/webhook`，開啟 **Use webhook**，按 Verify
   - **Allow bot to join group chats** 設為「啟用」
   - 到 LINE Official Account Manager 把「自動回應訊息」關掉（不然 Bot 會在群組亂回話）
5. 用手機掃 QR code 加 Bot 好友，再把它**邀請進群組**

> Webhook 必須是 **HTTPS** 公開網址。本機測試可用 `ngrok http 3000`，把產生的網址填進 Webhook URL。

## 部署建議

這個程式會把檔案存在磁碟上，所以要部署在**有永久磁碟**的地方：

- 自己的電腦 / NAS + ngrok 或 Cloudflare Tunnel（最簡單，檔案直接在自己硬碟上）
- VPS（Linode、GCP、AWS Lightsail…）+ Nginx/Caddy 提供 HTTPS
- Render / Railway / Fly.io：記得掛 Persistent Disk / Volume，並把 `STORAGE_DIR`、`DATA_DIR` 指到那個路徑

對外公開時**一定要設定 `ADMIN_PASSWORD`**（瀏覽器登入帳號填 `admin`，密碼為你設定的值）。

## 環境變數

| 變數 | 說明 |
|---|---|
| `LINE_CHANNEL_SECRET` | Channel secret，用來驗證 webhook 簽章 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Channel access token，用來下載檔案、查詢成員名稱 |
| `ADMIN_PASSWORD` | 管理介面密碼（帳號 admin）。留空 = 不設密碼 |
| `PORT` | 埠號，預設 3000 |
| `STORAGE_DIR` | 檔案存放位置，預設 `./storage` |
| `DATA_DIR` | 資料庫位置，預設 `./data`（`db.json`） |
| `REPLY_ON_SAVE` | `true` 時存檔後在群組回覆「已收到」 |
| `RULES_PATH` | 分類規則檔，預設 `config/rules.json` |

## 自訂分類規則

編輯 `config/rules.json`（改完重新啟動）：

- `categories`：分類名稱、圖示類型、對應的副檔名
- `keywordRules`：檔名包含 `keywords` 任一字 → 加上 `tag`；有填 `folder` 就放進該子資料夾

```json
{ "keywords": ["報價", "quotation"], "tag": "報價單", "folder": "報價單" }
```

## 注意事項

- LINE 只保留訊息內容一段時間，Bot 必須在**收到訊息當下**下載，Bot 加入群組之前的舊檔案抓不到。
- LINE 群組裡的「相簿」與「記事本」內容不會送到 webhook，只有直接傳在聊天室的檔案 / 圖片 / 影片 / 語音會被收錄。
- 成員名稱是傳檔當下的 LINE 顯示名稱（快取 24 小時）。若成員改名，新檔案會用新名字的標籤；舊檔可在介面手動修改標籤。
- 只會下載檔案，不會記錄文字對話內容。

## 測試

```bash
npm test
```

測試會啟動一個假的 LINE API，驗證簽章檢查、下載、分類、標籤、依上傳者篩選、改分類搬檔與刪除。

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
