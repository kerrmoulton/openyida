/**
 * env-manager.js - 多环境配置管理
 *
 * 支持公有云与私有化宜搭并存，通过环境配置文件管理多套端点和登录态。
 *
 * 配置文件：{projectRoot}/.cache/openyida-envs.json
 * Cookie 隔离：.cache/cookies-{envName}.json
 *
 * 优先级（高 → 低）：
 *   1. 环境变量 OPENYIDA_ENDPOINT
 *   2. cookieData.base_url（登录后实际跳转域名）
 *   3. 环境变量 OPENYIDA_ENV 指定的环境配置
 *   4. 当前激活的环境配置（openyida-envs.json current 字段）
 *   5. 默认公有云 https://www.aliwork.com
 *
 * 导出函数：
 *   loadEnvsConfig()          - 读取环境配置文件（不存在则返回默认公有云配置）
 *   saveEnvsConfig(config)    - 写入环境配置文件
 *   getCurrentEnvConfig()     - 获取当前激活的环境配置（含环境变量覆盖）
 *   getCookieFilePath(root)   - 获取当前环境的 Cookie 文件绝对路径
 *   migrateOldCookieFile()    - 迁移旧版 cookies.json → cookies-public.json
 *   resolveEndpoint()         - 解析最终 baseUrl（含完整优先级）
 *   resolveLoginUrl()         - 解析最终登录 URL
 *   deriveBaseUrlFromLoginState() - 从 Cookie + 浏览器当前 URL 解析实际 baseUrl
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { findProjectRoot } = require('./utils');

const DEFAULT_BASE_URL = 'https://www.aliwork.com';
const DEFAULT_LOGIN_URL = 'https://www.aliwork.com/workPlatform';
const INTERNATIONAL_BASE_URL = 'https://www.yidaapps.com';
const DINGTALK_OAUTH_CLIENT_ID = 'suite9xvlxxerybljwheo';
const DINGTALK_LOGIN_ORIGIN = 'https://login.dingtalk.com';
const DINGTALK_INTL_LOGIN_ORIGIN = 'https://login.dingtalk.io';
const ALIBABA_INTERNAL_BASE_URL = 'https://yida-group.alibaba-inc.com';
const ALIBABA_INTERNAL_LOGIN_URL = `${ALIBABA_INTERNAL_BASE_URL}/workPlatform`;
const ENVS_CONFIG_FILE = 'openyida-envs.json';

function normalizeUrlOrigin(value, fallback) {
  const raw = value || fallback;
  const trimmed = String(raw || '').trim();
  if (!trimmed) {return fallback;}
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withProtocol).origin.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function buildDingtalkOAuthLoginUrl(options = {}) {
  const loginOrigin = normalizeUrlOrigin(options.loginOrigin || DINGTALK_LOGIN_ORIGIN, DINGTALK_LOGIN_ORIGIN);
  const baseUrl = normalizeUrlOrigin(options.baseUrl || DEFAULT_BASE_URL, DEFAULT_BASE_URL);
  const continueUrl = `${baseUrl}${options.continuePath || '/workPlatform'}`;
  const callbackUrl = `${baseUrl}/dingtalk_sso_call_back?continue=${encodeURIComponent(continueUrl)}`;
  const params = new URLSearchParams({
    redirect_uri: callbackUrl,
    response_type: 'code',
    client_id: options.clientId || DINGTALK_OAUTH_CLIENT_ID,
    scope: 'openid corpid',
    lang: options.lang || 'zh_CN',
  });
  if (options.forceLogin) {
    params.set('FEForceLogin', 'true');
  }

  return `${loginOrigin}/oauth2/auth?${params.toString()}`;
}

// 海外 YiDA / DingTalk International 登录入口。
// 必须满足三个条件才能让国际版钉钉扫码识别：
//   1. login origin 为 login.dingtalk.io
//   2. redirect_uri 落在 www.yidaapps.com（否则登完跳回国内域名，海外后端拿不到 session）
//   3. 追加 FEForceLogin=true，强制走国际版登录流程
const INTERNATIONAL_LOGIN_URL = buildDingtalkOAuthLoginUrl({
  loginOrigin: DINGTALK_INTL_LOGIN_ORIGIN,
  baseUrl: INTERNATIONAL_BASE_URL,
  lang: 'en_US',
  forceLogin: true,
});
const LEGACY_INTERNATIONAL_LOGIN_URL = buildDingtalkOAuthLoginUrl({
  loginOrigin: DINGTALK_INTL_LOGIN_ORIGIN,
  baseUrl: DEFAULT_BASE_URL,
  lang: 'en_US',
});

/** 默认公有云环境配置 */
const DEFAULT_PUBLIC_ENV = {
  baseUrl: DEFAULT_BASE_URL,
  loginUrl: DEFAULT_LOGIN_URL,
  description: '阿里云公有云宜搭',
  cookieFile: 'cookies-public.json',
};

/** 阿里内网宜搭环境配置 */
const DEFAULT_ALIBABA_INTERNAL_ENV = {
  baseUrl: ALIBABA_INTERNAL_BASE_URL,
  loginUrl: ALIBABA_INTERNAL_LOGIN_URL,
  description: '阿里内网宜搭',
  cookieFile: 'cookies-alibaba.json',
};

/** 海外版 YiDA / DingTalk International 环境配置 */
const DEFAULT_INTERNATIONAL_ENV = {
  baseUrl: INTERNATIONAL_BASE_URL,
  loginUrl: INTERNATIONAL_LOGIN_URL,
  description: '海外版 YiDA Apps / DingTalk International（www.yidaapps.com）',
  cookieFile: 'cookies-intl.json',
};

const BUILTIN_ENVIRONMENTS = {
  public: DEFAULT_PUBLIC_ENV,
  intl: DEFAULT_INTERNATIONAL_ENV,
  alibaba: DEFAULT_ALIBABA_INTERNAL_ENV,
};

const ENV_ALIASES = {
  public: 'public',
  aliyun: 'public',
  domestic: 'public',
  china: 'public',
  '国内': 'public',
  '国内版': 'public',
  '中国': 'public',
  '中国版': 'public',
  '国内宜搭': 'public',
  '中国宜搭': 'public',
  overseas: 'intl',
  oversea: 'intl',
  international: 'intl',
  global: 'intl',
  abroad: 'intl',
  intl: 'intl',
  '海外': 'intl',
  '海外版': 'intl',
  '国际': 'intl',
  '国际版': 'intl',
  '全球': 'intl',
  '全球版': 'intl',
  '海外宜搭': 'intl',
  '海外yida': 'intl',
  '国际宜搭': 'intl',
  '全球宜搭': 'intl',
  '日本': 'intl',
  '日本宜搭': 'intl',
  '日本yida': 'intl',
  alibaba: 'alibaba',
  internal: 'alibaba',
  intranet: 'alibaba',
  '阿里': 'alibaba',
  '阿里内网': 'alibaba',
  '内网': 'alibaba',
};

const SHARED_COOKIE_DOMAINS = new Set([
  'aliwork.com',
  'yidaapps.com',
  'alibaba-inc.com',
  'yidaapps.com',
]);

const KNOWN_YIDA_HOSTS = new Set([
  'www.aliwork.com',
  'www.yidaapps.com',
  'yida-group.alibaba-inc.com',
  'www.yidaapps.com',
]);

function cloneBuiltinEnvironments() {
  return Object.fromEntries(
    Object.entries(BUILTIN_ENVIRONMENTS).map(([name, envConfig]) => [name, { ...envConfig }])
  );
}

function buildDefaultEnvsConfig() {
  return {
    current: 'public',
    environments: cloneBuiltinEnvironments(),
  };
}

function resolveEnvNameAlias(envName) {
  if (!envName) {return envName;}
  const normalized = String(envName).trim().toLowerCase();
  return ENV_ALIASES[normalized] || envName;
}

function ensureBuiltinEnvironments(config) {
  if (!config.environments) { config.environments = {}; }
  for (const [envName, envConfig] of Object.entries(BUILTIN_ENVIRONMENTS)) {
    if (!config.environments[envName]) {
      config.environments[envName] = { ...envConfig };
    }
  }
  if (isLegacyInternationalEnv(config.environments.intl)) {
    config.environments.intl = { ...DEFAULT_INTERNATIONAL_ENV };
  }
  return config;
}

function isLegacyInternationalEnv(envConfig) {
  return !!(
    envConfig &&
    normalizeBaseUrl(envConfig.baseUrl, null) === DEFAULT_BASE_URL &&
    (!envConfig.loginUrl || envConfig.loginUrl === LEGACY_INTERNATIONAL_LOGIN_URL) &&
    (!envConfig.cookieFile || envConfig.cookieFile === 'cookies-intl.json')
  );
}

function normalizeBaseUrl(value, fallback = null) {
  if (!value) { return fallback; }
  const trimmed = String(value).trim();
  if (!trimmed) { return fallback; }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withProtocol).origin.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function normalizeHostname(value) {
  if (!value) { return ''; }
  const trimmed = String(value).trim().replace(/^\./, '').toLowerCase();
  if (!trimmed) { return ''; }
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      return new URL(trimmed).hostname.toLowerCase();
    }
    if (trimmed.includes('/')) {
      return new URL(`https://${trimmed}`).hostname.toLowerCase();
    }
  } catch {
    return '';
  }
  return trimmed;
}

function isSharedCookieDomain(hostname) {
  return SHARED_COOKIE_DOMAINS.has(normalizeHostname(hostname));
}

function isYidaServiceHost(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) { return false; }
  if (KNOWN_YIDA_HOSTS.has(host)) { return true; }
  if (host.endsWith('.aliwork.com') && host !== 'aliwork.com') { return true; }
  if (host.endsWith('.yidaapps.com') && host !== 'yidaapps.com') { return true; }
  if (host.endsWith('.alibaba-inc.com') && host !== 'alibaba-inc.com') {
    return host.startsWith('yida-') || host.includes('.yida-') || host.includes('.yida.');
  }
  return false;
}

function isYidaAppsHost(hostname) {
  const host = normalizeHostname(hostname);
  return host === 'yidaapps.com' || host.endsWith('.yidaapps.com');
}

function inferEnvironmentNameFromUrl(value) {
  const redirectBaseUrl = deriveBaseUrlFromDingtalkOAuthUrl(value, null);
  if (redirectBaseUrl) {
    return inferEnvironmentNameFromUrl(redirectBaseUrl);
  }

  const host = normalizeHostname(value);
  if (!host) { return null; }

  if (host === 'login.dingtalk.io' || host.endsWith('.dingtalk.io')) {
    return 'intl';
  }
  if (host === 'yidaapps.com' || host.endsWith('.yidaapps.com')) {
    return 'intl';
  }
  if (host === 'aliwork.com' || host.endsWith('.aliwork.com')) {
    return 'public';
  }
  if (host === 'yida-group.alibaba-inc.com') {
    return 'alibaba';
  }
  if (host.endsWith('.alibaba-inc.com') && isYidaServiceHost(host)) {
    return 'alibaba';
  }

  return null;
}

function isDefaultWorkPlatformLoginUrl(loginUrl, baseUrl) {
  const loginOrigin = normalizeBaseUrl(loginUrl, null);
  const baseOrigin = normalizeBaseUrl(baseUrl, null);
  if (!loginOrigin || !baseOrigin || loginOrigin !== baseOrigin) {
    return false;
  }

  try {
    const parsedUrl = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(loginUrl) ? loginUrl : `https://${loginUrl}`);
    return parsedUrl.pathname.replace(/\/+$/, '') === '/workPlatform' &&
      !parsedUrl.search &&
      !parsedUrl.hash;
  } catch {
    return false;
  }
}

function inferLoginUrlForBaseUrl(baseUrl, fallbackLoginUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, DEFAULT_BASE_URL);
  if (isYidaAppsHost(normalizedBaseUrl)) {
    return buildDingtalkOAuthLoginUrl({
      loginOrigin: DINGTALK_INTL_LOGIN_ORIGIN,
      baseUrl: normalizedBaseUrl,
      lang: 'en_US',
      forceLogin: true,
    });
  }
  return fallbackLoginUrl || `${normalizedBaseUrl}/workPlatform`;
}

function cookieDomainToBaseUrl(domain, fallbackUrl) {
  const host = normalizeHostname(domain);
  if (!host || isSharedCookieDomain(host)) {
    return null;
  }

  const fallbackOrigin = normalizeBaseUrl(fallbackUrl, null);
  if (fallbackOrigin) {
    const fallbackHost = normalizeHostname(fallbackOrigin);
    if (host === fallbackHost) {
      return fallbackOrigin;
    }
  }

  if (isYidaServiceHost(host)) {
    return `https://${host}`;
  }

  return null;
}

function deriveBaseUrlFromCookies(cookies = [], fallbackUrl = DEFAULT_BASE_URL) {
  const fallbackOrigin = normalizeBaseUrl(fallbackUrl, DEFAULT_BASE_URL);
  const cookieList = Array.isArray(cookies) ? cookies : [];
  const preferredCookieNames = ['yida_user_cookie', 'tianshu_csrf_token'];

  for (const cookieName of preferredCookieNames) {
    const cookie = cookieList.find((item) => item && item.name === cookieName && item.domain);
    const baseUrl = cookie ? cookieDomainToBaseUrl(cookie.domain, fallbackOrigin) : null;
    if (baseUrl) { return baseUrl; }
  }

  return fallbackOrigin;
}

function deriveBaseUrlFromLoginState(cookies = [], loginUrl = DEFAULT_LOGIN_URL, currentUrl = null) {
  const fallbackBaseUrl = deriveBaseUrlFromUrl(loginUrl, currentUrl);
  const cookieBaseUrl = deriveBaseUrlFromCookies(cookies, fallbackBaseUrl);
  const currentOrigin = normalizeBaseUrl(currentUrl, null);
  const currentHost = normalizeHostname(currentOrigin);
  const loginHost = normalizeHostname(normalizeBaseUrl(loginUrl, null));

  if (currentOrigin && isYidaServiceHost(currentHost) && currentHost !== loginHost) {
    return currentOrigin;
  }

  return cookieBaseUrl;
}

function deriveBaseUrlFromUrl(fallbackBaseUrl, candidateUrl) {
  let fallbackOrigin = normalizeBaseUrl(fallbackBaseUrl, DEFAULT_BASE_URL);
  const fallbackHost = normalizeHostname(fallbackOrigin);
  if (!isYidaServiceHost(fallbackHost)) {
    const callbackOrigin = deriveBaseUrlFromDingtalkOAuthUrl(fallbackBaseUrl, null);
    if (callbackOrigin) {
      fallbackOrigin = callbackOrigin;
    }
  }

  const candidateOrigin = normalizeBaseUrl(candidateUrl, null);
  if (!candidateOrigin) { return fallbackOrigin; }

  const candidateHost = normalizeHostname(candidateOrigin);
  return isYidaServiceHost(candidateHost) ? candidateOrigin : fallbackOrigin;
}

function deriveBaseUrlFromDingtalkOAuthUrl(oauthUrl, fallbackUrl) {
  if (!oauthUrl) { return fallbackUrl || null; }

  try {
    const parsedUrl = new URL(oauthUrl);
    const host = normalizeHostname(parsedUrl.hostname);
    const isDingtalkLoginHost = host.endsWith('dingtalk.com') || host.endsWith('dingtalk.io');
    if (!isDingtalkLoginHost || !parsedUrl.pathname.startsWith('/oauth2/')) {
      return fallbackUrl || null;
    }

    const redirectUri = parsedUrl.searchParams.get('redirect_uri');
    const redirectOrigin = normalizeBaseUrl(redirectUri, null);
    if (redirectOrigin && isYidaServiceHost(normalizeHostname(redirectOrigin))) {
      return redirectOrigin;
    }
  } catch {
    // ignore malformed URLs
  }

  return fallbackUrl || null;
}

// ── 配置文件读写 ──────────────────────────────────────

/**
 * 读取环境配置文件。
 * 若文件不存在，返回含默认公有云环境的配置（不写入磁盘）。
 * @param {string} [projectRoot]
 * @returns {{ current: string, environments: object }}
 */
function loadEnvsConfig(projectRoot) {
  const root = projectRoot || findProjectRoot();
  const configPath = path.join(root, '.cache', ENVS_CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    return buildDefaultEnvsConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8').trim();
    const parsed = JSON.parse(raw);
    // 确保内置环境始终存在，已有同名环境不覆盖，保证用户配置优先
    return ensureBuiltinEnvironments(parsed);
  } catch {
    return buildDefaultEnvsConfig();
  }
}

/**
 * 写入环境配置文件。
 * @param {object} config
 * @param {string} [projectRoot]
 */
function saveEnvsConfig(config, projectRoot) {
  const root = projectRoot || findProjectRoot();
  const cacheDir = path.join(root, '.cache');
  const configPath = path.join(cacheDir, ENVS_CONFIG_FILE);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ── 当前环境解析 ──────────────────────────────────────

/**
 * 获取当前激活的环境配置对象。
 * 优先级：OPENYIDA_ENV 环境变量 > config.current > 'public'
 * @param {string} [projectRoot]
 * @returns {{ name: string, config: object }}
 */
function getCurrentEnvConfig(projectRoot) {
  const envsConfig = loadEnvsConfig(projectRoot);
  const envName = resolveEnvNameAlias(process.env.OPENYIDA_ENV || envsConfig.current || 'public');
  const envConfig = envsConfig.environments[envName] || envsConfig.environments.public || DEFAULT_PUBLIC_ENV;

  return { name: envName, config: envConfig };
}

// ── Cookie 文件路径 ───────────────────────────────────

/**
 * 获取当前环境的 Cookie 文件绝对路径。
 * 若环境配置不存在，兜底使用 cookies-public.json。
 * @param {string} [projectRoot]
 * @returns {string}
 */
function getCookieFilePath(projectRoot) {
  const root = projectRoot || findProjectRoot();
  const { config: envConfig } = getCurrentEnvConfig(root);
  const cookieFileName = envConfig.cookieFile || 'cookies-public.json';
  return path.join(root, '.cache', cookieFileName);
}

// ── 旧版 Cookie 迁移 ──────────────────────────────────

/**
 * 将旧版 cookies.json 迁移为 cookies-public.json。
 * 仅在旧文件存在且新文件不存在时执行，保证向后兼容。
 * @param {string} [projectRoot]
 * @returns {boolean} 是否执行了迁移
 */
function migrateOldCookieFile(projectRoot) {
  const root = projectRoot || findProjectRoot();
  const oldFile = path.join(root, '.cache', 'cookies.json');
  const newFile = path.join(root, '.cache', 'cookies-public.json');

  if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
    try {
      fs.copyFileSync(oldFile, newFile);
      // 保留旧文件作为备份，不删除，避免其他工具依赖
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ── 端点解析 ──────────────────────────────────────────

/**
 * 解析最终的 baseUrl，按优先级：
 *   1. OPENYIDA_ENDPOINT 环境变量
 *   2. cookieData.base_url（登录后实际跳转域名）
 *   3. 当前激活环境配置的 baseUrl
 *   4. 默认公有云
 * @param {object} [cookieData]
 * @param {string} [projectRoot]
 * @returns {string}
 */
function resolveEndpoint(cookieData, projectRoot) {
  // 优先级 1：环境变量强制指定
  if (process.env.OPENYIDA_ENDPOINT) {
    return normalizeBaseUrl(process.env.OPENYIDA_ENDPOINT, DEFAULT_BASE_URL);
  }

  // 优先级 2：登录缓存中记录的实际服务域名
  if (cookieData && cookieData.base_url) {
    return normalizeBaseUrl(cookieData.base_url, DEFAULT_BASE_URL);
  }

  // 优先级 3：当前激活环境配置
  const { config: envConfig } = getCurrentEnvConfig(projectRoot);
  if (envConfig.baseUrl) {
    return normalizeBaseUrl(envConfig.baseUrl, DEFAULT_BASE_URL);
  }

  return DEFAULT_BASE_URL;
}

/**
 * 解析最终的登录 URL，按优先级：
 *   1. OPENYIDA_LOGIN_URL 环境变量
 *   2. 当前激活环境配置的 loginUrl
 *   3. 默认公有云登录 URL
 * @param {string} [projectRoot]
 * @returns {string}
 */
function resolveLoginUrl(projectRoot) {
  if (process.env.OPENYIDA_LOGIN_URL) {
    return process.env.OPENYIDA_LOGIN_URL;
  }

  if (process.env.OPENYIDA_ENDPOINT) {
    return inferLoginUrlForBaseUrl(process.env.OPENYIDA_ENDPOINT);
  }

  const { config: envConfig } = getCurrentEnvConfig(projectRoot);
  const baseUrl = normalizeBaseUrl(envConfig.baseUrl, DEFAULT_BASE_URL);
  if (!envConfig.loginUrl || isDefaultWorkPlatformLoginUrl(envConfig.loginUrl, baseUrl)) {
    return inferLoginUrlForBaseUrl(baseUrl, envConfig.loginUrl || DEFAULT_LOGIN_URL);
  }

  return envConfig.loginUrl || DEFAULT_LOGIN_URL;
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_LOGIN_URL,
  INTERNATIONAL_BASE_URL,
  DINGTALK_OAUTH_CLIENT_ID,
  DINGTALK_LOGIN_ORIGIN,
  DINGTALK_INTL_LOGIN_ORIGIN,
  INTERNATIONAL_LOGIN_URL,
  ALIBABA_INTERNAL_BASE_URL,
  ALIBABA_INTERNAL_LOGIN_URL,
  DEFAULT_PUBLIC_ENV,
  DEFAULT_INTERNATIONAL_ENV,
  DEFAULT_ALIBABA_INTERNAL_ENV,
  buildDingtalkOAuthLoginUrl,
  resolveEnvNameAlias,
  loadEnvsConfig,
  saveEnvsConfig,
  getCurrentEnvConfig,
  getCookieFilePath,
  migrateOldCookieFile,
  resolveEndpoint,
  resolveLoginUrl,
  normalizeBaseUrl,
  normalizeHostname,
  isYidaServiceHost,
  isYidaAppsHost,
  inferEnvironmentNameFromUrl,
  inferLoginUrlForBaseUrl,
  deriveBaseUrlFromDingtalkOAuthUrl,
  deriveBaseUrlFromCookies,
  deriveBaseUrlFromLoginState,
  deriveBaseUrlFromUrl,
};
