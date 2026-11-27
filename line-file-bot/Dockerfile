FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
# 檔案與資料庫都放在 /data，部署時把「永久磁碟 / Volume」掛載到 /data
ENV NODE_ENV=production PORT=3000 STORAGE_DIR=/data/storage DATA_DIR=/data/db
EXPOSE 3000
CMD ["node", "src/index.js"]
