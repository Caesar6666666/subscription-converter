/**
 * 执行脚本并转换配置
 * @param {Object} config - 订阅配置对象
 * @param {string} script - JavaScript 脚本内容
 * @param {string} profileName - 配置名称
 * @returns {Object} - 处理后的配置对象
 */
function executeScript(config, script, profileName) {
  // 创建一个虚拟的控制台来捕获日志
  const logs = [];
  const virtualConsole = {
    log: (...args) => {
      logs.push(['log', args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')]);
      console.log(...args);
    },
    info: (...args) => {
      logs.push(['info', args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')]);
      console.info(...args);
    },
    error: (...args) => {
      logs.push(['error', args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')]);
      console.error(...args);
    },
    debug: (...args) => {
      logs.push(['debug', args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')]);
      console.debug(...args);
    }
  };

  // 验证输入配置
  validateConfig(config);

  try {
    // 创建深拷贝以防止引用问题
    const configCopy = JSON.parse(JSON.stringify(config));

    // 性能优化：检查脚本是否包含main函数声明
    if (!script.includes('function main')) {
      throw new Error('脚本中缺少main函数声明');
    }

    // 创建超时保护，防止脚本无限执行
    const timeoutMs = 10000; // 10秒超时
    let hasTimedOut = false;
    const timeoutId = setTimeout(() => {
      hasTimedOut = true;
    }, timeoutMs);

    // 将脚本包装在函数中执行
    const scriptFunction = new Function('console', 'config', 'profileName', `
      // 添加超时检测
      const startTime = Date.now();
      const checkTimeout = () => {
        if (Date.now() - startTime > ${timeoutMs - 1000}) {
          throw new Error('脚本执行超时');
        }
      };
      
      ${script}
      
      // 确保main函数被正确定义
      if (typeof main !== 'function') {
        throw new Error('脚本中缺少main函数或main不是一个函数');
      }
      
      // 执行main函数
      const result = main(config, profileName);
      checkTimeout(); // 再次检查超时
      return result;
    `);

    // 执行脚本并获取结果
    const result = scriptFunction(virtualConsole, configCopy, profileName);
    
    // 清除超时
    clearTimeout(timeoutId);
    
    // 如果已超时但还未抛出异常，这里手动抛出
    if (hasTimedOut) {
      throw new Error('脚本执行超时');
    }
    
    // 检查结果是否有效
    if (!result || typeof result !== 'object') {
      throw new Error('脚本的main函数必须返回配置对象');
    }

    // 验证结果配置
    validateConfig(result, true);

    return result;
  } catch (error) {
    console.error('执行脚本时出错:', error.message);
    console.error('脚本日志:', logs);
    
    // 提供更友好的错误消息
    let errorMessage = error.message;
    if (error instanceof SyntaxError) {
      errorMessage = `脚本语法错误: ${error.message}`;
    } else if (error.message.includes('is not defined')) {
      errorMessage = `脚本引用了未定义的变量: ${error.message}`;
    } else if (error.message.includes('is not a function')) {
      errorMessage = `脚本尝试调用不是函数的对象: ${error.message}`;
    }
    
    throw new Error(`脚本执行失败: ${errorMessage}`);
  }
}

/**
 * 验证配置对象的正确性
 * @param {Object} config - 配置对象
 * @param {boolean} isResult - 是否为脚本处理后的结果配置
 */
function validateConfig(config, isResult = false) {
  if (!config || typeof config !== 'object') {
    throw new Error('配置必须是有效的对象');
  }
  
  // 如果是结果配置，验证必要字段
  if (isResult) {
    // 确保规则数组结构正确
    if (config.rules && !Array.isArray(config.rules)) {
      throw new Error('rules必须是数组');
    }
    
    // 确保代理数组结构正确
    if (config.proxies && !Array.isArray(config.proxies)) {
      throw new Error('proxies必须是数组');
    }
    
    // 确保代理组数组结构正确
    if (config["proxy-groups"] && !Array.isArray(config["proxy-groups"])) {
      throw new Error('proxy-groups必须是数组');
    }
    
    // 检查端口字段类型
    const portFields = ['port', 'socks-port', 'mixed-port'];
    portFields.forEach(field => {
      if (config[field] !== undefined && 
          (typeof config[field] !== 'number' || 
           config[field] < 0 || 
           config[field] > 65535)) {
        throw new Error(`${field}必须是0-65535之间的有效端口号`);
      }
    });
    
    // 检查模式字段
    if (config.mode && !['rule', 'global', 'direct'].includes(config.mode)) {
      throw new Error('mode必须是rule、global或direct之一');
    }
  }
}

/**
 * 处理脚本执行过程中的日志记录
 * @param {Array} logs - 日志数组
 * @returns {string} 格式化的日志字符串
 */
function formatScriptLogs(logs) {
  if (!logs || logs.length === 0) return '没有日志记录';
  
  return logs.map(([level, message]) => {
    switch (level) {
      case 'error': return `[错误] ${message}`;
      case 'info': return `[信息] ${message}`;
      case 'debug': return `[调试] ${message}`;
      default: return `[日志] ${message}`;
    }
  }).join('\n');
}

module.exports = { 
  executeScript,
  validateConfig,
  formatScriptLogs
};