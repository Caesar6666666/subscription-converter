# Clash订阅管理与转换服务

这是一个自动化的Clash订阅管理服务，可以从网络下载订阅内容，应用自定义修改脚本，然后提供处理后的配置文件下载。

## 主要功能

- 根据URL参数下载最新的订阅内容
- 应用JavaScript修改脚本处理配置（如添加自定义规则、代理组等）, 参考https://www.clashverge.dev/guide/script.html
- 支持配置名称参数，传递给修改脚本使用
- 支持缓存功能，当下载失败时使用缓存内容
- 通过Web界面提供RESTful API
- 支持安装为systemd系统服务
- 支持HTTPS安全访问，可配置强制HTTPS

## 安装与运行

### 直接运行

1. 安装依赖

```bash
npm install
```

2. 修改配置文件 `service-config.yaml`

```yaml
# 修改脚本路径
scriptPath: ./ai-rules-script.js
# 服务端口
port: 3000
# 是否使用缓存
useCache: true
# HTTPS配置
https:
  # 是否启用HTTPS
  enabled: false
  # 是否强制使用HTTPS（当同时启用HTTP和HTTPS时，将HTTP请求重定向到HTTPS）
  forceHttps: false
  # HTTPS端口，默认为443
  port: 443
  # SSL证书路径
  certPath: ./cert/server.crt
  # SSL私钥路径
  keyPath: ./cert/server.key
```

3. 运行服务

```bash
npm start
```

服务默认在 http://localhost:3000 启动。

### 配置HTTPS访问

1. 准备SSL证书

   您可以使用自签名证书（仅用于测试）或从Let's Encrypt等机构获取免费证书：

   ```bash
   # 创建证书目录
   mkdir -p cert

   # 生成自签名证书（仅用于测试）
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout cert/server.key -out cert/server.crt
   ```

2. 修改配置文件中的HTTPS设置

   ```yaml
   # HTTPS配置
   https:
     enabled: true
     forceHttps: true  # 设置为true可以强制所有HTTP请求重定向到HTTPS
     port: 443
     certPath: ./cert/server.crt
     keyPath: ./cert/server.key
   ```

3. 重启服务

   修改配置后重启服务，HTTPS服务将在指定端口启动。如果启用了forceHttps选项，所有HTTP请求将自动重定向到HTTPS端口。

### 作为systemd服务运行 (仅Linux)

1. 安装依赖

```bash
npm install
```

2. 运行安装脚本 (需要sudo权限)

```bash
sudo node install-service.js
```

3. 按照提示操作，设置服务描述和运行用户

安装完成后，服务将自动启动并设置为开机自启动。您可以使用以下命令管理服务：

```bash
# 启动服务
sudo systemctl start clash-subscription-converter

# 停止服务
sudo systemctl stop clash-subscription-converter

# 重启服务
sudo systemctl restart clash-subscription-converter

# 查看服务状态
sudo systemctl status clash-subscription-converter

# 查看日志
sudo journalctl -u clash-subscription-converter
```

4. 卸载服务

```bash
sudo node install-service.js uninstall
```

### 使用Docker

1. 构建Docker镜像

```bash
docker build -t clash-subscription-converter .
```

2. 运行容器

```bash
docker run -d -p 3000:3000 --name clash-converter clash-subscription-converter
```

3. 使用卷挂载配置和缓存(可选)

```bash
docker run -d -p 3000:3000 \
  -v /path/to/config:/app/service-config.yaml \
  -v /path/to/cache:/app/cache \
  --name clash-converter clash-subscription-converter
```

## API接口

### 获取转换后的配置文件 (GET)

```
GET /convert?url=订阅链接&name=配置名称&noCache=0
```

参数说明：
- `url`: (必需) 要转换的订阅链接
- `name`: (可选) 配置名称，用于传递给修改脚本
- `noCache`: (可选) 设置为1时不使用缓存

### 获取转换后的配置文件 (POST)

```
POST /convert
Content-Type: application/json

{
  "url": "订阅链接",
  "name": "配置名称",
  "noCache": false
}
```

## 修改脚本编写

修改脚本需要定义一个`main`函数，接收两个参数：
- `config`: Clash配置对象
- `profileName`: 配置文件名称(如果未提供name参数则为空字符串)

脚本示例 (rules-script.js):

```javascript
function main(config, profileName) {
  console.log(`处理配置: ${profileName}`);
  
  // 添加自定义规则
  if (!config.rules) {
    config.rules = [];
  }
  
  // 添加AI相关规则
  const aiRules = [
    'DOMAIN-SUFFIX,example.com,AI'
    // 更多规则...
  ];
  
  config.rules = aiRules.concat(config.rules);
  
  // 返回修改后的配置
  return config;
}
```

## 配置说明

在`service-config.yaml`中可以配置以下选项：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| scriptPath | 修改脚本的路径 | ./rules-script.js |
| port | 服务运行的端口 | 3000 |
| useCache | 是否启用缓存功能 | true |
| https.enabled | 是否启用HTTPS | false |
| https.forceHttps | 是否强制使用HTTPS | false |
| https.port | HTTPS服务端口 | 443 |
| https.certPath | SSL证书路径 | ./cert/server.crt |
| https.keyPath | SSL私钥路径 | ./cert/server.key |

## 缓存机制

- 每次下载订阅内容后会自动缓存
- 当下载失败且`useCache`为`true`时，会使用缓存内容
- 可以通过`noCache=1`请求参数强制忽略缓存
- 缓存文件保存在`cache`目录中

## 注意事项

- 如果不提供`name`参数，脚本中的`profileName`参数将为空字符串，基于订阅文件名的规则脚本请务必设置。
- 作为systemd服务运行时，请确保运行用户对应用目录有足够的权限。
- 使用HTTPS时，请确保证书文件路径正确且有效，否则HTTPS服务将无法启动。
- 如果使用自签名证书，浏览器可能会显示安全警告，这是正常现象。在生产环境中，建议使用受信任的SSL证书。
- 启用`forceHttps`选项后，所有HTTP请求将自动重定向到HTTPS。请确保HTTPS服务正常运行，否则将无法访问服务。