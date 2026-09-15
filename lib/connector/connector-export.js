/**
 * connector export - 导出连接器服务端配置
 */

'use strict';

const { getAuthRef, findConnectorById, getConnectorDetail } = require('./api');
const { parseExportOptions, resolveExportPath, writeJsonFile } = require('./connector-export-utils');

function showUsage() {
  console.log(`
用法: openyida connector export <connector-id> [output]

示例:
  openyida connector export 910244
  openyida connector export 910244 ./connector-backup.json
`);
}

async function run(args) {
  const options = parseExportOptions(args);
  if (options.help || !options.connectorId) {
    showUsage();
    return;
  }

  const authRef = getAuthRef();
  const connector = await findConnectorById(options.connectorId, authRef);
  if (!connector) {
    throw new Error(`未找到连接器: ${options.connectorId}`);
  }

  const detail = await getConnectorDetail(connector.connectorName, authRef);
  const outputPath = resolveExportPath(options);
  writeJsonFile(outputPath, detail);
  console.log(`连接器配置已导出到 ${outputPath}`);
}

module.exports = { run };
