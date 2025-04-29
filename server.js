#!/usr/bin/env node

/**
 * Clash订阅管理服务
 * 
 * 功能：
 * 1. 从配置文件读取脚本路径和服务端口
 * 2. 通过HTTP接口接收订阅链接和名称
 * 3. 每次请求实时下载订阅并处理
 * 4. 支持订阅缓存，在下载失败时使用上次内容
 * 5. 支持HTTPS和HTTP访问，可配置强制使用HTTPS
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { executeScript } = require('./lib/script');

// 默认配置
const DEFAULT_CONFIG = {
  scriptPath: './rules-script.js',
  port: 3000,
  useCache: true,
  https: {
    enabled: false,
    forceHttps: false,
    port: 443,
    certPath: './cert/server.crt',
    keyPath: './cert/server.key'
  }
};

// 常量定义
const CONFIG_FILE = path.join(__dirname, 'service-config.yaml');
const CACHE_DIR = path.join(__dirname, 'cache');
const OS_TEMP_DIR = require('os').tmpdir(); // 使用系统临时目录

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 创建Express应用
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 读取服务配置文件
 * @returns {Object} 配置对象
 */
function readServiceConfig() {
  try {
    // 检查配置文件是否存在
    if (!fs.existsSync(CONFIG_FILE)) {
      console.log(`配置文件不存在，创建默认配置文件：${CONFIG_FILE}`);
      fs.writeFileSync(
        CONFIG_FILE, 
        yaml.dump(DEFAULT_CONFIG),
        'utf8'
      );
    }

    // 读取配置文件
    const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = yaml.load(configContent);
    
    // 验证和设置默认值
    if (!config.scriptPath) {
      console.warn('配置文件中未指定脚本路径，使用默认值');
      config.scriptPath = DEFAULT_CONFIG.scriptPath;
    }
    
    if (!config.port) {
      console.warn('配置文件中未指定端口，使用默认值');
      config.port = DEFAULT_CONFIG.port;
    }
    
    if (config.useCache === undefined) {
      console.warn('配置文件中未指定是否使用缓存，使用默认值');
      config.useCache = DEFAULT_CONFIG.useCache;
    }
    
    // 初始化HTTPS配置（如果不存在）
    if (!config.https) {
      console.warn('配置文件中未指定HTTPS配置，使用默认值');
      config.https = DEFAULT_CONFIG.https;
    } else {
      // 设置缺失的HTTPS配置项
      if (config.https.enabled === undefined) {
        config.https.enabled = DEFAULT_CONFIG.https.enabled;
      }
      if (config.https.forceHttps === undefined) {
        config.https.forceHttps = DEFAULT_CONFIG.https.forceHttps;
      }
      if (!config.https.port) {
        config.https.port = DEFAULT_CONFIG.https.port;
      }
      if (!config.https.certPath) {
        config.https.certPath = DEFAULT_CONFIG.https.certPath;
      }
      if (!config.https.keyPath) {
        config.https.keyPath = DEFAULT_CONFIG.https.keyPath;
      }
    }
    
    return config;
  } catch (error) {
    console.error(`无法读取或解析配置文件: ${error.message}`);
    console.log('使用默认配置');
    return DEFAULT_CONFIG;
  }
}

// 如果启用了HTTPS强制重定向，添加中间件重定向HTTP请求
app.use((req, res, next) => {
  const config = readServiceConfig();
  
  if (config.https.enabled && config.https.forceHttps && !req.secure) {
    // 获取请求协议是否为HTTPS
    const isHttps = req.secure || (req.headers['x-forwarded-proto'] === 'https');
    
    if (!isHttps) {
      // 构建重定向URL
      const host = req.headers.host.split(':')[0]; // 去除端口
      const redirectUrl = `https://${host}:${config.https.port}${req.url}`;
      
      console.log(`重定向HTTP请求到: ${redirectUrl}`);
      return res.redirect(301, redirectUrl);
    }
  }
  
  next();
});

/**
 * 下载订阅内容
 * @param {string} url 订阅URL
 * @param {boolean} useCache 是否使用缓存
 * @returns {Promise<{content: any, headers: Object}>} 订阅内容和响应头
 */
async function downloadSubscription(url, useCache = true) {
  // 为URL创建唯一标识符作为缓存文件名 - 使用MD5哈希
  const cacheKey = crypto.createHash('md5').update(url).digest('hex');
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.cache`);
  const headersCachePath = path.join(CACHE_DIR, `${cacheKey}.headers.json`);
  
  try {
    // 尝试下载订阅内容
    console.log(`开始下载订阅: ${url}`);
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'ClashSubscriptionConverter/1.0 (Clash)',
      },
      // 启用完整的响应对象以获取响应头
      validateStatus: status => status < 400
    });
    
    const content = response.data;
    const responseHeaders = response.headers;
    
    // 将内容保存到缓存
    fs.writeFileSync(cachePath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
    // 将响应头保存到缓存
    fs.writeFileSync(headersCachePath, JSON.stringify(responseHeaders), 'utf8');
    
    console.log(`订阅下载成功，已缓存: ${url}`);
    console.log(`响应头已缓存: ${JSON.stringify(responseHeaders)}`);
    
    return { content, headers: responseHeaders };
  } catch (error) {
    console.error(`下载订阅失败 ${url}: ${error.message}`);
    
    // 如果允许使用缓存，检查是否有缓存内容
    if (useCache && fs.existsSync(cachePath)) {
      console.log(`使用缓存内容: ${url}`);
      const cachedContent = fs.readFileSync(cachePath, 'utf8');
      let headers = {};
      
      // 尝试读取缓存的响应头
      if (fs.existsSync(headersCachePath)) {
        try {
          headers = JSON.parse(fs.readFileSync(headersCachePath, 'utf8'));
        } catch (headersError) {
          console.error(`解析缓存的响应头失败: ${headersError.message}`);
        }
      }
      
      try {
        const content = typeof cachedContent === 'string' 
          ? (cachedContent.trim().startsWith('{') ? JSON.parse(cachedContent) : cachedContent) 
          : cachedContent;
        return { content, headers };
      } catch (parseError) {
        console.error(`解析缓存内容失败: ${parseError.message}`);
        throw new Error(`下载订阅失败且缓存内容无效: ${url}`);
      }
    } else {
      throw new Error(`下载订阅失败且无可用缓存: ${url}`);
    }
  }
}

/**
 * 处理单个订阅
 * @param {string} subscriptionUrl 订阅URL
 * @param {string} profileName 配置文件名称
 * @param {string} scriptPath 修改脚本路径
 * @param {boolean} useCache 是否使用缓存
 * @param {Object} requestHeaders 请求头，用于检测客户端
 * @returns {Promise<{filePath: string, fileName: string, headers: Object}>} 处理后的配置文件路径、文件名和响应头
 */
async function processSubscription(subscriptionUrl, profileName, scriptPath, useCache, requestHeaders) {
  // 为配置文件生成唯一名称
  const configFileName = `clash_${profileName || 'config'}_${Date.now()}.yaml`;
  const tempFilePath = path.join(OS_TEMP_DIR, configFileName);
  
  console.log(`处理订阅: ${subscriptionUrl}, 名称: ${profileName || '未指定'}`);
  
  // 下载订阅内容
  const { content: subscriptionContent, headers: responseHeaders } = await downloadSubscription(subscriptionUrl, useCache);
  
  // 将订阅内容解析为对象
  let config;
  try {
    config = yaml.load(subscriptionContent);
    
    if (!config || typeof config !== 'object') {
      throw new Error('订阅内容不是有效的YAML');
    }
  } catch (error) {
    throw new Error(`解析订阅内容失败: ${error.message}`);
  }
  
  // 读取修改脚本
  let script;
  try {
    script = fs.readFileSync(scriptPath, 'utf8');
  } catch (error) {
    throw new Error(`读取修改脚本失败: ${error.message}`);
  }
  
  // 执行修改脚本
  let processedConfig;
  try {
    processedConfig = executeScript(config, script, profileName || '');
  } catch (error) {
    throw new Error(`执行修改脚本失败: ${error.message}`);
  }
  
  // 将处理后的配置写入临时文件
  try {
    const yamlStr = yaml.dump(processedConfig, {
      lineWidth: 120,
      noRefs: true,
      noCompatMode: true,
      sortKeys: false
    });
    fs.writeFileSync(tempFilePath, yamlStr, 'utf8');
    console.log(`处理后的配置已写入临时文件: ${tempFilePath}`);
  } catch (error) {
    throw new Error(`写入配置文件失败: ${error.message}`);
  }
  
  // 确定文件名
  let fileName = profileName ? `${profileName}.yaml` : 'config.yaml';
  
  // 返回处理结果
  return { 
    filePath: tempFilePath, 
    fileName, 
    headers: responseHeaders 
  };
}

// 主页路由 - 提供使用说明和API文档
app.get('/', (req, res) => {
  const config = readServiceConfig();
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Clash订阅转换服务</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          line-height: 1.6;
        }
        h1, h2, h3 {
          color: #333;
          margin-top: 20px;
        }
        h1 {
          border-bottom: 1px solid #eee;
          padding-bottom: 10px;
        }
        code {
          background-color: #f5f5f5;
          padding: 2px 5px;
          border-radius: 3px;
          font-family: monospace;
        }
        pre {
          background-color: #f5f5f5;
          padding: 10px;
          border-radius: 5px;
          overflow-x: auto;
        }
        .endpoint {
          margin: 15px 0;
          padding: 15px;
          background-color: #f9f9f9;
          border-left: 4px solid #0066cc;
        }
        .method {
          font-weight: bold;
          color: #0066cc;
        }
        .config-info {
          margin-top: 20px;
          padding: 10px;
          background-color: #f0f0f0;
          border-radius: 5px;
        }
      </style>
    </head>
    <body>
      <h1>Clash订阅转换服务</h1>
      <p>此服务可从网络获取Clash订阅内容，应用自定义修改脚本，并提供下载。</p>
      
      <div class="config-info">
        <h3>当前配置</h3>
        <ul>
          <li>脚本路径: ${config.scriptPath}</li>
          <li>服务端口: ${config.port}</li>
          <li>使用缓存: ${config.useCache ? '是' : '否'}</li>
          <li>HTTPS: ${config.https.enabled ? '已启用' : '未启用'} ${config.https.forceHttps ? '(强制HTTPS)' : ''}</li>
          ${config.https.enabled ? `<li>HTTPS端口: ${config.https.port}</li>` : ''}
        </ul>
      </div>
      
      <h2>API接口</h2>
      
      <div class="endpoint">
        <p><span class="method">GET</span> /convert</p>
        <p>通过URL参数转换单个订阅</p>
        <p>参数:</p>
        <ul>
          <li><code>url</code> (必需) - 订阅链接</li>
          <li><code>name</code> (可选) - 配置名称，用于脚本中的profileName参数</li>
          <li><code>noCache</code> (可选) - 设置为1时不使用缓存</li>
        </ul>
        <p>示例:</p>
        <pre>/convert?url=https://example.com/subscription&name=my_config</pre>
      </div>
      
      <div class="endpoint">
        <p><span class="method">POST</span> /convert</p>
        <p>通过POST请求转换单个订阅</p>
        <p>请求体格式 (JSON):</p>
        <pre>{
  "url": "https://example.com/subscription",
  "name": "my_config",
  "noCache": false
}</pre>
      </div>
      
      <h2>使用说明</h2>
      <p>如果不设置名称参数，在脚本中profileName属性将为空字符串，可能导致某些依赖配置名称的脚本功能失效。</p>
      <p>当订阅下载失败时，系统会尝试使用之前缓存的内容（如果存在且允许使用缓存）。</p>
      <p>注意：系统不会自动清理缓存文件，如需清理请手动删除 cache 目录中的文件。处理后的临时文件会在下载完成后自动删除。</p>
      ${config.https.enabled && config.https.forceHttps ? '<p><strong>注意：</strong> 当前已启用强制HTTPS，所有HTTP请求将自动重定向到HTTPS。</p>' : ''}
    </body>
    </html>
  `;
  
  res.send(html);
});

// GET请求 - 通过URL参数转换订阅
app.get('/convert', async (req, res) => {
  let tempFilePath = null;
  
  try {
    const config = readServiceConfig();
    
    // 获取参数
    const subscriptionUrl = req.query.url;
    const profileName = req.query.name || '';
    const noCache = req.query.noCache === '1';
    
    if (!subscriptionUrl) {
      return res.status(400).send('缺少订阅链接参数 (url)');
    }
    
    // 处理订阅
    const useCache = !noCache && config.useCache;
    const result = await processSubscription(
      subscriptionUrl, 
      profileName, 
      config.scriptPath,
      useCache,
      req.headers
    );
    
    tempFilePath = result.filePath;
    const fileName = result.fileName;
    const originalHeaders = result.headers;
    
    // 检查客户端是否是Clash（User-Agent中包含"clash"）
    const isClashClient = req.headers['user-agent'] && 
                          req.headers['user-agent'].toLowerCase().includes('clash');
    
    // 如果是Clash客户端，传递原始订阅的特定响应头
    if (isClashClient) {
      // 处理content-disposition响应头
      if (originalHeaders['content-disposition']) {
        res.setHeader('Content-Disposition', originalHeaders['content-disposition']);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileName)}`);
      }
      
      // 传递profile-update-interval响应头（更新间隔）
      if (originalHeaders['profile-update-interval']) {
        res.setHeader('Profile-Update-Interval', originalHeaders['profile-update-interval']);
      }
      
      // 传递subscription-userinfo响应头（流量信息）
      if (originalHeaders['subscription-userinfo']) {
        res.setHeader('Subscription-Userinfo', originalHeaders['subscription-userinfo']);
      }
      
      // 传递profile-web-page-url响应头（订阅首页链接）
      if (originalHeaders['profile-web-page-url']) {
        res.setHeader('Profile-Web-Page-Url', originalHeaders['profile-web-page-url']);
      }
      
      console.log('检测到Clash客户端，传递原始订阅的响应头');
    } else {
      // 自定义发送文件，避免文件名引号问题
      res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileName)}`);
    }
    
    // 设置通用响应头
    res.setHeader('Content-Type', 'application/x-yaml');
    
    // 使用管道发送文件并在完成后删除临时文件
    const fileStream = fs.createReadStream(tempFilePath);
    fileStream.pipe(res);
    
    // 在流结束或出错时清理临时文件
    let cleaned = false;
    const cleanupTemp = () => {
      if (!cleaned && tempFilePath) {
        try {
          fs.unlinkSync(tempFilePath);
          cleaned = true;
          console.log(`已删除临时文件: ${tempFilePath}`);
        } catch (err) {
          console.error(`删除临时文件失败: ${err.message}`);
        }
      }
    };
    
    fileStream.on('end', cleanupTemp);
    fileStream.on('error', cleanupTemp);
    res.on('finish', cleanupTemp);
    res.on('close', cleanupTemp);
    
  } catch (error) {
    // 如果处理过程中出错，也要清理临时文件
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`已删除临时文件: ${tempFilePath}`);
      } catch (err) {
        console.error(`删除临时文件失败: ${err.message}`);
      }
    }
    
    res.status(500).send(`处理订阅时出错: ${error.message}`);
  }
});

// POST请求 - 通过POST请求转换订阅
app.post('/convert', async (req, res) => {
  let tempFilePath = null;
  
  try {
    const config = readServiceConfig();
    
    // 获取参数
    const { url: subscriptionUrl, name: profileName, noCache } = req.body;
    
    if (!subscriptionUrl) {
      return res.status(400).send('缺少订阅链接参数 (url)');
    }
    
    // 处理订阅
    const useCache = !noCache && config.useCache;
    const result = await processSubscription(
      subscriptionUrl, 
      profileName || '', 
      config.scriptPath,
      useCache,
      req.headers
    );
    
    tempFilePath = result.filePath;
    const fileName = result.fileName;
    const originalHeaders = result.headers;
    
    // 检查客户端是否是Clash（User-Agent中包含"clash"）
    const isClashClient = req.headers['user-agent'] && 
                          req.headers['user-agent'].toLowerCase().includes('clash');
    
    // 如果是Clash客户端，传递原始订阅的特定响应头
    if (isClashClient) {
      // 处理content-disposition响应头
      if (originalHeaders['content-disposition']) {
        res.setHeader('Content-Disposition', originalHeaders['content-disposition']);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileName)}`);
      }
      
      // 传递profile-update-interval响应头（更新间隔）
      if (originalHeaders['profile-update-interval']) {
        res.setHeader('Profile-Update-Interval', originalHeaders['profile-update-interval']);
      }
      
      // 传递subscription-userinfo响应头（流量信息）
      if (originalHeaders['subscription-userinfo']) {
        res.setHeader('Subscription-Userinfo', originalHeaders['subscription-userinfo']);
      }
      
      // 传递profile-web-page-url响应头（订阅首页链接）
      if (originalHeaders['profile-web-page-url']) {
        res.setHeader('Profile-Web-Page-Url', originalHeaders['profile-web-page-url']);
      }
      
      console.log('检测到Clash客户端，传递原始订阅的响应头');
    } else {
      // 自定义发送文件，避免文件名引号问题
      res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileName)}`);
    }
    
    // 设置通用响应头
    res.setHeader('Content-Type', 'application/x-yaml');
    
    // 使用管道发送文件并在完成后删除临时文件
    const fileStream = fs.createReadStream(tempFilePath);
    fileStream.pipe(res);
    
    // 在流结束或出错时清理临时文件
    let cleaned = false;
    const cleanupTemp = () => {
      if (!cleaned && tempFilePath) {
        try {
          fs.unlinkSync(tempFilePath);
          cleaned = true;
          console.log(`已删除临时文件: ${tempFilePath}`);
        } catch (err) {
          console.error(`删除临时文件失败: ${err.message}`);
        }
      }
    };
    
    fileStream.on('end', cleanupTemp);
    fileStream.on('error', cleanupTemp);
    res.on('finish', cleanupTemp);
    res.on('close', cleanupTemp);
    
  } catch (error) {
    // 如果处理过程中出错，也要清理临时文件
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`已删除临时文件: ${tempFilePath}`);
      } catch (err) {
        console.error(`删除临时文件失败: ${err.message}`);
      }
    }
    
    res.status(500).send(`处理订阅时出错: ${error.message}`);
  }
});

// 启动服务
const config = readServiceConfig();
const httpPort = process.env.PORT || config.port || 3000;

// 创建HTTP服务器
const httpServer = http.createServer(app);

// 启动HTTP服务
httpServer.listen(httpPort, () => {
  console.log(`HTTP服务已启动在 http://localhost:${httpPort}`);
});

// 如果启用了HTTPS，创建HTTPS服务器
if (config.https && config.https.enabled) {
  try {
    // 检查证书文件路径是否存在
    const certDir = path.dirname(config.https.certPath);
    const keyDir = path.dirname(config.https.keyPath);
    
    // 检查证书文件是否存在
    const certExists = fs.existsSync(config.https.certPath);
    const keyExists = fs.existsSync(config.https.keyPath);
    
    if (!certExists || !keyExists) {
      console.warn(`HTTPS证书文件不存在: ${!certExists ? config.https.certPath : ''} ${!keyExists ? config.https.keyPath : ''}`);
      console.warn('HTTPS将不会启用，请检查证书路径配置');
    } else {
      // 读取证书文件
      const httpsOptions = {
        cert: fs.readFileSync(config.https.certPath),
        key: fs.readFileSync(config.https.keyPath)
      };
      
      // 创建HTTPS服务器
      const httpsServer = https.createServer(httpsOptions, app);
      
      // 启动HTTPS服务
      httpsServer.listen(config.https.port, () => {
        console.log(`HTTPS服务已启动在 https://localhost:${config.https.port}`);
        if (config.https.forceHttps) {
          console.log('已启用强制HTTPS，所有HTTP请求将被重定向到HTTPS');
        }
      });
    }
  } catch (error) {
    console.error(`启动HTTPS服务失败: ${error.message}`);
  }
}

// 显示应用信息
console.log(`配置文件: ${CONFIG_FILE}`);
console.log(`脚本路径: ${config.scriptPath}`);
console.log(`使用缓存: ${config.useCache ? '是' : '否'}`);