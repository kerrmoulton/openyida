#!/usr/bin/env node
/**
 * 钉钉 CLI (dws) 包装器
 *
 * 功能：
 * 1. 检测并提示安装钉钉 CLI
 * 2. 透传所有 dws 命令到系统安装的 dws
 * 3. 展示官方安装指引，由用户独立安装
 */

'use strict';

const { execSync, spawn } = require('child_process');
const { t } = require('../core/i18n');
const { c, warn } = require('../core/chalk');

const DWS_BINARY_NAME = 'dws';
const INSTALL_SCRIPTS = {
  unix: 'curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh',
  windows: 'irm https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.ps1 | iex'
};

/**
 * 检查 dws 是否已安装
 * @returns {boolean}
 */
function isDwsInstalled() {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${command} ${DWS_BINARY_NAME}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取 dws 版本
 * @returns {string|null}
 */
function getDwsVersion() {
  try {
    const output = execSync(`${DWS_BINARY_NAME} version`, { encoding: 'utf8' });
    return output.trim();
  } catch {
    return null;
  }
}

/**
 * 显示安装指引
 */
function showInstallGuide() {
  const RESET   = c.reset;
  const BOLD    = c.bold;
  const DIM     = c.dim;
  const CYAN    = c.cyan;
  const GREEN   = c.green;
  const YELLOW  = c.yellow;
  const BLUE    = c.blue;

  const BG_BLUE = c.bgBlue;
  const WHITE   = c.white;

  const isWindows = process.platform === 'win32';
  const installCommand = isWindows ? INSTALL_SCRIPTS.windows : INSTALL_SCRIPTS.unix;

  console.log('');
  console.log(`${BG_BLUE}${WHITE}${BOLD}  钉钉 CLI (dws) 安装指引  ${RESET}`);
  console.log('');
  console.log(`${YELLOW}${t('dws_external.note')}${RESET}`);
  console.log('');
  console.log(`${BOLD}钉钉 CLI 是什么？${RESET}`);
  console.log('  钉钉官方推出的跨平台 CLI 工具，覆盖以下核心能力：');
  console.log('  • 通讯录管理 - 用户/部门搜索与管理');
  console.log('  • 日历日程 - 事件创建/闲忙查询/会议室预定');
  console.log('  • 待办任务 - 任务创建/分配/跟踪');
  console.log('  • 审批流程 - 表单/实例管理');
  console.log('  • 考勤打卡 - 排班/统计/打卡记录');
  console.log('  • 智能表格 - AI 表格操作');
  console.log('  • DING 消息 - 发送/撤回');
  console.log('  • 群聊管理 - 群成员/机器人消息');
  console.log('  • 更多：日志、工作台、开发者文档等');
  console.log('');
  console.log(`${BOLD}快速安装（推荐）${RESET}`);
  console.log('');

  if (isWindows) {
    console.log(`  ${GREEN}PowerShell:${RESET}`);
    console.log(`  ${installCommand}`);
    console.log('');
  } else {
    console.log(`  ${GREEN}macOS / Linux:${RESET}`);
    console.log(`  ${CYAN}${installCommand}${RESET}`);
    console.log('');
  }

  console.log(`${BOLD}手动安装：${RESET}`);
  console.log('  从 GitHub Releases 下载预编译二进制文件：');
  console.log('  https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases');
  console.log('');
  console.log(`${DIM}注意：使用本工具需要钉钉企业管理员授权。${RESET}`);
  console.log(`${DIM}参考：https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli${RESET}`);
  console.log('');
  console.log(`${BLUE}安装完成后，重新运行命令即可自动调用 dws${RESET}`);
  console.log('');
}

/**
 * 构建传递给 dws 的环境变量，注入私有化端点配置。
 * @returns {object} 合并后的环境变量对象
 */
function buildDwsEnv() {
  const env = { ...process.env };

  // 支持通过 OPENYIDA_DWS_ENDPOINT 指定私有化钉钉 OpenAPI 网关
  if (process.env.OPENYIDA_DWS_ENDPOINT) {
    // dws CLI 使用 DWS_ENDPOINT 环境变量指定网关地址
    env.DWS_ENDPOINT = process.env.OPENYIDA_DWS_ENDPOINT;
  }

  return env;
}

/**
 * 执行 dws 命令
 * @param {string[]} args - 命令行参数
 */
async function executeDwsCommand(args) {
  // 特殊处理 help 命令
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showDwsHelp();
    return;
  }

  // 特殊处理 install 命令
  if (args[0] === 'install' || args[0] === 'setup') {
    showInstallGuide();
    return;
  }

  // 检查是否已安装
  if (!isDwsInstalled()) {
    showInstallGuide();
    process.exitCode = 1;
    return;
  }

  // 透传命令到 dws，注入私有化端点环境变量
  try {
    const result = spawn(DWS_BINARY_NAME, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: buildDwsEnv(),
    });

    result.on('close', (code) => {
      process.exit(code);
    });

    result.on('error', (err) => {
      warn(t('cli.dws_exec_failed', '执行 dws 命令失败：'), err.message);
      process.exit(1);
    });
  } catch (error) {
    warn(t('cli.dws_exec_failed', '执行 dws 命令失败：'), error.message);
    process.exit(1);
  }
}

/**
 * 显示 dws 帮助信息
 */
function showDwsHelp() {
  const RESET   = c.reset;
  const BOLD    = c.bold;
  const CYAN    = c.cyan;
  const GREEN   = c.green;
  const YELLOW  = c.yellow;

  console.log('');
  console.log(`${BOLD}openyida dws - 钉钉 CLI 集成${RESET}`);
  console.log('');
  console.log(`${CYAN}用法：${RESET}`);
  console.log('  openyida dws <command> [args]');
  console.log('');
  console.log(`${CYAN}常用命令：${RESET}`);
  console.log('');
  console.log(`  ${GREEN}contact user search --keyword "悟空"${RESET}     搜索联系人`);
  console.log(`  ${GREEN}calendar event list${RESET}                       列出日历事件`);
  console.log(`  ${GREEN}todo task create --title "任务" --executors "ID"${RESET}  创建待办`);
  console.log(`  ${GREEN}approval instance list${RESET}                    列出审批实例`);
  console.log(`  ${GREEN}attendance record list${RESET}                    查询考勤记录`);
  console.log(`  ${GREEN}chat robot send --content "消息"${RESET}          发送机器人消息`);
  console.log('');
  console.log(`${CYAN}特殊命令：${RESET}`);
  console.log(`  ${GREEN}openyida dws install${RESET}                      ${t('dws_external.install_guide')}`);
  console.log(`  ${GREEN}openyida dws help${RESET}                         显示此帮助信息`);
  console.log('');
  console.log(`${YELLOW}提示：所有 dws 命令都可以通过 openyida dws <command> 执行${RESET}`);
  console.log('');
  console.log(`${CYAN}输出格式：${RESET}`);
  console.log('  默认使用表格输出（适合人类阅读）');
  console.log('  添加 -f json 参数使用 JSON 输出（适合 AI Agent）');
  console.log('');
  console.log(`${CYAN}更多信息：${RESET}`);
  console.log('  https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli');
  console.log('');
}

/**
 * 主函数
 * @param {string[]} args - 命令行参数
 */
async function run(args) {
  // 如果没有参数，显示帮助
  if (args.length === 0) {
    showDwsHelp();
    return;
  }

  await executeDwsCommand(args);
}

module.exports = {
  run,
  isDwsInstalled,
  getDwsVersion,
  showInstallGuide
};
