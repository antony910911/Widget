/** 打開網址時顯示管理介面 */
function doGet() {
  // 單檔安裝版把網頁內容放在 INDEX_HTML（由 build.js 產生）；分開的 Index.html 檔也支援
  const out = typeof INDEX_HTML === 'string' ? HtmlService.createHtmlOutput(INDEX_HTML) : HtmlService.createHtmlOutputFromFile('Index');
  return out
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
