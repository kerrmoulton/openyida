'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yida.js');

function makeWorkspace() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-safety-home-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-safety-work-'));
  const project = path.join(workspace, 'project');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'config.json'), '{}', 'utf8');
  return { home, workspace, project };
}

function envFor(home, extra = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    OPENYIDA_LANG: 'zh',
    CI: '1',
    QODER_IDE: '',
    QODER_AGENT: '',
    QODERCLI_INTEGRATION_MODE: '',
    CODEX_SHELL: '',
    CODEX_CI: '',
    CODEX_THREAD_ID: '',
    CODEX_HOME: '',
    CLAUDE_CODE: '',
    CLAUDE_CODE_ENTRYPOINT: '',
    OPENCODE: '',
    OPENCODE_CLIENT: '',
    CURSOR_TRACE_ID: '',
    VSCODE_GIT_ASKPASS_NODE: '',
    AGENT_WORK_ROOT: '',
    MULERUN_CHAT_ID: '',
    MULE_DATA_DIR: '',
    OPENYIDA_AGENT_MODE: '',
    __CFBundleIdentifier: '',
    OPENYIDA_SAFETY_MODE: '',
    OPENYIDA_APPLY_PLAN_FILE: '',
    ...extra,
  };
}

function runCli(ctx, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: ctx.workspace,
    env: envFor(ctx.home, extraEnv),
    encoding: 'utf8',
    timeout: 10000,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function parseJsonOutput(result) {
  const text = result.stdout.trim() || result.stderr.trim();
  return JSON.parse(text);
}

describe('OpenYida safety mode', () => {
  const contexts = [];

  afterEach(() => {
    while (contexts.length > 0) {
      const ctx = contexts.pop();
      fs.rmSync(ctx.home, { recursive: true, force: true });
      fs.rmSync(ctx.workspace, { recursive: true, force: true });
    }
  });

  function ctx() {
    const created = makeWorkspace();
    contexts.push(created);
    return created;
  }

  test('defaults to full mode when no safety config exists', () => {
    const current = ctx();
    const result = runCli(current, ['safety', 'status', '--json']);
    expect(result.status).toBe(0);
    expect(parseJsonOutput(result)).toMatchObject({
      default: 'full',
      global: null,
      project: null,
      env: null,
      effective: 'full',
      rule: 'strictest_mode_wins',
    });
  });

  test('strictest mode wins across global and project config', () => {
    const current = ctx();
    let result = runCli(current, ['safety', 'global', 'mode', 'readonly', '--json']);
    expect(result.status).toBe(0);
    expect(parseJsonOutput(result)).toMatchObject({ success: true, mode: 'readonly', effective: 'readonly' });

    result = runCli(current, ['safety', 'project', 'mode', 'full', '--json']);
    expect(result.status).toBe(0);
    expect(parseJsonOutput(result)).toMatchObject({ success: true, mode: 'full', effective: 'readonly' });

    result = runCli(current, ['safety', 'status', '--json']);
    expect(parseJsonOutput(result)).toMatchObject({
      global: 'readonly',
      project: 'full',
      effective: 'readonly',
    });
  });

  test('environment safety mode can tighten but cannot loosen configured mode', () => {
    const current = ctx();
    let result = runCli(current, ['safety', 'global', 'mode', 'readonly', '--json']);
    expect(result.status).toBe(0);

    result = runCli(current, ['safety', 'status', '--json'], { OPENYIDA_SAFETY_MODE: 'full' });
    expect(parseJsonOutput(result)).toMatchObject({
      global: 'readonly',
      env: 'full',
      effective: 'readonly',
    });

    const fullCtx = ctx();
    result = runCli(fullCtx, ['safety', 'status', '--json'], { OPENYIDA_SAFETY_MODE: 'plan' });
    expect(parseJsonOutput(result)).toMatchObject({
      global: null,
      env: 'plan',
      effective: 'plan',
    });
  });

  test('agent environments cannot loosen safety mode', () => {
    const current = ctx();
    let result = runCli(current, ['safety', 'global', 'mode', 'readonly', '--json']);
    expect(result.status).toBe(0);

    result = runCli(current, ['safety', 'global', 'mode', 'full', '--json'], {
      CODEX_HOME: path.join(current.home, '.codex'),
    });
    expect(result.status).toBe(1);
    expect(parseJsonOutput(result)).toMatchObject({
      success: false,
      code: 'SAFETY_MODE_AGENT_LOOSENING_DENIED',
    });
  });

  test('non-interactive shells cannot loosen effective safety mode', () => {
    const current = ctx();
    let result = runCli(current, ['safety', 'global', 'mode', 'readonly', '--json']);
    expect(result.status).toBe(0);

    result = runCli(current, ['safety', 'global', 'mode', 'full', '--json']);
    expect(result.status).toBe(1);
    expect(parseJsonOutput(result)).toMatchObject({
      success: false,
      code: 'SAFETY_MODE_NONINTERACTIVE_LOOSENING_DENIED',
    });
  });

  test('readonly blocks remote write commands before command implementation runs', () => {
    const current = ctx();
    const result = runCli(current, ['publish', 'missing.oyd.jsx', 'APP_XXX', 'FORM-XXX', '--json'], {
      OPENYIDA_SAFETY_MODE: 'readonly',
    });
    expect(result.status).toBe(2);
    const parsed = parseJsonOutput(result);
    expect(parsed).toMatchObject({
      success: false,
      blocked: true,
      mode: 'readonly',
      command_id: 'publish',
    });
    expect(parsed.error).toBeUndefined();
  });

  test('readonly blocks batch as a possible bypass path', () => {
    const current = ctx();
    const result = runCli(current, ['batch', '--commands', 'get-schema APP_XXX FORM-XXX', '--json'], {
      OPENYIDA_SAFETY_MODE: 'readonly',
    });
    expect(result.status).toBe(2);
    expect(parseJsonOutput(result)).toMatchObject({
      success: false,
      blocked: true,
      command_id: 'batch.inline',
    });
  });

  test('readonly allows remote read command help paths', () => {
    const current = ctx();
    const result = runCli(current, ['app-list', '--help'], {
      OPENYIDA_SAFETY_MODE: 'readonly',
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain('openyida app-list');
  });

  test('plan mode writes a reviewable plan instead of executing remote write command', () => {
    const current = ctx();
    const result = runCli(current, ['publish', 'missing.oyd.jsx', 'APP_XXX', 'FORM-XXX', '--json'], {
      OPENYIDA_SAFETY_MODE: 'plan',
    });
    expect(result.status).toBe(0);
    const parsed = parseJsonOutput(result);
    expect(parsed).toMatchObject({
      success: true,
      planned: true,
      mode: 'plan',
      command_id: 'publish',
    });
    expect(fs.existsSync(parsed.planFile)).toBe(true);
    const plan = JSON.parse(fs.readFileSync(parsed.planFile, 'utf8'));
    expect(plan).toMatchObject({
      schema_version: 1,
      mode: 'plan',
      command: ['publish', 'missing.oyd.jsx', 'APP_XXX', 'FORM-XXX'],
      command_id: 'publish',
    });
  });

  test('apply-plan is denied inside agent environments', () => {
    const current = ctx();
    const planPath = path.join(current.project, '.cache', 'openyida', 'plans', 'manual.json');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify({
      schema_version: 1,
      command: ['publish', 'missing.oyd.jsx', 'APP_XXX', 'FORM-XXX'],
      cwd: current.workspace,
      inputs: [],
    }), 'utf8');

    const result = runCli(current, ['apply-plan', planPath, '--json'], {
      CODEX_HOME: path.join(current.home, '.codex'),
    });
    expect(result.status).toBe(2);
    expect(parseJsonOutput(result)).toMatchObject({
      success: false,
      blocked: true,
      code: 'OPENYIDA_APPLY_PLAN_AGENT_DENIED',
    });
  });
});
