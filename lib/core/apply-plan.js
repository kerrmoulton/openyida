'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { detectActiveTool } = require('./utils');
const { validatePlanForCommand } = require('./safety-mode');

const YIDA_BIN = path.resolve(__dirname, '../../bin/yida.js');

function hasJsonFlag(args) {
  return (args || []).includes('--json');
}

function usage() {
  console.log('Usage: openyida apply-plan <plan-file> [--json]');
}

function loadPlan(planFile) {
  const planPath = path.resolve(planFile);
  const raw = fs.readFileSync(planPath, 'utf8');
  return JSON.parse(raw);
}

async function run(args = []) {
  const json = hasJsonFlag(args);
  const filteredArgs = args.filter(arg => arg !== '--json');
  const planFile = filteredArgs[0];
  if (!planFile) {
    usage();
    process.exitCode = 1;
    return;
  }

  const activeTool = detectActiveTool();
  if (activeTool && process.env.OPENYIDA_ALLOW_AGENT_APPLY !== '1') {
    const output = {
      success: false,
      blocked: true,
      code: 'OPENYIDA_APPLY_PLAN_AGENT_DENIED',
      error: `Refusing to apply an OpenYida plan inside ${activeTool.displayName}. Run this from a normal terminal.`,
    };
    if (json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.error(output.error);
    }
    process.exitCode = 2;
    return;
  }

  let plan;
  try {
    plan = loadPlan(planFile);
    const command = plan.command && plan.command[0];
    const commandArgs = plan.command ? plan.command.slice(1) : [];
    validatePlanForCommand(planFile, command, commandArgs, process.cwd());

    const stdout = execFileSync(process.execPath, [YIDA_BIN, ...plan.command], {
      cwd: plan.cwd || process.cwd(),
      env: {
        ...process.env,
        OPENYIDA_APPLY_PLAN_FILE: path.resolve(planFile),
      },
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
      timeout: 120000,
    });

    const output = {
      success: true,
      applied: true,
      planFile: path.resolve(planFile),
      command: plan.command.join(' '),
      output: stdout.trim(),
    };
    if (json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      if (stdout) {
        process.stdout.write(stdout);
      }
    }
  } catch (err) {
    const output = {
      success: false,
      applied: false,
      planFile: path.resolve(planFile),
      command: plan && plan.command ? plan.command.join(' ') : null,
      error: err.message,
    };
    if (json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.error(err.message);
    }
    process.exitCode = 1;
  }
}

module.exports = { run };
