/**
 * connector export-action - 按 operationId 导出连接器动作配置
 */

'use strict';

const { getAuthRef, findConnectorById, getConnectorDetail } = require('./api');
const {
  findRawOperation,
  parseExportOptions,
  parseRawOperations,
  resolveExportPath,
  writeJsonFile,
} = require('./connector-export-utils');

function showUsage() {
  console.log(`
用法: openyida connector export-action <connector-id> <operation-id> [output]

示例:
  openyida connector export-action 910244 process_reconcileAttempt
  openyida connector export-action 910244 process_reconcileAttempt ./reconcile-action.json
`);
}

async function run(args) {
  const options = parseExportOptions(args, { requireOperationId: true });
  if (options.help || !options.connectorId || !options.operationId) {
    showUsage();
    return;
  }

  const authRef = getAuthRef();
  const connector = await findConnectorById(options.connectorId, authRef);
  if (!connector) {
    throw new Error(`未找到连接器: ${options.connectorId}`);
  }

  const detail = await getConnectorDetail(connector.connectorName, authRef);
  const operations = parseRawOperations(detail.operations);
  const operation = findRawOperation(operations, options.operationId);
  if (!operation) {
    const available = operations.map(item => item.operationId).filter(Boolean);
    const suffix = available.length > 0 ? `；可用动作: ${available.join(', ')}` : '';
    throw new Error(`未找到动作: ${options.operationId}${suffix}`);
  }

  const outputPath = resolveExportPath(options);
  writeJsonFile(outputPath, operation);
  console.log(`连接器动作已导出到 ${outputPath}`);
}

module.exports = { run };
