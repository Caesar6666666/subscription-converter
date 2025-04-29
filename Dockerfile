FROM node:18-alpine

# 创建应用目录
WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install

# 复制项目文件
COPY . .

# 创建临时目录和缓存目录
RUN mkdir -p /app/temp /app/cache

# 设置权限
RUN chmod +x server.js
RUN chmod +x lib/index.js lib/cli-batch.js

# 暴露端口（可通过服务配置覆盖）
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production

# 启动服务
CMD ["node", "server.js"]