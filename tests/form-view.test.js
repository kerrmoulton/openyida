'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, execute, parseArgs, configHash, validatePatch } = require('../lib/app/form-view');

let dir;
let client;
let config;
let views;
let backupPath;
const view = id => ({ viewUuid: id, viewType: 'table', name: JSON.stringify({ zh_CN: id }), status: JSON.stringify({ PC: 'ACTIVATED' }) });
const read = (action, extra = []) => parseArgs([action, 'APP_TEST', 'FORM_TEST', ...extra, '--json']);
function file(value) {
  const filename = path.join(dir, 'patch.json');
  fs.writeFileSync(filename, JSON.stringify(value));
  return filename;
}
function save(patch, extra = []) {
  return read('save', ['VIEW_A', '--config', file(patch), '--backup', backupPath, ...extra]);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'form-view-test-'));
  backupPath = path.join(dir, 'before.json');
  config = { viewUuid: 'VIEW_A', staticConfig: { columnFilter: ['name', 'status'], buttonList: [{ code: 'edit' }] },
    defaultConfig: { showFields: ['name', 'status'], filter: { values: {}, conditionType: 'AND' }, widths: { name: 200 }, unknownPlatformSetting: true } };
  views = [view('VIEW_A'), view('VIEW_B')];
  client = {
    get: jest.fn(async () => ({ success: true, content: { componentValueVoList: [
      { id: 'name', componentName: 'TextField' }, { id: 'status', componentName: 'SelectField', operatorMap: [{ value: 'eq' }] },
    ] } })),
    postForm: jest.fn(async (endpoint, params) => {
      if (endpoint.includes('getFormSchemaInfo')) { return { success: true, content: { multiViewInfos: views } }; }
      if (endpoint.includes('getViewConfig')) { return { success: true, content: JSON.parse(JSON.stringify({ ...config, viewUuid: params.viewUuid })) }; }
      throw new Error(endpoint);
    }),
    postFormOnce: jest.fn(async (endpoint, params) => {
      if (endpoint.includes('updateConfig')) { config = { viewUuid: params.viewUuid, staticConfig: JSON.parse(params.staticConfig), defaultConfig: JSON.parse(params.defaultConfig) }; }
      if (endpoint.includes('createView')) { views.push({ ...view('VIEW_C'), name: params.name }); }
      if (endpoint.includes('updateViewPageConfig')) { views = JSON.parse(params.viewConfig).map(id => views.find(v => v.viewUuid === id)); }
      return { success: true, content: true };
    }),
  };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('lists all native views and optionally reads every configuration', async () => {
  const result = await execute(read('list', ['--with-config']), client);
  expect(result.totalCount).toBe(2);
  expect(result.views[1]).toMatchObject({ name: { zh_CN: 'VIEW_B' }, config: { viewUuid: 'VIEW_B' } });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('inspect parses serialized configs and returns a stable content hash', async () => {
  const original = client.postForm.getMockImplementation();
  client.postForm.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0].includes('getViewConfig')) { result.content.staticConfig = JSON.stringify(result.content.staticConfig); }
    return result;
  });
  const result = await execute(read('inspect', ['VIEW_A']), client);
  expect(result.configHash).toBe(configHash(config));
  expect(configHash({ ...config, defaultConfig: { ...config.defaultConfig } })).toBe(result.configHash);
});

test('patches visibility/order, width, frozen columns and default filter while preserving unrelated settings', async () => {
  const before = JSON.parse(JSON.stringify(config));
  const result = await execute(save({ defaultConfig: { showFields: ['status', 'name'], widths: { status: 150 }, lockFieldIds: ['status'], filter: { values: { status: 'open' } } } }), client);
  expect(result.readbackVerified).toBe(true);
  expect(result.config.defaultConfig).toMatchObject({ widths: { name: 200, status: 150 }, lockFieldIds: ['status'], unknownPlatformSetting: true,
    filter: { values: { status: 'open' } } });
  expect(result.config.staticConfig).toEqual(before.staticConfig);
  expect(JSON.parse(fs.readFileSync(backupPath)).config).toEqual(before);
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});

test('clears frozen columns with [] and does not mutate no-op patches', async () => {
  config.defaultConfig.lockFieldIds = ['name'];
  expect((await execute(save({ defaultConfig: { lockFieldIds: [] } }), client)).config.defaultConfig.lockFieldIds).toEqual([]);
  client.postFormOnce.mockClear();
  expect((await execute(save({ defaultConfig: { lockFieldIds: [] } }), client)).changed).toBe(false);
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('empty filter replaces old conditions and invalid field/operator references fail before writes', async () => {
  config.defaultConfig.filter = { values: { status: 'open' }, operationValues: { status: 'eq' } };
  expect((await execute(save({ defaultConfig: { filter: {} } }), client)).config.defaultConfig.filter).toEqual({});
  client.postFormOnce.mockClear();
  for (const patch of [
    { defaultConfig: { showFields: ['missing'] } },
    { defaultConfig: { filter: { operationValues: { status: 'INVALID' } } } },
    { defaultConfig: { showFields: ['status'], lockFieldIds: ['name'] } },
    { staticConfig: { columnFilter: ['name'] }, defaultConfig: { showFields: ['status'] } },
  ]) {
    await expect(execute(save(patch), client)).rejects.toMatchObject({ code: 'FORM_VIEW_INVALID_CONFIG' });
  }
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('stale expected hash and concurrent changes both stop before mutation', async () => {
  await expect(execute(save({ defaultConfig: { widths: { name: 250 } } }, ['--expected-hash', 'stale']), client)).rejects.toMatchObject({ code: 'FORM_VIEW_CONFLICT' });
  const original = client.postForm.getMockImplementation();
  let reads = 0;
  client.postForm.mockImplementation(async (...args) => {
    if (args[0].includes('getViewConfig') && ++reads === 2) { config.defaultConfig.widths.name = 300; }
    return original(...args);
  });
  await expect(execute(save({ defaultConfig: { widths: { name: 250 } } }), client)).rejects.toMatchObject({ code: 'FORM_VIEW_CONFLICT' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('readback mismatch is a failure even after a successful write acknowledgement', async () => {
  client.postFormOnce.mockResolvedValue({ success: true });
  await expect(execute(save({ defaultConfig: { widths: { name: 250 } } }), client)).rejects.toMatchObject({
    code: 'FORM_VIEW_READBACK_MISMATCH', details: { mutationAccepted: true, retrySafe: false, backupPath },
  });
});

test('accepts only the server-generated latestUpdateTime difference on readback', async () => {
  const original = client.postFormOnce.getMockImplementation();
  client.postFormOnce.mockImplementation(async (...args) => {
    const result = await original(...args);
    config.defaultConfig.latestUpdateTime = Date.now();
    return result;
  });
  const result = await execute(save({ defaultConfig: { widths: { name: 250 } } }), client);
  expect(result.readbackVerified).toBe(true);
  expect(result.config.defaultConfig.latestUpdateTime).toEqual(expect.any(Number));
});

test('restores a native backup without dropping platform settings or sending its old timestamp', async () => {
  config.defaultConfig.latestUpdateTime = 123;
  const original = JSON.parse(JSON.stringify(config));
  const result = await execute(save({ defaultConfig: { widths: { name: 250, status: 100 } } }), client);
  const saved = JSON.parse(fs.readFileSync(result.backupPath)).config;
  const restored = await execute(save({ staticConfig: saved.staticConfig, defaultConfig: saved.defaultConfig }, [
    '--backup', path.join(dir, 'restore-before.json'), '--replace', '--expected-hash', configHash(result.config),
  ]), client);
  expect(restored.config.defaultConfig.widths).toEqual(original.defaultConfig.widths);
  expect(restored.config.defaultConfig.unknownPlatformSetting).toBe(true);
  expect(JSON.parse(client.postFormOnce.mock.calls[1][1].defaultConfig)).not.toHaveProperty('latestUpdateTime');
});

test('full replacement requires both config objects and an expected hash', async () => {
  for (const patch of [{ defaultConfig: {} }, { staticConfig: {}, defaultConfig: {} }]) {
    await expect(execute(save(patch, ['--replace']), client)).rejects.toMatchObject({ code: 'FORM_VIEW_INVALID_CONFIG' });
  }
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('transport failures never replay writes and retain recovery details', async () => {
  client.postFormOnce.mockRejectedValue(new Error('connection reset'));
  await expect(execute(save({ defaultConfig: { widths: { name: 250 } } }), client)).rejects.toMatchObject({ details: { retrySafe: false, sideEffectState: 'unknown', backupPath } });
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(backupPath)).toBe(true);
});

test('refuses cross-form view IDs, missing platform capability and permission errors', async () => {
  await expect(execute(read('inspect', ['OTHER_VIEW']), client)).rejects.toMatchObject({ code: 'FORM_VIEW_TARGET_MISMATCH' });
  client.postForm.mockResolvedValue({ success: true, content: {} });
  await expect(execute(read('list'), client)).rejects.toMatchObject({ code: 'FORM_VIEW_UNSUPPORTED' });
  client.postForm.mockResolvedValue({ success: false, errorCode: 'NO_PERMISSION', errorMsg: 'denied' });
  await expect(execute(read('list'), client)).rejects.toMatchObject({ code: 'FORM_VIEW_API_ERROR', details: { platformErrorCode: 'NO_PERMISSION' } });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('local IO and transport exceptions retain structured CLI errors', async () => {
  await expect(run(['save', 'APP_TEST', 'FORM_TEST', 'VIEW_A', '--config', path.join(dir, 'absent.json'), '--json'], { client }))
    .rejects.toMatchObject({ isCliError: true, code: 'FORM_VIEW_FAILED' });
  client.postForm.mockRejectedValue(new Error('offline'));
  await expect(run(['list', 'APP_TEST', 'FORM_TEST', '--json'], { client }))
    .rejects.toMatchObject({ isCliError: true, code: 'FORM_VIEW_FAILED', message: 'offline' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('creates a table view and verifies its returned UUID from the native list', async () => {
  const result = await execute(read('create', ['--name', 'Open orders', '--backup', backupPath]), client);
  expect(result).toMatchObject({ viewUuid: 'VIEW_C', readbackVerified: true });
});

test('orders every view and rejects missing or duplicate UUIDs', async () => {
  for (const ids of [['VIEW_A'], ['VIEW_A', 'VIEW_A'], ['VIEW_A', 'OTHER']]) {
    await expect(execute(read('order', ['--config', file(ids), '--backup', backupPath]), client)).rejects.toMatchObject({ code: 'FORM_VIEW_INVALID_CONFIG' });
  }
  const result = await execute(read('order', ['--config', file(['VIEW_B', 'VIEW_A']), '--backup', backupPath]), client);
  expect(result.views.map(v => v.viewUuid)).toEqual(['VIEW_B', 'VIEW_A']);
  expect(result.readbackVerified).toBe(true);
});

test.each([
  { defaultConfig: { showFields: [] } }, { defaultConfig: { showFields: ['name', 'name'] } },
  { defaultConfig: { widths: { name: -1 } } }, { defaultConfig: { widths: { name: '200px' } } },
  { defaultConfig: { lockFieldIds: 'name' } }, { defaultConfig: { filter: [] } },
  { staticConfig: null }, { defaultConfig: { sort: 'name' } }, { viewUuid: 'OTHER' },
  JSON.parse('{"defaultConfig":{"__proto__":{"polluted":true}}}'),
])('invalid patches are rejected before a remote write: %j', async patch => {
  expect(() => validatePatch(patch)).toThrow();
  await expect(execute(save(patch), client)).rejects.toMatchObject({ code: 'FORM_VIEW_INVALID_CONFIG' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test.each([
  ['save', 'APP_TEST', 'FORM_TEST', 'VIEW_A'], ['inspect', 'APP_TEST', 'FORM_TEST'],
  ['list', 'APP_TEST', 'FORM_TEST', '--bogus'], ['list', '../APP', 'FORM_TEST'],
  ['create', 'APP_TEST', 'FORM_TEST', '--name'], ['list', 'APP_TEST', 'FORM_TEST', '--config', 'x'],
])('strict argument parsing refuses %j', (...args) => expect(() => parseArgs(args)).toThrow());
