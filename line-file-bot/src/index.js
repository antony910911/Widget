import { createApp, loadConfig } from './app.js';

const config = loadConfig();
createApp(config).listen(config.port, config.host, () => {
  console.log(`✅ LINE 檔案櫃已啟動：http://localhost:${config.port}`);
  console.log('   用瀏覽器打開網址，第一次會請你建立管理密碼，LINE 金鑰也在網頁「設定」頁填寫。');
  console.log(`   檔案存放於：${config.storageDir}`);
});
