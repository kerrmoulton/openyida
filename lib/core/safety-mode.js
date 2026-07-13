'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { flattenCommandManifest } = require('./command-manifest');
const { detectActiveTool, findProjectRoot } = require('./utils');

const SAFETY_MODES = Object.freeze({
  full: 0,
  plan: 1,
  readonly: 2,
});

const DEFAULT_SAFETY_MODE = 'full';
const GLOBAL_CONFIG_FILE = path.join(os.homedir(), '.openyida', 'config.json');
const PROJECT_CONFIG_FILE = path.join('.cache', 'openyida-safety.json');
const PLAN_DIR = path.join('.cache', 'openyida', 'plans');

function isValidSafetyMode(mode) {
  return Object.prototype.hasOwnProperty.call(SAFETY_MODES, mode);
}

function normalizeSafetyMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return isValidSafetyMode(mode) ? mode : null;
}

function strictestMode(modes) {
  return (modes || [])
    .filter(Boolean)
    .reduce((current, next) => {
      if (!current) { return next; }
      return SAFETY_MODES[next] > SAFETY_MODES[current] ? next : current;
    }, null) || DEFAULT_SAFETY_MODE;
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) { return null; }
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getProjectSafetyConfigPath(projectRoot = findProjectRoot()) {
  return path.join(projectRoot, PROJECT_CONFIG_FILE);
}

function loadGlobalSafetyConfig() {
  return readJsonFile(GLOBAL_CONFIG_FILE) || {};
}

function loadProjectSafetyConfig(projectRoot = findProjectRoot()) {
  return readJsonFile(getProjectSafetyConfigPath(projectRoot)) || {};
}

function readModeFromConfig(config) {
  return normalizeSafetyMode(config && (config.safetyMode || config.safety_mode));
}

function resolveSafetyMode(options = {}) {
  const projectRoot = options.projectRoot || findProjectRoot();
  const env = options.env || process.env;
  const globalConfig = options.globalConfig || loadGlobalSafetyConfig();
  const projectConfig = options.projectConfig || loadProjectSafetyConfig(projectRoot);
  const globalMode = readModeFromConfig(globalConfig);
  const projectMode = readModeFromConfig(projectConfig);
  const envMode = normalizeSafetyMode(env.OPENYIDA_SAFETY_MODE);
  const effective = strictestMode([DEFAULT_SAFETY_MODE, globalMode, projectMode, envMode]);

  return {
    default: DEFAULT_SAFETY_MODE,
    global: globalMode,
    project: projectMode,
    env: envMode,
    effective,
    projectRoot,
    globalConfigFile: GLOBAL_CONFIG_FILE,
    projectConfigFile: getProjectSafetyConfigPath(projectRoot),
    rule: 'strictest_mode_wins',
    mode_order: ['full', 'plan', 'readonly'],
  };
}

function commandIdForArgs(command, args = []) {
  if (!command) { return null; }

  if (command === 'group') {
    command = 'nav-group';
  }

  if (command === 'batch') {
    return 'batch';
  }

  if (command === 'env') {
    return 'env';
  }

  if (command === 'create-form') {
    const mode = args[0];
    const aliases = {
      create: 'create-form.create',
      update: 'create-form.update',
      patch: 'create-form.patch',
      rule: 'create-form.rule',
      rules: 'create-form.rule',
      validation: 'create-form.validation',
      validate: 'create-form.validation',
      validations: 'create-form.validation',
      'bind-datasource': 'create-form.bind-datasource',
      datasource: 'create-form.bind-datasource',
      'data-source': 'create-form.bind-datasource',
      'add-option': 'create-form.add-option',
    };
    return aliases[mode] || 'create-form.create';
  }

  if (command === 'process' && args[0] === 'preview') {
    return 'process.preview';
  }

  if (command === 'formula' && (args[0] === 'evaluate' || args[0] === 'check')) {
    return 'formula.evaluate';
  }

  const tokens = [command, ...args];
  const commands = flattenCommandManifest()
    .filter(entry => entry.path && entry.path.length > 0)
    .sort((a, b) => b.path.length - a.path.length);

  const matched = commands.find(entry => entry.path.every((part, index) => tokens[index] === part));
  return matched ? matched.id : command;
}

function getCommandEntry(command, args = []) {
  const id = commandIdForArgs(command, args);
  const entry = flattenCommandManifest().find(item => item.id === id);
  return entry || null;
}

function tokenMatchesAction(args, action) {
  const actionTokens = String(action || '').split(/\s+/).filter(Boolean);
  if (actionTokens.length === 0) { return false; }
  return actionTokens.every((token, index) => args[index] === token);
}

function classifyMixedAction(effect, args = []) {
  const readActions = effect.read_actions || [];
  const mutatingActions = effect.mutating_actions || [];

  if (args.length === 0 && readActions.includes('default')) {
    return { mutatesYida: false, reason: 'mixed_default_read' };
  }

  if (mutatingActions.some(action => tokenMatchesAction(args, action) || args.includes(action))) {
    return { mutatesYida: !!effect.mutates_yida, reason: 'mixed_mutating_action' };
  }

  if (readActions.some(action => tokenMatchesAction(args, action) || args.includes(action))) {
    return { mutatesYida: false, reason: 'mixed_read_action' };
  }

  return {
    mutatesYida: !!effect.mutates_yida,
    reason: effect.mutates_yida ? 'mixed_unknown_treated_as_mutating' : 'mixed_local_only',
  };
}

function commandMutatesYida(entry, args = []) {
  const effect = entry && entry.sideEffect;
  if (!effect) {
    return { mutatesYida: true, reason: 'unknown_command_treated_as_mutating' };
  }
  if (effect.kind === 'mixed') {
    return classifyMixedAction(effect, args);
  }
  return {
    mutatesYida: !!effect.mutates_yida,
    reason: effect.mutates_yida ? 'remote_mutation' : 'non_remote_mutation',
  };
}

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function collectInputFiles(args, cwd) {
  const files = [];
  const seen = new Set();
  for (const arg of args || []) {
    if (!arg || arg.startsWith('-') || arg.trim().startsWith('{') || arg.trim().startsWith('[')) {
      continue;
    }
    const resolved = path.resolve(cwd, arg);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      continue;
    }
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    files.push({
      path: path.relative(cwd, resolved) || path.basename(resolved),
      absolutePath: resolved,
      sha256: hashFile(resolved),
    });
  }
  return files;
}

function stripSafetyOutputArgs(args = []) {
  return (args || []).filter(arg => arg !== '--json');
}

function writePlan(command, args, entry, modeInfo, options = {}) {
  const cwd = options.cwd || process.cwd();
  const projectRoot = modeInfo.projectRoot || findProjectRoot();
  const planRoot = path.join(projectRoot, PLAN_DIR);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const suffix = crypto.randomBytes(4).toString('hex');
  const planPath = path.join(planRoot, `${stamp}-${command || 'command'}-${suffix}.json`);
  const commandArgs = stripSafetyOutputArgs(args);
  const plan = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    mode: 'plan',
    command: [command, ...commandArgs],
    command_id: entry && entry.id,
    cwd,
    projectRoot,
    side_effect: entry && entry.sideEffect,
    inputs: collectInputFiles(commandArgs, cwd),
  };
  writeJsonFile(planPath, plan);
  return { planPath, plan };
}

function buildBlockedOutput(command, args, entry, modeInfo, reason) {
  return {
    success: false,
    blocked: true,
    mode: modeInfo.effective,
    reason,
    command: [command, ...(args || [])].filter(Boolean).join(' '),
    command_id: entry && entry.id,
    side_effect: entry && entry.sideEffect,
    hint: modeInfo.effective === 'readonly'
      ? 'OpenYida safety mode is readonly. Switch safety mode outside an agent environment, or use plan mode to create a reviewable plan.'
      : 'OpenYida safety mode blocked this command.',
  };
}

function enforceSafetyMode(command, args = [], options = {}) {
  const safeManagementCommands = new Set([
    'safety',
    'apply-plan',
    'commands',
    'agent-capabilities',
    'mcp',
    'a2a',
  ]);

  if (!command || command.startsWith('-') || safeManagementCommands.has(command)) {
    return { action: 'allow', modeInfo: resolveSafetyMode(options) };
  }

  if (process.env.OPENYIDA_APPLY_PLAN_FILE) {
    const modeInfo = resolveSafetyMode(options);
    const activeTool = detectActiveTool();
    if (activeTool) {
      return {
        action: 'block',
        exitCode: 2,
        output: {
          success: false,
          blocked: true,
          mode: modeInfo.effective,
          reason: 'apply_plan_agent_environment_denied',
          command: [command, ...(args || [])].filter(Boolean).join(' '),
          hint: 'Apply OpenYida plans from a normal terminal, not from an agent environment.',
        },
        modeInfo,
      };
    }
    try {
      validatePlanForCommand(process.env.OPENYIDA_APPLY_PLAN_FILE, command, args, process.cwd());
      return { action: 'allow', modeInfo, applyPlan: true };
    } catch (err) {
      return {
        action: 'block',
        exitCode: 2,
        output: {
          success: false,
          blocked: true,
          mode: modeInfo.effective,
          reason: 'apply_plan_validation_failed',
          command: [command, ...(args || [])].filter(Boolean).join(' '),
          error: err.message,
        },
        modeInfo,
      };
    }
  }

  const modeInfo = resolveSafetyMode(options);
  if (modeInfo.effective === 'full') {
    return { action: 'allow', modeInfo };
  }

  const entry = getCommandEntry(command, args);
  const mutation = commandMutatesYida(entry, args);
  if (!mutation.mutatesYida) {
    return { action: 'allow', modeInfo, commandEntry: entry };
  }

  if (modeInfo.effective === 'readonly') {
    return {
      action: 'block',
      exitCode: 2,
      output: buildBlockedOutput(command, args, entry, modeInfo, mutation.reason),
      modeInfo,
      commandEntry: entry,
    };
  }

  if (modeInfo.effective === 'plan') {
    const { planPath, plan } = writePlan(command, args, entry, modeInfo, options);
    return {
      action: 'plan',
      output: {
        success: true,
        planned: true,
        mode: 'plan',
        command: plan.command.join(' '),
        command_id: plan.command_id,
        planFile: planPath,
        side_effect: plan.side_effect,
        hint: 'Review this plan file, then run openyida apply-plan <plan-file> from a non-agent terminal to execute it.',
      },
      plan,
      planPath,
      modeInfo,
      commandEntry: entry,
    };
  }

  return { action: 'allow', modeInfo, commandEntry: entry };
}

function isLoosening(fromMode, toMode) {
  const from = normalizeSafetyMode(fromMode) || DEFAULT_SAFETY_MODE;
  const to = normalizeSafetyMode(toMode) || DEFAULT_SAFETY_MODE;
  return SAFETY_MODES[to] < SAFETY_MODES[from];
}

function setSafetyMode(scope, mode, options = {}) {
  const normalizedMode = normalizeSafetyMode(mode);
  if (!normalizedMode) {
    throw new Error(`Invalid safety mode: ${mode}`);
  }

  const projectRoot = options.projectRoot || findProjectRoot();
  const configPath = scope === 'global'
    ? GLOBAL_CONFIG_FILE
    : getProjectSafetyConfigPath(projectRoot);
  const config = readJsonFile(configPath) || {};
  const previousGlobalConfig = loadGlobalSafetyConfig();
  const previousProjectConfig = loadProjectSafetyConfig(projectRoot);
  const previousEffective = resolveSafetyMode({
    projectRoot,
    globalConfig: previousGlobalConfig,
    projectConfig: previousProjectConfig,
  }).effective;
  const previousMode = readModeFromConfig(config) || DEFAULT_SAFETY_MODE;
  const nextConfig = { ...config, safetyMode: normalizedMode };
  const nextEffective = resolveSafetyMode({
    projectRoot,
    globalConfig: scope === 'global' ? nextConfig : previousGlobalConfig,
    projectConfig: scope === 'project' ? nextConfig : previousProjectConfig,
  }).effective;
  const effectiveLoosening = isLoosening(previousEffective, nextEffective);
  const activeTool = detectActiveTool();

  if (activeTool && effectiveLoosening) {
    const err = new Error(`Refusing to loosen OpenYida safety mode from ${previousMode} to ${normalizedMode} inside ${activeTool.displayName}. Run this from a normal terminal.`);
    err.code = 'SAFETY_MODE_AGENT_LOOSENING_DENIED';
    throw err;
  }
  if (effectiveLoosening && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    const err = new Error(`Refusing to loosen OpenYida effective safety mode from ${previousEffective} to ${nextEffective} in a non-interactive shell. Run this from an interactive terminal.`);
    err.code = 'SAFETY_MODE_NONINTERACTIVE_LOOSENING_DENIED';
    throw err;
  }

  config.safetyMode = normalizedMode;
  writeJsonFile(configPath, config);
  return {
    scope,
    previousMode,
    mode: normalizedMode,
    configFile: configPath,
    effective: resolveSafetyMode({ projectRoot }).effective,
  };
}

function validatePlanForCommand(planFile, command, args, cwd = process.cwd()) {
  const planPath = path.resolve(cwd, planFile);
  const plan = readJsonFile(planPath);
  if (!plan || !Array.isArray(plan.command)) {
    throw new Error('Invalid OpenYida plan file');
  }
  const expected = [command, ...(args || [])];
  if (JSON.stringify(plan.command) !== JSON.stringify(expected)) {
    throw new Error('Plan command does not match the command being executed');
  }
  for (const input of plan.inputs || []) {
    const inputPath = path.resolve(plan.cwd || cwd, input.path);
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Plan input file is missing: ${input.path}`);
    }
    const actualHash = hashFile(inputPath);
    if (actualHash !== input.sha256) {
      throw new Error(`Plan input file changed: ${input.path}`);
    }
  }
  return plan;
}

module.exports = {
  DEFAULT_SAFETY_MODE,
  GLOBAL_CONFIG_FILE,
  SAFETY_MODES,
  commandIdForArgs,
  commandMutatesYida,
  enforceSafetyMode,
  getCommandEntry,
  getProjectSafetyConfigPath,
  isLoosening,
  normalizeSafetyMode,
  resolveSafetyMode,
  setSafetyMode,
  strictestMode,
  validatePlanForCommand,
  writePlan,
};
