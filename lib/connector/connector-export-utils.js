'use strict';

const fs = require('fs');
const path = require('path');

function parseExportOptions(args, options = {}) {
  const positional = [];
  let help = false;

  for (const arg of args || []) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (String(arg).startsWith('-')) {
      throw new Error(`未知参数: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const result = {
    connectorId: positional[0] || '',
    help,
  };
  if (options.requireOperationId) {
    result.operationId = positional[1] || '';
  }
  const outputIndex = options.requireOperationId ? 2 : 1;
  result.outputPath = positional[outputIndex] || '';
  const expectedCount = outputIndex + 1;
  if (positional.length > expectedCount) {
    throw new Error(`多余参数: ${positional.slice(expectedCount).join(' ')}`);
  }
  return result;
}

function sanitizeFilenamePart(value) {
  return Array.from(String(value || ''))
    .map(character => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_');
}

function resolveExportPath(options) {
  if (options.outputPath) {
    return options.outputPath;
  }
  const parts = ['connector', sanitizeFilenamePart(options.connectorId)];
  if (options.operationId) {
    parts.push(sanitizeFilenamePart(options.operationId));
  }
  return path.join(process.cwd(), `${parts.join('-')}.json`);
}

function writeJsonFile(outputPath, value) {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function parseRawOperations(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return [];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error('连接器 operations 不是数组');
  }
  return parsed;
}

function findRawOperation(operations, operationId) {
  return operations.find(operation => operation && operation.operationId === operationId) || null;
}

module.exports = {
  findRawOperation,
  parseExportOptions,
  parseRawOperations,
  resolveExportPath,
  writeJsonFile,
};
