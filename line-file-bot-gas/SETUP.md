# 安裝教學（約 15 分鐘，全程用瀏覽器）

不用租主機、不用付錢。程式放在你自己的 Google 帳號裡，檔案預設存進你的 Google 雲端硬碟。

你需要：一個 Google 帳號、一個 LINE 帳號。

---

> 最簡單的方式：打開**安裝頁**（`dist/install.html`，也可以請 Claude 給你線上版連結），照著 4 步做，程式碼一鍵複製。

## 第 1 步：建立 Apps Script 專案

打開 <https://script.new>（會自動建立一個空白的 Apps Script 專案），可以把左上角「未命名的專案」改名為「LINE 檔案櫃」。

## 第 2 步：貼上程式碼（只有 1 個檔案）

複製 [`dist/Code.gs`](dist/Code.gs) 的全部內容（網頁介面已經包在裡面）。
回到 Apps Script，在編輯區全部選取（Ctrl+A / ⌘+A）後貼上，取代原本的 `function myFunction() {}`，按 💾 儲存。

## 第 3 步：部署成網頁

1. 右上角「**部署**」→「**新增部署作業**」
2. 「選取類型」旁的齒輪選「**網頁應用程式**」
3. 「執行身分」選「**我**」，「誰可以存取」選「**所有人**」
   （LINE 要能把訊息送進來，所以必須是「所有人」；管理介面另外有密碼保護）
4. 按「**部署**」→「**授予存取權**」→ 選你的 Google 帳號
5. 出現「**Google 尚未驗證這個應用程式**」：這是因為程式是你自己的，不是上架的 App。
   按左下「**進階**」→「**前往「LINE 檔案櫃」（不安全）**」→「**允許**」
6. 複製「**網頁應用程式網址**」（`https://script.google.com/macros/s/…/exec`）

## 第 4 步：打開網頁完成設定

1. 用瀏覽器打開剛剛的網址 → **建立管理密碼**（請馬上做：第一個打開的人可以設定密碼）
2. 自動跳到「設定」頁，照著「**開始使用**」清單做，每完成一步會自動打勾：
   - 到 [LINE Developers](https://developers.line.biz/console/) 建立 Provider → 建立 **Messaging API** channel
   - **Messaging API** 分頁最下方 Channel access token 按「Issue」，複製貼到設定頁 →「儲存並測試」
   - 複製設定頁的 **Webhook 網址**（整串，包含 `?key=…`）→ 貼到 LINE 的 Webhook URL → 開啟 **Use webhook**
     - 按「Verify」如果出現 `302` 之類的錯誤**可以忽略**（Google 的網址會轉址，但實際收訊息沒問題）。改看設定頁的「活動紀錄」有沒有出現「收到 LINE 的 Webhook 驗證請求」
   - 同一頁把「**Allow bot to join group chats**」設為啟用
   - 到 LINE Official Account Manager 關閉「**自動回應訊息**」
   - 用手機掃 Bot 的 QR code 加好友，再把它**邀請進群組**
3. 在群組傳一個檔案，到「檔案」頁按重新整理就會看到 🎉

檔案會存在你 Google 雲端硬碟的「**LINE 檔案櫃**」資料夾，旁邊還有一份「**LINE 檔案櫃 資料庫**」試算表，記錄每個檔案是誰傳的、標籤等等。

---

## 改存到 OneDrive

在「設定 › 儲存位置」按 OneDrive 的「連接」，畫面上會有步驟說明。簡單說：

1. 到 [Azure 應用程式註冊](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)（用 Microsoft 帳號登入，免費）→「新增註冊」
   - 支援的帳戶類型：「**任何組織目錄中的帳戶及個人 Microsoft 帳戶**」
   - 重新導向 URI：留空
2. 「驗證」→「**允許公用用戶端流程**」選「是」→ 儲存
3. 「概觀」複製「**應用程式 (用戶端) 識別碼**」貼到設定頁 →「開始登入」
4. 設定頁會顯示一組代碼，到 <https://microsoft.com/devicelogin> 輸入、登入、按「接受」
5. 連接成功後按「**改用這個**」

檔案會存在 OneDrive 的「LINE 檔案櫃」資料夾。

## 改存到 Dropbox

1. 到 [Dropbox App Console](https://www.dropbox.com/developers/apps/create)：Scoped access → **App folder** → 取名 → Create app
2. 「Permissions」勾選 `files.content.write`、`files.content.read`、`account_info.read` → Submit
3. 「Settings」複製 **App key**、**App secret** 貼到設定頁
4. 按「① 取得授權碼」→ 在 Dropbox 按「允許」→ 把授權碼貼回來 →「③ 連接」→「改用這個」

## iCloud？

Apple 沒有開放 iCloud 雲碟給第三方程式寫入，所以沒辦法直接存到 iCloud。
想在 iPhone 上方便地看檔案：安裝 **Google Drive** 或 **OneDrive** App 並登入，它們會出現在 iPhone 內建的「**檔案**」App 裡，和 iCloud 雲碟放在一起使用。

---

## 更新程式

之後有新版本時：
1. 把新的 `Code.gs` 貼上覆蓋 → 儲存
2. 「部署」→「**管理部署作業**」→ 點目前的部署旁的 ✏️ →「版本」選「**新版本**」→ 部署

**一定要用「管理部署作業」更新**，不要按「新增部署作業」，否則網址會變，LINE 那邊也要跟著改。
設定、密碼、已存的檔案都不受影響。

## 限制

| 項目 | 說明 |
|---|---|
| 單一檔案大小 | 最大約 **50 MB**（Google Apps Script 的限制），超過的會在活動紀錄顯示並略過 |
| 每日用量 | 免費 Google 帳號每天約可處理 2 萬次網路請求，一般群組遠遠用不完 |
| 速度 | 傳檔後約幾秒到十幾秒出現在介面上 |
| 舊訊息 | Bot 加入群組之前的檔案抓不到；群組「相簿」「記事本」裡的內容 LINE 不會送給 Bot |

## 疑難排解

| 狀況 | 處理方式 |
|---|---|
| 打開網址顯示「找不到指令碼函式：doGet」 | `Code.gs` 沒有貼完整或沒儲存，重新貼上後用「管理部署作業」部署新版本 |
| 網頁一片空白 | `Code.gs` 沒有貼完整（最後一行應該是 `const INDEX_HTML = …`），重新貼上並部署新版本 |
| 群組傳檔案沒反應 | 看「設定」頁「開始使用」哪一步沒打勾，以及「活動紀錄」裡的錯誤 |
| 活動紀錄出現「key 不正確」 | LINE 後台的 Webhook 網址沒有整串複製（少了 `?key=…`） |
| 忘記管理密碼 | Apps Script 編輯器 → 專案設定 → 指令碼屬性 → 刪除 `PW_HASH` → 打開網頁重新建立 |
