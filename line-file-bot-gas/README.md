# LINE 檔案櫃 — Google Apps Script 版

LINE 群組裡傳的檔案、圖片、影片、語音，自動存到你的雲端空間，依檔名分類到資料夾，
標記是誰傳的，並提供網頁管理介面（圖示 / 清單顯示、依上傳者或標籤篩選）。

**免費、不用租主機**：程式跑在你自己的 Google 帳號上，只有群組有人傳東西時才會執行。

👉 **安裝教學：[SETUP.md](SETUP.md)**（全程用瀏覽器，約 15 分鐘）

## 功能

- 自動下載群組檔案，依副檔名分類（文件、試算表、簡報、圖片…），檔名含「報價」「發票」「合約」等關鍵字再放進子資料夾
- 自動標籤：`@上傳者`、分類、關鍵字、`群:群組名稱`
- 可以選擇存到 **Google 雲端硬碟**（預設）、**OneDrive** 或 **Dropbox**，隨時切換
- 檔案清單同時寫進一份 Google 試算表，也能直接在試算表裡篩選
- 網頁管理介面：搜尋、排序、縮圖、改分類（會實際搬移資料夾）、改名、刪除、編輯標籤
- 設定頁：LINE 金鑰、Webhook 網址、「開始使用」進度清單、分類規則編輯器、活動紀錄

## 和另一個版本（`../line-file-bot`，自架伺服器版）的差別

| | Google 版（這個） | 自架伺服器版 |
|---|---|---|
| 費用 | 免費 | 主機每月約 US$4–6 |
| 檔案存放 | Google 雲端硬碟 / OneDrive / Dropbox | 主機硬碟 |
| 單檔上限 | 約 50 MB | 無 |
| 預覽 PDF / 影片 | 開到雲端空間看 | 介面內直接預覽 |
| 下載 ZIP | 用雲端空間內建功能 | 介面內直接打包 |

## 接其他雲端空間

儲存空間是可抽換的模組。每一種空間是一個檔案（`src/11_storage_gdrive.js`、`12_storage_onedrive.js`、`13_storage_dropbox.js`），
要新增（例如 Box、pCloud），照 [`src/10_storage.js`](src/10_storage.js) 開頭說明的格式寫一個物件並呼叫 `registerStorage_()`，
其他程式不用改。再到 `ui/app.js` 的 `STORAGE_META` 加上圖示與說明、`showConnect()` 加上連接畫面即可。

iCloud 雲碟沒有對外的 API，無法支援。

## 開發

```
src/        伺服器程式（Apps Script，依檔名順序合併成 Code.gs）
ui/         網頁介面（index.html + styles.css + app.js，合併成 Index.html）
dist/       產生的檔案，貼到 Apps Script 用
dev/        本機模擬 Google 服務：gas-mock.js、假的 LINE/OneDrive/Dropbox、預覽伺服器
test/       測試
```

```bash
npm run build          # 產生 dist/
npm test               # 用模擬的 Google 服務跑測試
npm run dev -- --demo  # 本機預覽 http://localhost:3200（密碼 demo1234）
```

⚠️ Apps Script 的網頁可以用 `google.script.run` 呼叫**任何**名稱不是底線結尾的全域函式，
所以除了 `doGet`、`doPost` 和 `api*` 之外，全域函式一律要以 `_` 結尾（有測試會檢查）。

> 本機測試使用模擬的 Google 服務，涵蓋程式邏輯；實際的 Google、LINE、Microsoft、Dropbox 服務行為以官方為準。
