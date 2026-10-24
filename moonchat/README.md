# Moonchat 線上互動示範

以靜態檔案執行，包含情境切換、語氣切換、訊息輸入及清除對話。回覆為預設文字，不會呼叫 Grok，也不會傳送聊天內容。未包含任何金鑰或裝置控制功能。

發布：在 GitHub 專案 Settings → Pages，選擇 Deploy from a branch，分支 master、資料夾 / (root)，儲存。網站完成發布後，從 Pages 顯示的網站網址開啟 /moonchat/。

Grok 需要另外部署 Node.js 後端；GitHub Pages 無法執行後端或安全保存 API 金鑰。
