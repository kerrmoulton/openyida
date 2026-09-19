/**
 * connector test - 测试连接器执行动作
 *
 * 用法：openyida connector test --connector-id <id> --action <actionId> [--params <json>] [--account-id <id>]
 */

'use strict';
const { fail } = require('../core/chalk');
const { redactString, safeJsonStringify } = require('../core/redact');

const {
  getAuthRef,
  findConnectorById,
  getConnectorDetail,
  listConnections,
  testConnector,
  invokeConnector,
} = require('./api');

function showUsage() {
  console.log(`
用法: openyida connector test [选项]

选项:
  --connector-id <id>    连接器 ID（必需）
  --action <actionId>    执行动作 ID（必需）
  --params <json>        请求参数（JSON 格式，可选）
                         推荐按位置传入：query、path、header、body
                         扁平对象仅用于兼容旧调用，会同时合并到 Query 和 Body
  --account-id <id>      认证账号 ID（可选，用于需要鉴权的连接器）

示例:
  openyida connector test --connector-id 910296 --action listUsers \\
    --params '{"query":{"keyword":"OpenYida","pageNo":1}}'

  openyida connector test --connector-id 910296 --action getUser \\
    --params '{"path":{"id":"123"},"header":{"X-Tenant-Id":"demo"}}'

  openyida connector test --connector-id 910296 --action createUser \\
    --params '{"body":{"name":"Ada","enabled":true}}'

  openyida connector test --connector-id 910296 --action updateUser \\
    --params '{"path":{"id":"123"},"query":{"notify":true},"body":{"name":"Ada"}}'

说明:
  - Path 参数会替换动作 URL 中同名的 {变量名}
  - 指定 --account-id 时使用页面运行时的连接器调用接口和已保存的认证账号
  - Body 必须是合法 JSON；文件上传/Multipart 暂不由 --params 支持
  - 输出中的 Cookie、Authorization 等敏感响应头会自动脱敏
`);
}

function parseArgs(args) {
  const options = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        showUsage();
        process.exit(0);
        break;
      case '--connector-id':
        options.connectorId = args[++i];
        break;
      case '--action':
        options.actionId = args[++i];
        break;
      case '--params':
        options.params = args[++i];
        break;
      case '--account-id':
        options.accountId = args[++i];
        break;
    }
  }

  return options;
}

function buildTestParams(operation, userParams) {
  const params = { header: {}, query: {}, path: {}, body: {} };

  if (operation.parameters) {
    if (operation.parameters.header) {
      operation.parameters.header.forEach(headerParam => {
        params.header[headerParam.name] = headerParam.value || '';
      });
    }
    if (operation.parameters.query) {
      operation.parameters.query.forEach(queryParam => {
        params.query[queryParam.name] = queryParam.value || '';
      });
    }
    if (operation.parameters.path) {
      operation.parameters.path.forEach(pathParam => {
        params.path[pathParam.name] = pathParam.value || '';
      });
    }
    if (operation.parameters.body && operation.parameters.body.default) {
      try {
        params.body = JSON.parse(operation.parameters.body.default);
      } catch {
        params.body = operation.parameters.body.default;
      }
    }
  }

  if (userParams) {
    try {
      const userParamsObj = JSON.parse(userParams);
      const usesLocations = ['header', 'query', 'path', 'body']
        .some(location => Object.prototype.hasOwnProperty.call(userParamsObj, location));
      if (usesLocations) {
        for (const location of ['header', 'query', 'path']) {
          if (userParamsObj[location] && typeof userParamsObj[location] === 'object') {
            Object.assign(params[location], userParamsObj[location]);
          }
        }
        if (Object.prototype.hasOwnProperty.call(userParamsObj, 'body')) {
          params.body = userParamsObj.body;
        }
      } else {
        // 兼容旧用法：扁平参数同时可供 Query 与 Body 动作使用。
        Object.assign(params.query, userParamsObj);
        Object.assign(params.body, userParamsObj);
      }
    } catch (e) {
      console.warn('⚠️  参数解析失败，使用默认值:', e.message);
    }
  }

  return params;
}

function buildOperationUrl(connector, operation, pathParams = {}) {
  const scheme = connector.scheme || 'https';
  const host = String(connector.host || '').replace(/^\/+|\/+$/g, '');
  const baseUrl = String(connector.baseUrl || '').replace(/^\/+|\/+$/g, '');
  const operationUrl = String(operation.url || '')
    .replace(/\{([^}]+)\}/g, (_match, name) => encodeURIComponent(pathParams[name] ?? `{${name}}`))
    .replace(/^\/+/, '');
  const path = [baseUrl, operationUrl].filter(Boolean).join('/');
  return `${scheme}://${host}/${path}`;
}

function normalizeTestResponse(result) {
  if (!result || result.success === false || result.hasError || result.errorCode) {
    return {
      ok: false,
      error: (result && (result.errorMsg || result.message)) || '未知错误',
      details: result && result.content,
    };
  }

  const response = result.content && result.content.content !== undefined &&
    Object.keys(result.content).length === 1
    ? result.content.content
    : (result.content || result);

  const statusCode = Number(response && response.statusCode) ||
    Number(String(response && response.statusLine || '').match(/\b(\d{3})\b/)?.[1]);
  if (statusCode >= 400) {
    return {
      ok: false,
      error: `HTTP ${statusCode}`,
      details: {
        statusLine: response.statusLine,
        statusCode,
        body: response.content !== undefined ? response.content : response.body,
      },
    };
  }

  if (typeof response === 'string') {
    return response === 'no such method'
      ? { ok: false, error: response }
      : { ok: true, body: response };
  }

  return {
    ok: true,
    statusLine: response.statusLine,
    statusCode: response.statusCode,
    headers: response.responseHeaders || response.headers,
    body: response.content !== undefined ? response.content : response.body,
    executeTime: response.executeTime,
  };
}

function normalizeInvokeResponse(result) {
  if (!result || result.success === false || result.hasError || result.errorCode) {
    return {
      ok: false,
      error: (result && (result.errorMsg || result.message)) || '连接器调用失败',
      details: result && result.content,
    };
  }
  const body = result.content && result.content.serviceReturnValue;
  if (body && typeof body.code === 'string' && /^error\.httpStatus\.\d{3}$/.test(body.code)) {
    return { ok: false, error: body.code, details: body };
  }
  return { ok: true, body: body === undefined ? result.content : body };
}

function redactResponseHeaders(headers) {
  if (!Array.isArray(headers)) {
    return headers;
  }
  return headers.map(header => {
    if (!header || typeof header !== 'object') {
      return header;
    }
    const name = String(header._1 || header.name || header.key || '');
    if (!/^(?:set-cookie|cookie|authorization|proxy-authorization|x-api-key)$/i.test(name)) {
      return header;
    }
    const valueKey = Object.prototype.hasOwnProperty.call(header, '_2') ? '_2' :
      (Object.prototype.hasOwnProperty.call(header, 'value') ? 'value' : 'value');
    return { ...header, [valueKey]: '***' };
  });
}

async function run(args) {
  if (!args || args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
    process.exit(0);
  }

  const options = parseArgs(args);

  if (!options.connectorId || !options.actionId) {
    fail('请提供 --connector-id 和 --action 参数');
    showUsage();
    process.exit(1);
  }

  const authRef = getAuthRef();

  // 获取连接器详情
  const connector = await findConnectorById(options.connectorId, authRef);
  if (!connector) {
    fail(`未找到连接器 ID: ${options.connectorId}`);
    process.exit(1);
  }

  const detail = await getConnectorDetail(connector.connectorName, authRef);

  // 找到对应的执行动作
  let operations = detail.operations || [];
  if (typeof operations === 'string') {
    try {
      operations = JSON.parse(operations);
    } catch (e) {
      operations = [];
    }
  }

  const operation = operations.find(op => op.operationId === options.actionId);
  if (!operation) {
    fail(`未找到执行动作: ${options.actionId}`);
    console.log('\n可用的执行动作:');
    operations.forEach((op, index) => {
      console.log(`  ${index + 1}. ${op.operationId}: ${op.summary}`);
    });
    process.exit(1);
  }

  console.log('\n📋 执行动作信息');
  console.log('──────────────────────────────────────────────────');
  console.log(`动作ID: ${operation.operationId}`);
  console.log(`动作名称: ${operation.summary}`);
  console.log(`请求方法: ${operation.method.toUpperCase()}`);
  console.log(`请求路径: ${operation.url}`);
  console.log('──────────────────────────────────────────────────\n');

  // 检查是否需要认证账号
  const authAccounts = await listConnections(connector.connectorName, authRef);
  if (authAccounts.length > 0 && !options.accountId) {
    console.log('💡 该连接器需要认证账号，可用的账号:');
    authAccounts.forEach((account, index) => {
      console.log(`  ${index + 1}. ${account.id}: ${account.displayName || account.authName || '未命名'}`);
    });
    console.log('\n请使用 --account-id 参数指定账号');
    return;
  }
  if (options.accountId && !authAccounts.some(account => String(account.id) === String(options.accountId))) {
    fail(`未找到认证账号 ID: ${options.accountId}`);
    return;
  }

  // 构建测试参数
  const testParams = buildTestParams(operation, options.params);

  console.log('📤 请求参数');
  console.log('──────────────────────────────────────────────────');
  console.log('Headers:', safeJsonStringify(testParams.header));
  console.log('Query:', safeJsonStringify(testParams.query));
  console.log('Path:', safeJsonStringify(testParams.path));
  console.log('Body:', safeJsonStringify(testParams.body));
  console.log('──────────────────────────────────────────────────\n');

  console.log('🚀 正在发送测试请求...\n');

  const result = options.accountId
    ? await invokeConnector({
      connectorName: connector.connectorName,
      actionId: operation.operationId,
      accountId: options.accountId,
      ...testParams,
    }, authRef)
    : await testConnector({
      method: operation.method,
      url: buildOperationUrl(detail, operation, testParams.path),
      header: testParams.header,
      query: testParams.query,
      body: testParams.body,
      authId: '',
    }, authRef);

  console.log('📥 响应结果');
  console.log('═══════════════════════════════════════════════════\n');

  const response = options.accountId
    ? normalizeInvokeResponse(result)
    : normalizeTestResponse(result);

  if (!response.ok) {
    fail('测试失败:', response.error);
    if (response.details) {
      console.log('\n错误详情:', safeJsonStringify(response.details));
    }
  } else {
    console.log('✅ 测试成功!\n');

    if (response.statusLine) {
      console.log(`✅ HTTP 状态: ${response.statusLine}`);
    } else if (response.statusCode) {
      const statusEmoji = response.statusCode >= 200 && response.statusCode < 300 ? '✅' : '⚠️';
      console.log(`${statusEmoji} HTTP 状态: ${response.statusCode}`);
    }

    if (response.headers) {
      console.log('\n📋 响应头:');
      console.log(safeJsonStringify(redactResponseHeaders(response.headers)));
    }

    if (response.body !== undefined && response.body !== '') {
      console.log('\n📄 响应体:');
      try {
        const bodyObj = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
        console.log(safeJsonStringify(bodyObj));
      } catch {
        console.log(redactString(String(response.body)));
      }
    }

    if (response.executeTime) {
      console.log(`\n⏱️  执行时间: ${response.executeTime}ms`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
}

module.exports = {
  buildOperationUrl,
  buildTestParams,
  normalizeTestResponse,
  normalizeInvokeResponse,
  redactResponseHeaders,
  run,
};
