#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { program } = require('commander');
const { executeScript } = require('./script');

/**
 * 读取 YAML 文件并解析为对象
 * @param {string} filePath - YAML 文件路径
 * @returns {Object} - 解析后的对象
 */
function readYamlFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content);
  } catch (error) {
    console.error(`无法读取或解析 YAML 文件 ${filePath}:`, error.message);
    process.exit(1);
  }
}

/**
 * 读取 JavaScript 脚本文件
 * @param {string} filePath - 脚本文件路径
 * @returns {string} - 脚本内容
 */
function readScriptFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`无法读取脚本文件 ${filePath}:`, error.message);
    process.exit(1);
  }
}

/**
 * 将对象写入为 YAML 文件
 * @param {Object} data - 要写入的对象
 * @param {string} filePath - 目标文件路径
 */
function writeYamlFile(data, filePath) {
  try {
    const yamlStr = yaml.dump(data, {
      lineWidth: 120,
      noRefs: true,
      noCompatMode: true,
      sortKeys: false
    });
    fs.writeFileSync(filePath, yamlStr, 'utf8');
    console.log(`配置已成功写入到 ${filePath}`);
  } catch (error) {
    console.error(`写入 YAML 文件 ${filePath} 时出错:`, error.message);
    process.exit(1);
  }
}

// 命令行参数解析
program
  .name('subscription-converter')
  .description('Clash 订阅转换工具，兼容 Clash Verge 的脚本格式')
  .version('1.0.0')
  .requiredOption('-i, --input <path>', '输入的订阅文件路径 (YAML 格式)')
  .requiredOption('-s, --script <path>', '要执行的脚本文件路径 (JavaScript)')
  .option('-o, --output <path>', '输出的订阅文件路径 (默认为覆盖输入文件)')
  .option('-n, --name <name>', '配置文件名称 (传递给脚本的 profileName 参数)', '')
  .parse(process.argv);

const options = program.opts();

// 主函数
function main() {
  // 读取输入文件
  const configPath = path.resolve(options.input);
  const config = readYamlFile(configPath);

  // 读取脚本文件
  const scriptPath = path.resolve(options.script);
  const script = readScriptFile(scriptPath);

  // 执行脚本
  console.log(`处理配置文件: ${configPath}`);
  console.log(`使用脚本: ${scriptPath}`);
  const profileName = options.name || path.basename(configPath, path.extname(configPath));
  const processedConfig = executeScript(config, script, profileName);

  // 确定输出路径并写入文件
  const outputPath = options.output ? path.resolve(options.output) : configPath;
  writeYamlFile(processedConfig, outputPath);
}

// 执行主函数
main();