'use strict';

const fs = require('fs');
const { diagnoseText, listPitfallRules, formatFindings } = require('./integration-diagnostics');
const { usage } = require('../core/chalk');

function parseFlag(args, flagName) {
  const index = args.indexOf(flagName);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('-')) {
    return args[index + 1];
  }
  return null;
}

function hasFlag(args, flagName) {
  return args.includes(flagName);
}

function readInput(args) {
  const text = parseFlag(args, '--text');
  if (text) {
    return text;
  }

  const file = parseFlag(args, '--file') || parseFlag(args, '-f');
  if (file) {
    return fs.readFileSync(file, 'utf8');
  }

  const positional = args.filter((arg, index) => {
    if (arg.startsWith('-')) {
      return false;
    }
    return !['--text', '--file', '-f'].includes(args[index - 1]);
  });
  return positional.join(' ');
}

async function run(args) {
  const outputJson = hasFlag(args, '--json');

  if (!args.length || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    usage(
      'openyida integration diagnose (--text <text>|--file <path>|--rules) [--json]',
      'openyida integration diagnose --text "连接器异常：接口参数异常"'
    );
    process.exit(0);
  }

  if (hasFlag(args, '--rules')) {
    const rules = listPitfallRules();
    if (outputJson) {
      console.log(JSON.stringify({ rules }, null, 2));
    } else {
      console.log(rules.map((rule) => `[${rule.severity}] ${rule.id}: ${rule.title}\n  ${rule.recommendation}`).join('\n'));
    }
    return;
  }

  const input = readInput(args);
  if (!input.trim()) {
    throw new Error('Missing diagnostic text. Use --text, --file, or pass text as positional arguments.');
  }

  const findings = diagnoseText(input);
  if (outputJson) {
    console.log(JSON.stringify({ findings }, null, 2));
  } else {
    console.log(formatFindings(findings));
  }
}

module.exports = {
  parseFlag,
  readInput,
  run,
};
