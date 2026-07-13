'use strict';

const { detectActiveTool } = require('./utils');
const {
  normalizeSafetyMode,
  resolveSafetyMode,
  setSafetyMode,
} = require('./safety-mode');

function hasJsonFlag(args) {
  return (args || []).includes('--json');
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printStatus(status) {
  console.log('');
  console.log('OpenYida safety');
  console.log('----------------');
  console.log(`  effective: ${status.effective}`);
  console.log(`  global:    ${status.global || '(unset)'}`);
  console.log(`  project:   ${status.project || '(unset)'}`);
  console.log(`  env:       ${status.env || '(unset)'}`);
  console.log(`  rule:      ${status.rule}`);
  console.log('');
  console.log(`  global config:  ${status.globalConfigFile}`);
  console.log(`  project config: ${status.projectConfigFile}`);
  console.log('');
}

function usage() {
  console.log(`
Usage:
  openyida safety status [--json]
  openyida safety global mode <readonly|plan|full> [--json]
  openyida safety project mode <readonly|plan|full> [--json]

Effective mode is the strictest configured mode: readonly > plan > full.
Agent environments may tighten safety mode, but may not loosen it.
`);
}

async function run(args = []) {
  const json = hasJsonFlag(args);
  const filteredArgs = args.filter(arg => arg !== '--json');
  const subCommand = filteredArgs[0] || 'status';

  if (subCommand === '--help' || subCommand === '-h' || subCommand === 'help') {
    usage();
    return;
  }

  if (subCommand === 'status') {
    const status = resolveSafetyMode();
    if (json) {
      printJson(status);
    } else {
      printStatus(status);
    }
    return;
  }

  const scope = subCommand;
  const action = filteredArgs[1];
  const mode = filteredArgs[2];
  if (!['global', 'project'].includes(scope) || action !== 'mode' || !normalizeSafetyMode(mode)) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const result = setSafetyMode(scope, mode);
    const activeTool = detectActiveTool();
    const output = {
      success: true,
      ...result,
      activeTool: activeTool ? activeTool.tool : null,
      message: `OpenYida ${scope} safety mode set to ${result.mode}`,
    };
    if (json) {
      printJson(output);
    } else {
      console.log(`OpenYida ${scope} safety mode: ${result.previousMode} -> ${result.mode}`);
      console.log(`Effective safety mode: ${result.effective}`);
      console.log(`Config: ${result.configFile}`);
    }
  } catch (err) {
    const output = {
      success: false,
      error: err.message,
      code: err.code || 'SAFETY_MODE_FAILED',
    };
    if (json) {
      printJson(output);
    } else {
      console.error(err.message);
    }
    process.exitCode = 1;
  }
}

module.exports = { run };
