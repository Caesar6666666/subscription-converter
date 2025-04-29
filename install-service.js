#!/usr/bin/env node

/**
 * Clash订阅转换器 - systemd服务安装脚本
 * 
 * 此脚本可以帮助用户在Linux系统上安装订阅转换器作为systemd服务
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// 创建交互式命令行界面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 获取当前执行路径作为安装路径
const APP_PATH = path.resolve(__dirname);
const BIN_PATH = path.join(APP_PATH, 'server.js');
const SERVICE_NAME = 'clash-subscription-converter';
const SERVICE_FILE = `/etc/systemd/system/${SERVICE_NAME}.service`;

/**
 * 生成systemd服务文件内容
 * @param {string} username 运行服务的用户名
 * @param {string} description 服务描述
 * @returns {string} 服务文件内容
 */
function generateServiceFile(username, description) {
  return `[Unit]
Description=${description}
After=network.target

[Service]
Type=simple
User=${username}
WorkingDirectory=${APP_PATH}
ExecStart=/usr/bin/node ${BIN_PATH}
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
`;
}

/**
 * 检查是否有sudo权限
 * @returns {boolean} 是否有sudo权限
 */
function checkSudo() {
  try {
    execSync('sudo -n true', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 安装systemd服务
 */
async function installService() {
  console.log('====== Clash订阅转换器 - systemd服务安装 ======\n');
  
  if (!checkSudo()) {
    console.error('错误: 此脚本需要sudo权限来安装systemd服务');
    console.log('请使用 sudo node install-service.js 运行此脚本');
    process.exit(1);
  }
  
  // 确保服务脚本存在且可执行
  try {
    fs.accessSync(BIN_PATH, fs.constants.X_OK);
  } catch (error) {
    console.log('添加执行权限到服务脚本...');
    execSync(`chmod +x ${BIN_PATH}`);
  }
  
  // 提示用户输入服务描述和运行用户
  const askDescription = () => {
    return new Promise((resolve) => {
      rl.question('输入服务描述 [Clash订阅管理与转换服务]: ', (answer) => {
        resolve(answer || 'Clash订阅管理与转换服务');
      });
    });
  };
  
  const askUsername = () => {
    return new Promise((resolve) => {
      // 获取当前用户名作为默认值
      const currentUser = execSync('whoami').toString().trim();
      rl.question(`输入运行服务的用户名 [${currentUser}]: `, (answer) => {
        resolve(answer || currentUser);
      });
    });
  };
  
  const description = await askDescription();
  const username = await askUsername();
  
  try {
    // 生成服务文件
    const serviceContent = generateServiceFile(username, description);
    
    // 写入服务文件
    console.log(`创建systemd服务文件: ${SERVICE_FILE}`);
    execSync(`sudo bash -c "echo '${serviceContent}' > ${SERVICE_FILE}"`);
    
    // 重载systemd
    console.log('重新加载systemd配置...');
    execSync('sudo systemctl daemon-reload');
    
    // 启用服务
    console.log('启用服务...');
    execSync(`sudo systemctl enable ${SERVICE_NAME}`);
    
    // 提示用户选择是否立即启动服务
    rl.question('是否立即启动服务? (y/n) [y]: ', (answer) => {
      if (answer.toLowerCase() !== 'n') {
        try {
          console.log('启动服务...');
          execSync(`sudo systemctl start ${SERVICE_NAME}`);
          console.log('服务已启动');
        } catch (error) {
          console.error(`启动服务时出错: ${error.message}`);
        }
      }
      
      console.log('\n====== 安装完成 ======');
      console.log(`服务名称: ${SERVICE_NAME}`);
      console.log('管理服务的命令:');
      console.log(`  启动: sudo systemctl start ${SERVICE_NAME}`);
      console.log(`  停止: sudo systemctl stop ${SERVICE_NAME}`);
      console.log(`  重启: sudo systemctl restart ${SERVICE_NAME}`);
      console.log(`  状态: sudo systemctl status ${SERVICE_NAME}`);
      console.log(`  查看日志: sudo journalctl -u ${SERVICE_NAME}`);
      
      rl.close();
    });
  } catch (error) {
    console.error(`安装服务时出错: ${error.message}`);
    rl.close();
    process.exit(1);
  }
}

/**
 * 卸载systemd服务
 */
function uninstallService() {
  console.log('====== Clash订阅转换器 - systemd服务卸载 ======\n');
  
  if (!checkSudo()) {
    console.error('错误: 此脚本需要sudo权限来卸载systemd服务');
    console.log('请使用 sudo node install-service.js uninstall 运行此脚本');
    process.exit(1);
  }
  
  try {
    // 检查服务是否存在
    try {
      fs.accessSync(SERVICE_FILE, fs.constants.F_OK);
    } catch (error) {
      console.log(`服务文件不存在: ${SERVICE_FILE}`);
      process.exit(0);
    }
    
    // 停止服务
    console.log('停止服务...');
    try {
      execSync(`sudo systemctl stop ${SERVICE_NAME}`);
    } catch (error) {
      console.log('服务未运行或无法停止');
    }
    
    // 禁用服务
    console.log('禁用服务...');
    try {
      execSync(`sudo systemctl disable ${SERVICE_NAME}`);
    } catch (error) {
      console.log('服务无法禁用');
    }
    
    // 删除服务文件
    console.log(`删除服务文件: ${SERVICE_FILE}`);
    execSync(`sudo rm -f ${SERVICE_FILE}`);
    
    // 重载systemd
    console.log('重新加载systemd配置...');
    execSync('sudo systemctl daemon-reload');
    
    console.log('\n====== 卸载完成 ======');
    console.log(`服务 ${SERVICE_NAME} 已成功卸载`);
  } catch (error) {
    console.error(`卸载服务时出错: ${error.message}`);
    process.exit(1);
  }
  
  process.exit(0);
}

// 主函数
function main() {
  // 检查是否为卸载命令
  if (process.argv.includes('uninstall')) {
    uninstallService();
    return;
  }
  
  // 默认为安装命令
  installService();
}

// 执行主函数
main();