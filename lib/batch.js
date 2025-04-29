const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const glob = require('glob');
const { formatScriptLogs } = require('./script');

/**
 * 批处理多个订阅文件
 * @param {Object} options - 配置选项
 * @param {string} options.inputPattern - 输入文件的 glob 模式
 * @param {string} options.scriptPath - 脚本文件路径
 * @param {string} options.outputDir - 输出目录
 * @param {boolean} options.overwrite - 是否覆盖原始文件
 * @param {Function} options.executeScript - 执行脚本的函数
 * @returns {Array} - 处理结果的数组
 */
function batchProcess(options) {
  const {
    inputPattern,
    scriptPath,
    outputDir,
    overwrite = false,
    executeScript
  } = options;

  // 性能优化：使用 try-catch 包装整个函数以提供更好的错误处理
  try {
    // 读取脚本文件
    let script;
    try {
      script = fs.readFileSync(scriptPath, 'utf8');
    } catch (error) {
      throw new Error(`无法读取脚本文件 ${scriptPath}: ${error.message}`);
    }
    
    // 查找匹配的文件
    let files;
    try {
      files = glob.sync(inputPattern);
    } catch (error) {
      throw new Error(`无效的文件模式 ${inputPattern}: ${error.message}`);
    }
    
    if (files.length === 0) {
      console.warn(`没有找到匹配 ${inputPattern} 的文件`);
      return [];
    }
    
    // 确保输出目录存在
    if (!overwrite && outputDir) {
      try {
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
      } catch (error) {
        throw new Error(`无法创建输出目录 ${outputDir}: ${error.message}`);
      }
    }
    
    // 处理每个文件
    const results = [];
    const processedFiles = new Set(); // 用于跟踪已处理的文件以避免重复
    
    for (const file of files) {
      // 避免处理重复文件
      if (processedFiles.has(file)) {
        continue;
      }
      processedFiles.add(file);
      
      try {
        console.log(`处理文件: ${file}`);
        
        // 读取配置文件
        let config;
        try {
          const content = fs.readFileSync(file, 'utf8');
          config = yaml.load(content);
        } catch (error) {
          throw new Error(`读取或解析文件失败: ${error.message}`);
        }
        
        // 使用文件名作为配置名称
        const profileName = path.basename(file, path.extname(file));
        
        // 执行脚本转换
        const processedConfig = executeScript(config, script, profileName);
        
        // 确定输出路径
        const outputPath = overwrite
          ? file
          : outputDir
            ? path.join(outputDir, path.basename(file))
            : `${file}.converted.yaml`;
        
        // 写入结果
        try {
          const yamlStr = yaml.dump(processedConfig, {
            lineWidth: 120,
            noRefs: true, 
            noCompatMode: true,
            sortKeys: false
          });
          fs.writeFileSync(outputPath, yamlStr, 'utf8');
        } catch (error) {
          throw new Error(`写入结果失败: ${error.message}`);
        }
        
        results.push({
          input: file,
          output: outputPath,
          success: true
        });
        
        console.log(`已转换并保存到: ${outputPath}`);
      } catch (error) {
        console.error(`处理 ${file} 时出错:`, error.message);
        results.push({
          input: file,
          error: error.message,
          success: false
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error(`批处理过程中发生严重错误: ${error.message}`);
    return [{
      error: error.message,
      success: false
    }];
  }
}

/**
 * 并行批处理多个订阅文件（利用多核 CPU 加速处理）
 * @param {Object} options - 配置选项，与 batchProcess 相同
 * @param {number} options.concurrency - 并行处理的最大文件数量
 * @returns {Promise<Array>} - 处理结果的数组
 */
async function batchProcessParallel(options) {
  const {
    inputPattern,
    scriptPath,
    outputDir,
    overwrite = false,
    executeScript,
    concurrency = 4 // 默认并行数
  } = options;

  // 读取脚本文件
  let script;
  try {
    script = fs.readFileSync(scriptPath, 'utf8');
  } catch (error) {
    throw new Error(`无法读取脚本文件 ${scriptPath}: ${error.message}`);
  }
  
  // 查找匹配的文件
  let files;
  try {
    files = glob.sync(inputPattern);
  } catch (error) {
    throw new Error(`无效的文件模式 ${inputPattern}: ${error.message}`);
  }
  
  if (files.length === 0) {
    console.warn(`没有找到匹配 ${inputPattern} 的文件`);
    return [];
  }
  
  // 确保输出目录存在
  if (!overwrite && outputDir) {
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    } catch (error) {
      throw new Error(`无法创建输出目录 ${outputDir}: ${error.message}`);
    }
  }

  // 将文件分组，每个并行任务处理一组文件
  const fileGroups = [];
  for (let i = 0; i < files.length; i += concurrency) {
    fileGroups.push(files.slice(i, i + concurrency));
  }
  
  // 定义单个文件的处理函数
  const processFile = async (file) => {
    try {
      // 读取配置文件
      const content = fs.readFileSync(file, 'utf8');
      const config = yaml.load(content);
      
      // 使用文件名作为配置名称
      const profileName = path.basename(file, path.extname(file));
      
      // 执行脚本转换
      const processedConfig = executeScript(config, script, profileName);
      
      // 确定输出路径
      const outputPath = overwrite
        ? file
        : outputDir
          ? path.join(outputDir, path.basename(file))
          : `${file}.converted.yaml`;
      
      // 写入结果
      const yamlStr = yaml.dump(processedConfig, {
        lineWidth: 120,
        noRefs: true,
        noCompatMode: true,
        sortKeys: false
      });
      fs.writeFileSync(outputPath, yamlStr, 'utf8');
      
      console.log(`已转换并保存到: ${outputPath}`);
      
      return {
        input: file,
        output: outputPath,
        success: true
      };
    } catch (error) {
      console.error(`处理 ${file} 时出错:`, error.message);
      return {
        input: file,
        error: error.message,
        success: false
      };
    }
  };
  
  // 按组并行处理文件
  const results = [];
  for (const group of fileGroups) {
    const groupPromises = group.map(processFile);
    const groupResults = await Promise.all(groupPromises);
    results.push(...groupResults);
  }
  
  return results;
}

module.exports = { batchProcess, batchProcessParallel };