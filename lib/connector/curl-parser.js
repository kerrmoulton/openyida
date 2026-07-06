/**
 * Curl 命令解析模块
 */

/**
 * 从 curl 命令中提取 URL。
 * 早期实现只匹配 `curl "<url>"`（必须带引号且紧跟 curl），导致裸 URL、
 * 单引号、`--url` 参数、`-X POST` 在 URL 之前等常见写法全部解析失败。
 * 这里按优先级多策略提取：
 *   1. 显式 `--url <url>` 参数
 *   2. 命令中任意带引号的 http(s) URL
 *   3. 命令中任意裸 http(s) URL（截断到空白处）
 * @param {string} curlCommand - curl 命令字符串
 * @returns {string} 提取到的 URL，未找到返回空字符串
 */
function extractCurlUrl(curlCommand) {
  const explicitUrl = curlCommand.match(/--url\s+['"]?([^'"\s]+)['"]?/);
  if (explicitUrl) {
    return explicitUrl[1];
  }

  const quotedUrl = curlCommand.match(/['"](https?:\/\/[^'"]+)['"]/);
  if (quotedUrl) {
    return quotedUrl[1];
  }

  const bareUrl = curlCommand.match(/(https?:\/\/[^\s'"]+)/);
  if (bareUrl) {
    return bareUrl[1];
  }

  return '';
}

/**
 * 解析 curl 命令
 * @param {string} curlCommand - curl 命令字符串
 * @returns {Object} 解析结果
 */
function parseCurl(curlCommand) {
  const result = {
    url: '',
    method: 'GET',
    headers: {},
    body: null,
    protocol: 'https',
    host: '',
    path: ''
  };

  try {
    // 提取 URL：兼容带引号 URL、裸 URL、--url 参数、-X POST 在前等多种写法
    result.url = extractCurlUrl(curlCommand);
    if (result.url) {
      const url = new URL(result.url);
      result.protocol = url.protocol.replace(':', '');
      result.host = url.hostname;
      result.path = url.pathname + url.search;
    }

    // 提取方法
    const methodMatch = curlCommand.match(/(?:-X|--request)\s+['"]?(\w+)['"]?/);
    if (methodMatch) {
      result.method = methodMatch[1].toUpperCase();
    } else if (curlCommand.includes('--data') || /\s-d\b/.test(curlCommand)) {
      result.method = 'POST';
    }

    // 提取 headers
    const headerMatches = curlCommand.matchAll(/-H\s+['"]([^:]+):\s*([^'"]+)['"]/g);
    for (const match of headerMatches) {
      result.headers[match[1]] = match[2].trim();
    }

    // 提取 body
    const bodyMatch = curlCommand.match(/--data(?:-raw)?\s+['"]([\s\S]*?)['"](?:\s+-H|\s+--|\s*$)/);
    if (bodyMatch) {
      result.body = bodyMatch[1];
    }

    return result;
  } catch (error) {
    throw new Error(`解析 curl 命令失败: ${error.message}`);
  }
}

/**
 * 从 headers 中检测鉴权方式
 * @param {Object} headers - 请求头对象
 * @returns {Object} 鉴权类型信息
 */
function detectAuthType(headers) {
  const authHeader = headers['Authorization'] || headers['authorization'];

  if (authHeader) {
    const scheme = authHeader.trim().toLowerCase();
    if (scheme.startsWith('bearer')) {
      return { type: 'API密钥', code: 'ApiKeyAuth', headerName: 'Authorization' };
    }
    if (scheme.startsWith('basic')) {
      return { type: '基本身份验证', code: 'BasicAuth', headerName: 'Authorization' };
    }
  }

  if (headers['x-acs-dingtalk-access-token']) {
    return { type: '钉钉开放平台验证', code: 'DingAuth', headerName: 'x-acs-dingtalk-access-token' };
  }

  const apiKeyHeaders = Object.keys(headers).filter(h =>
    h.toLowerCase().includes('api-key') ||
    h.toLowerCase().includes('apikey') ||
    h.toLowerCase().includes('x-api')
  );

  if (apiKeyHeaders.length > 0) {
    return { type: 'API密钥', code: 'ApiKeyAuth', headerName: apiKeyHeaders[0] };
  }

  return { type: '无身份验证', code: 'NONE', headerName: '' };
}

/**
 * 定义需要过滤掉的浏览器自动添加的 headers
 */
const BROWSER_HEADERS = [
  'accept', 'accept-language', 'accept-encoding', 'connection',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
  'user-agent', 'priority', 'referer', 'origin',
  'cache-control', 'pragma', 'dnt', 'upgrade-insecure-requests'
];

/**
 * 过滤浏览器自动添加的 headers
 * @param {Object} headers - 原始 headers
 * @returns {Array} 过滤后的 headers 数组 [{name, value}]
 */
function filterBrowserHeaders(headers) {
  return Object.entries(headers).filter(([key]) => {
    const lowerKey = key.toLowerCase();
    return !BROWSER_HEADERS.includes(lowerKey) &&
           lowerKey !== 'content-type' &&
           !lowerKey.startsWith('sec-');
  });
}

module.exports = {
  parseCurl,
  extractCurlUrl,
  detectAuthType,
  filterBrowserHeaders,
  BROWSER_HEADERS
};
