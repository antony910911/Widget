import { createApp, loadConfig } from './app.js';

const config = loadConfig();
if (!config.channelSecret || !config.accessToken) {
  console.warn('⚠️  尚未設定 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN，webhook 會拒絕所有請求（管理介面仍可使用）。');
}
if (!config.adminPassword) {
  console.warn('⚠️  未設定 ADMIN_PASSWORD，管理介面沒有密碼保護。對外公開前請務必設定。');
}
createApp(config).listen(config.port, config.host, () => {
  console.log(`✅ LINE File Bot 已啟動： http://localhost:${config.port}`);
  console.log(`   Webhook URL： https://<你的網域>/webhook`);
  console.log(`   檔案存放於： ${config.storageDir}`);
});
