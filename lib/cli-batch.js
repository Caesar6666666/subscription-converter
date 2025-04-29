#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { program } = require('commander');
const { batchProcess } = require('./batch');
const { executeScript } = require('./script');

// 命令行参数解析
program
  .name('subscription-converter-batch')
  .description('Clash 订阅批量转换工具，兼容 Clash Verge 的脚本格式')
  .version('1.0.0')
  .requiredOption('-i, --input <glob>', '输入的订阅文件路径模式 (例如: "*.yaml" 或 "configs/*.yaml")')
  .requiredOption('-s, --script <path>', '要执行的脚本文件路径 (JavaScript)')
  .option('-o, --output-dir <dir>', '输出目录，默认为当前目录下的 output 文件夹')
  .option('--overwrite', '覆盖原始文件，不创建新文件', false)
  .parse(process.argv);

const options = program.opts();

// 主函数
function main() {
  const outputDir = options.outputDir || path.join(process.cwd(), 'output');
  
  console.log('批量转换 Clash 订阅文件');
  console.log(`输入模式: ${options.input}`);
  console.log(`脚本文件: ${options.script}`);
  console.log(`${options.overwrite ? '覆盖原文件' : `输出到: ${outputDir}`}`);
  
  // 执行批量处理
  const results = batchProcess({
    inputPattern: options.input,
    scriptPath: options.script,
    outputDir: outputDir,
    overwrite: options.overwrite,
    executeScript: executeScript
  });
  
  // 统计结果
  const successful = results.filter(r => r.success).length;
  const failed = results.length - successful;
  
  console.log('\n处理完成:');
  console.log(`- 成功: ${successful} 个文件`);
  console.log(`- 失败: ${failed} 个文件`);
  
  if (failed > 0) {
    console.log('\n失败的文件:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`- ${r.input}: ${r.error}`);
    });
    process.exit(1);
  }
}

// 执行主函数
main();