/**
 * codex-login.js - 内置浏览器登录模式（Codex / Qoder / Wukong）
 *
 * Codex、Qoder 和悟空自带 in-app browser。CLI 进程不能直接调用其内置浏览器工具，
 * 因此这里返回一个明确的浏览器登录 handoff，由 Agent 打开 URL 让用户扫码。
 */

'use strict';

const { detectActiveTool } = require('../core/utils');
const { resolveLoginUrl } = require('../core/env-manager');
const { t } = require('../core/i18n');

/** 支持内置浏览器 handoff 的工具列表 */
const BROWSER_HANDOFF_TOOLS = ['codex', 'qoder', 'qoderwork', 'wukong'];

const BROWSER_HANDOFF_TOOL_META = {
  codex: { browser: 'codex', displayName: 'Codex', flag: '--codex' },
  qoder: { browser: 'qoder', displayName: 'Qoder', flag: '--qoder' },
  qoderwork: { browser: 'qoderwork', displayName: 'QoderWork', flag: '--qoder' },
  wukong: { browser: 'wukong', displayName: '悟空（Wukong）', flag: '--wukong' },
};

function resolveBrowserHandoffToolMeta(toolName) {
  return BROWSER_HANDOFF_TOOL_META[toolName] || BROWSER_HANDOFF_TOOL_META.codex;
}

/**
 * 内置浏览器登录入口：不依赖 Playwright，也不走终端二维码接口。
 * 支持 Codex、Qoder 和悟空环境。
 * @param {object} [options]
 * @param {string} [options.tool] - 显式指定宿主工具：codex/qoder/wukong
 * @returns {Promise<object>} loginResult
 */
async function codexLogin(options = {}) {
  const { banner, info, warn, hint, label } = require('../core/chalk');
  const activeTool = detectActiveTool();

  const toolName = options.tool || (activeTool ? activeTool.tool : null);
  if (!toolName || !BROWSER_HANDOFF_TOOLS.includes(toolName)) {
    warn(t('codex_login.not_codex'));
  }
  const toolMeta = resolveBrowserHandoffToolMeta(toolName);

  banner(t('codex_login.title', toolMeta.flag, toolMeta.displayName));

  const loginUrl = options.loginUrl || resolveLoginUrl();

  info(t('codex_login.no_playwright', toolMeta.displayName));
  info(t('codex_login.using_browser', toolMeta.displayName));
  label('URL', loginUrl);
  hint(t('codex_login.browser_handoff_hint', toolMeta.displayName));

  return {
    status: 'need_codex_browser_login',
    handoff_type: 'browser',
    can_auto_use: false,
    agent_action: 'open_in_app_browser',
    browser_open_strategy: 'browser_use_iab',
    browser_use_local_redirect_fallback: true,
    required_agent_tool: 'browser-use:browser',
    required_runtime_tool: 'mcp__node_repl__js',
    login_url: loginUrl,
    browser: toolMeta.browser,
    post_login_check_command: 'openyida login --check-only --json',
    fallback_command: 'openyida login --browser',
    message: t('codex_login.handoff_message', toolMeta.displayName),
  };
}

module.exports = { codexLogin };
