/**
 * integration export - 导出集成自动化设计器原始配置
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createAuthRef } = require('../core/yida-client');
const { getLogicflowProcess } = require('./integration-api');

function parseArgs(args) {
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
  if (positional.length > 4) {
    throw new Error(`多余参数: ${positional.slice(4).join(' ')}`);
  }
  return {
    appType: positional[0] || '',
    formUuid: positional[1] || '',
    processCode: positional[2] || '',
    outputPath: positional[3] || '',
    help,
  };
}

function sanitizeFilenamePart(value) {
  return Array.from(String(value || ''))
    .map(character => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_');
}

function resolveOutputPath(options) {
  return options.outputPath || path.join(
    process.cwd(),
    `integration-${sanitizeFilenamePart(options.processCode)}.json`
  );
}

function writeJsonFile(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function showUsage() {
  console.log(`
用法: openyida integration export <appType> <formUuid> <processCode> [output]

示例:
  openyida integration export APP_XXX FORM_XXX LPROC_XXX
  openyida integration export APP_XXX FORM_XXX LPROC_XXX ./integration-backup.json
`);
}

async function run(args) {
  const options = parseArgs(args);
  if (options.help || !options.appType || !options.formUuid || !options.processCode) {
    showUsage();
    return;
  }

  const response = await getLogicflowProcess(createAuthRef(), options);
  const outputPath = resolveOutputPath(options);
  writeJsonFile(outputPath, response);
  console.log(`集成自动化配置已导出到 ${outputPath}`);
}

module.exports = {
  parseArgs,
  resolveOutputPath,
  run,
  writeJsonFile,
};
