'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { compileCanvasLocal } = require('../lib/app/canvas-compile');
const { capabilities, validateSpec, buildSource, scaffold } = require('../lib/task-center/scaffold');
const { resolveManagedPolicy } = require('../lib/core/managed-policy');
const { findDirectFormOpenIssues } = require('../lib/app/form-open-guard');

let directory;
let designFile;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-task-'));
  designFile = path.join(directory, 'design.md');
  fs.writeFileSync(designFile, '# Application style\nUse the existing application theme.\n');
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const spec = choice => ({ appType: 'APP_TEST', designFile, customPage: choice });
const explicit = { source: 'explicit-user-request', confirmed: true };

test.each([
  undefined, {}, { confirmed: true }, { source: 'ask_human' },
  { source: 'ask_human', confirmed: false }, { source: 'ask_human', confirmed: 'true' },
  { source: 'fast', confirmed: true }, { source: 'agent-recommendation', confirmed: true },
  { source: 'existing-canvas', confirmed: true }, { source: 'general-authorization', confirmed: true },
])('no custom file can be generated without an explicit affirmative selection (%j)', choice => {
  const input = path.join(directory, 'spec.json');
  const output = path.join(directory, 'task.canvas.jsx');
  fs.writeFileSync(input, JSON.stringify(spec(choice)));
  expect(() => scaffold(input, output)).toThrow(/customPage/);
  expect(fs.existsSync(output)).toBe(false);
});

test.each(['explicit-user-request', 'ask_human'])('both valid selection sources compile (%s)', source => {
  const config = validateSpec(spec({ source, confirmed: true }));
  const sourceCode = buildSource(config);
  const compiled = compileCanvasLocal(sourceCode);
  expect(JSON.parse(compiled.importedModules)).toEqual(expect.arrayContaining(['react', 'antd', 'lucide-react']));
  expect(findDirectFormOpenIssues(sourceCode)).toEqual([]);
  // Application tokens are read at runtime, never replaced with a new root palette.
  expect(sourceCode).not.toMatch(/:root\s*\{|--color-brand1-6\s*:/);
  expect(sourceCode).not.toMatch(/Bearer |access_token|\/Users\//);
});

test('embedded mode compiles with one mounted provider and one native detail container', () => {
  const source = buildSource(validateSpec({ ...spec(explicit), mode: 'embedded', kinds: ['todo'], title: 'Inbox' }));
  expect(() => compileCanvasLocal(source)).not.toThrow();
  expect((source.match(/<CanvasThemeProvider>/g) || [])).toHaveLength(1);
  expect((source.match(/function FormOpenContainer\(/g) || [])).toHaveLength(1);
});

test('invalid modes, kinds, theme inputs and title fail before file output', () => {
  for (const patch of [{ kinds: [] }, { kinds: ['todo', 'todo'] }, { kinds: ['proxy'] }, { defaultKind: 'done', kinds: ['todo'] }, { mode: 'dashboard' }, { designFile: '/missing/design.md' }, { pageSize: 101 }, { appType: '../other' }, { title: '' }, { endpoint: '/other' }]) {
    expect(() => validateSpec({ ...spec(explicit), ...patch })).toThrow();
  }
});

test('managed page assembly stays within the bound application', () => {
  const previousRun = process.env.OPENYIDA_MANAGED_RUN;
  const previousApp = process.env.OPENYIDA_AGENT_APP_TYPE;
  try {
    process.env.OPENYIDA_MANAGED_RUN = '1';
    process.env.OPENYIDA_AGENT_APP_TYPE = 'APP_BOUND';
    expect(() => validateSpec(spec(explicit))).toThrow('appType');
    expect(validateSpec({ ...spec(explicit), appType: 'APP_BOUND' }).appType).toBe('APP_BOUND');
  } finally {
    if (previousRun === undefined) { delete process.env.OPENYIDA_MANAGED_RUN; } else { process.env.OPENYIDA_MANAGED_RUN = previousRun; }
    if (previousApp === undefined) { delete process.env.OPENYIDA_AGENT_APP_TYPE; } else { process.env.OPENYIDA_AGENT_APP_TYPE = previousApp; }
  }
});

test('generation never overwrites an existing page or its input', () => {
  const input = path.join(directory, 'spec.json');
  const output = path.join(directory, 'page.canvas.jsx');
  fs.writeFileSync(input, JSON.stringify(spec(explicit)));
  const receipt = scaffold(input, output);
  expect(receipt).toMatchObject({ success: true, runtimeVerified: false, theme: 'existing-application' });
  const original = fs.readFileSync(output, 'utf8');
  expect(() => scaffold(input, output)).toThrow();
  expect(fs.readFileSync(output, 'utf8')).toBe(original);
});

test('published flow and carbon detail targets preserve instance and node context', () => {
  const source = buildSource(validateSpec(spec(explicit)));
  const functionSource = source.slice(source.indexOf('function appendQuery'), source.indexOf('/** 抽屉'));
  const context = vm.createContext({});
  vm.runInContext(functionSource, context);
  const flow = new URL(context.buildYidaFormUrl({ type: 'process-detail', processInstanceId: 'p 1', taskId: 't&2', params: { procInsId: 'wrong', isRenderNav: true } }, 'APP_TEST'), 'https://example.test');
  expect(flow.pathname).toBe('/APP_TEST/processDetail');
  expect(flow.searchParams.get('procInsId')).toBe('p 1');
  expect(flow.searchParams.get('taskId')).toBe('t&2');
  expect(flow.searchParams.get('isRenderNav')).toBe('false');
  const carbon = new URL(context.buildYidaFormUrl({ type: 'carbon-detail', processInstanceId: 'p', activityId: 'a', params: { taskId: 'stale' } }, 'APP_TEST'), 'https://example.test');
  expect(carbon.searchParams.get('formInstId')).toBe('p');
  expect(carbon.searchParams.get('activityId')).toBe('a');
  expect(carbon.searchParams.get('url_type')).toBe('carbon');
  expect(carbon.searchParams.has('taskId')).toBe(false);
  expect(context.buildYidaFormUrl({ type: 'carbon-detail', processInstanceId: 'p' }, 'APP_TEST')).toBe('');
  expect(context.buildYidaFormUrl({ type: 'process-detail' }, 'APP_TEST')).toBe('');
});

test('local commands do not expand managed tasks to organization queries', () => {
  expect(resolveManagedPolicy('task-center', ['capabilities']).policy.scope).toBe('local');
  expect(resolveManagedPolicy('task-center', ['scaffold']).policy.scope).toBe('local');
  for (const type of ['todo', 'created', 'done', 'cc', 'proxy']) {
    const resolved = resolveManagedPolicy('task-center', [type]);
    expect(resolved?.policy?.scope).not.toBe('app');
    expect(resolved?.policy?.scope).not.toBe('local');
  }
  expect(capabilities().inlineApproval).toBe(false);
});

test('explicit query transport and per-kind filters use the same portable contract', () => {
  const config = validateSpec({ ...spec(explicit), kinds: ['todo', 'created'], transport: 'app-query', filters: {
    todo: { originators: '["person-a"]', taskCreateFrom: '1792195200000' },
    created: { processCodes: ['process-a'] },
  } });
  expect(config).toMatchObject({ transport: 'app-query', filters: { todo: { originators: ['person-a'], taskCreateFrom: 1792195200000 }, created: { processCodes: ['process-a'] } } });
  const source = buildSource(config);
  expect(() => compileCanvasLocal(source)).not.toThrow();
  expect(source).toContain('function normalizeFilters(');
  expect(source).toContain('credentials: \'include\'');
  expect(source).not.toMatch(/Bearer |access_token|\/Users\//);
  for (const patch of [
    { transport: 'automatic' }, { filters: [] }, { filters: { proxy: {} } },
    { filters: { created: { originators: ['person-a'] } } },
    { filters: { todo: { userId: 'other' } } },
  ]) { expect(() => validateSpec({ ...spec(explicit), transport: 'app-query', ...patch })).toThrow(); }
  expect(() => validateSpec({ ...spec(explicit), filters: { todo: { originators: ['person-a'] } } })).toThrow('TASK_FILTER_UNSUPPORTED');
});

test('lookup options are application-bound read actions, not global-query admission', () => {
  expect(resolveManagedPolicy('task-center', ['options', 'APP_TEST', '--type', 'originators']).policy).toEqual({ scope: 'app', appPosition: 1 });
  expect(capabilities().lookups.kinds).toEqual(['originators', 'processes', 'forms']);
});

test('default assembly contains one task kind and only the requested filters and fields', () => {
  expect(validateSpec(spec(explicit)).kinds).toEqual(['todo']);
  expect(capabilities().scaffold.specExample.kinds).toEqual(['todo']);
  const config = validateSpec({ ...spec(explicit), transport: 'app-query', filterFields: { todo: ['originators', 'taskCreateFrom'] }, fields: ['title', 'summary'] });
  expect(config.filterFields.todo).toEqual(['originators', 'taskCreateFrom']);
  expect(() => compileCanvasLocal(buildSource(config))).not.toThrow();
  for (const patch of [{ filterFields: { todo: ['instanceStatus'] } }, { filterFields: { created: [] } }, { fields: ['title', 'unknown'] }, { fields: ['summary'] }, { expandProcess: 'true' }, { history: true }]) {
    expect(() => validateSpec({ ...spec(explicit), ...patch })).toThrow();
  }
});

test('progress assembly compiles with a real linked instance or an explicit embedded prop', () => {
  const input = path.join(directory, 'progress.json'), output = path.join(directory, 'progress.canvas.jsx');
  fs.writeFileSync(input, JSON.stringify({ ...spec(explicit), view: 'progress', history: true }));
  const receipt = scaffold(input, output);
  expect(receipt).toMatchObject({ component: 'ProcessProgressSection', mode: 'embedded', requiredProps: ['processInstanceId'] });
  expect(findDirectFormOpenIssues(fs.readFileSync(output, 'utf8'))).toEqual([]);
  const known = validateSpec({ ...spec(explicit), view: 'progress', mode: 'page', processInstanceId: 'instance-a' });
  expect(() => compileCanvasLocal(buildSource(known))).not.toThrow();
  for (const patch of [{ mode: 'page' }, { processInstanceId: '' }, { kinds: ['todo'] }, { filters: {} }, { formUuid: 'FORM_A' }]) {
    expect(() => validateSpec({ ...spec(explicit), view: 'progress', ...patch })).toThrow();
  }
  expect(() => validateSpec({ appType: 'APP_TEST', designFile, view: 'progress' })).toThrow('customPage');
});

test('workflow reads are application-bound read actions without a custom-page confirmation', () => {
  for (const action of ['inspect', 'count']) {
    const result = resolveManagedPolicy('task-center', [action, 'APP_TEST']);
    expect(result.policy).toEqual({ scope: 'app', appPosition: 1 });
  }
});
