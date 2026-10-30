'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
jest.mock('../lib/core/utils', () => ({
  httpGet: jest.fn(), httpPost: jest.fn(), requestWithAutoLogin: jest.fn((fn, auth) => fn(auth)),
}));
jest.mock('../lib/core/yida-client', () => ({ createAuthRef: jest.fn() }));
const { httpGet, httpPost } = require('../lib/core/utils');
const { snapshot, restore, parseArgs, KEYS, loadSnapshot, downloadCss } = require('../lib/app/app-theme');
const { buildCommandManifest } = require('../lib/core/command-manifest');
const auth = { baseUrl: 'https://test.example', corpId: 'corp-1', csrfToken: 'secret' };
const css = Buffer.from(':root { --brand: #123456; }');
let root, config, icon, context, serial, fetchCss;
const ok = content => ({ success: true, content });
const writes = () => httpPost.mock.calls.filter(([, endpoint]) => endpoint.includes('updateSingleConfig'));
const serve = async (_base, endpoint, body) => {
  const { key, value } = Object.fromEntries(new URLSearchParams(body));
  if (endpoint.includes('getSingleConfig')) { return ok(config[key] ?? null); }
  config[key] = value;
  return ok(true);
};
const take = async () => snapshot({ appType: 'APP_1', outputDir: path.join(root, 'snap-' + serial++) }, auth, fetchCss);
const pair = async (mutate = () => { config.NAV_THEME = 'dark'; }) => {
  const before = await take();
  mutate();
  const after = await take();
  return { appType: 'APP_1', snapshot: before.snapshot, expectedCurrent: after.snapshot,
    outputDir: path.join(root, 'restore-' + serial++) };
};

beforeEach(() => {
  jest.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-theme-'));
  serial = 0;
  config = Object.fromEntries(KEYS.map(key => [key, null]));
  Object.assign(config, { COLOUR: 'custom', THEME_COLOR: '#123456', NAV_THEME: 'light',
    LAY_OUT_DIRECTION: 'ver', NAVTYPE: 'top_side', APP_THEME_MODE: 'legacy', CREATED_WITH_MODERN_THEME: null,
    CUSTOM_THEME_STYLE: JSON.stringify({ cssUrl: 'https://cdn.example/theme.css', cssFileName: 'original.css',
      enabled: false, iframePropagation: false }) });
  icon = 'app%%#123456';
  context = { appType: 'APP_1', corpId: 'corp-1', appThemeEnable: 'n', appThemeMode: 'legacy' };
  fetchCss = jest.fn().mockResolvedValue(css);
  httpGet.mockReset().mockImplementation(async (_base, endpoint) => endpoint.endsWith('/admin')
    ? `<script>window.pageConfig = ${JSON.stringify(context)};</script>` : ok({ icon }));
  httpPost.mockReset().mockImplementation(serve);
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

test('snapshots raw old theme, disabled CSS bytes, missing/empty distinctions and no credentials', async () => {
  const writeFile = jest.spyOn(fs, 'writeFileSync');
  config.HOMEPAGELOGO = '';
  const result = await take();
  const doc = loadSnapshot(result.snapshot);
  expect(doc.state.config).toMatchObject({ LAY_OUT_DIRECTION: 'ver', HOMEPAGELOGO: '', LOGO_SOURCE: null });
  expect(doc.state.protected).toMatchObject({ icon, appThemeMode: 'legacy' });
  expect(fs.readFileSync(path.join(path.dirname(result.snapshot), 'theme.css'))).toEqual(css);
  expect(result).toMatchObject({ runtimeVerified: false, supportsIconRestore: false, supportsPageRestore: false });
  expect(result.cannotClearKeys).toContain('HOMEPAGELOGO');
  expect(fs.readFileSync(result.snapshot, 'utf8')).not.toContain('secret');
  expect(writeFile).toHaveBeenCalledWith(result.snapshot, expect.any(String), { mode: 0o600, flag: 'wx' });
  // Windows stat mode does not represent POSIX owner/group permissions.
  // Check the requested creation mode everywhere and actual bits on POSIX.
  if (process.platform !== 'win32') {
    expect(fs.statSync(result.snapshot).mode & 0o777).toBe(0o600);
  }
  expect(writes()).toHaveLength(0);
});

test('never overwrites an existing backup directory', async () => {
  const result = await take();
  await expect(snapshot({ appType: 'APP_1', outputDir: path.dirname(result.snapshot) }, auth)).rejects.toMatchObject({ code: 'APP_THEME_OUTPUT_EXISTS' });
  expect(loadSnapshot(result.snapshot)).toBeDefined();
});

test('default restore only checks; confirmed restore writes only the changed key and preserves legacy mode and business config', async () => {
  config.BUSINESS_RULE = 'untouched';
  const params = await pair();
  await expect(restore(params, auth, fetchCss)).resolves.toMatchObject({ canRestore: true, checkOnly: true, changes: ['NAV_THEME'] });
  expect(writes()).toHaveLength(0);
  const result = await restore({ ...params, confirm: true }, auth, fetchCss);
  expect(result).toMatchObject({ verified: true, runtimeVerified: false, changed: true });
  expect(config).toMatchObject({ NAV_THEME: 'light', APP_THEME_MODE: 'legacy', BUSINESS_RULE: 'untouched' });
  expect(writes()).toHaveLength(1);
  expect(Object.fromEntries(new URLSearchParams(writes()[0][2]))).toEqual({ appType: 'APP_1', key: 'NAV_THEME', value: 'light', _csrf_token: 'secret' });
  expect(JSON.parse(fs.readFileSync(result.journal))).toMatchObject({ status: 'restored', verifiedWrites: ['NAV_THEME'] });
});

test('restores original CSS URL, filename and boolean flags exactly, without uploading', async () => {
  const original = config.CUSTOM_THEME_STYLE;
  const params = await pair(() => { config.CUSTOM_THEME_STYLE = JSON.stringify({ cssUrl: 'https://cdn.example/new.css', cssFileName: 'new.css', enabled: true, iframePropagation: true }); });
  await restore({ ...params, confirm: true }, auth, fetchCss);
  expect(config.CUSTOM_THEME_STYLE).toBe(original);
  expect(fetchCss).toHaveBeenLastCalledWith('https://cdn.example/theme.css');
  expect(writes().map(call => new URLSearchParams(call[2]).get('key'))).toEqual(['CUSTOM_THEME_STYLE']);
});

test.each([null, ''])('refuses to pretend an absent/empty original %j can be restored', async original => {
  config.CUSTOM_THEME_STYLE = original;
  const params = await pair(() => { config.CUSTOM_THEME_STYLE = JSON.stringify({ enabled: false }); });
  await expect(restore(params, auth, fetchCss)).resolves.toMatchObject({ canRestore: false,
    blockers: [{ key: 'CUSTOM_THEME_STYLE', reason: 'cannot_restore_absent_or_empty_value' }] });
  await expect(restore({ ...params, confirm: true }, auth, fetchCss)).rejects.toMatchObject({ code: 'APP_THEME_RESTORE_BLOCKED' });
  expect(writes()).toHaveLength(0);
});

test.each(['icon', 'mode'])('blocks unsupported protected %s changes before any restore writes', async field => {
  const params = await pair(() => { if (field === 'icon') { icon = 'new%%#999999'; } else { config.APP_THEME_MODE = 'modern'; context.appThemeMode = 'modern'; } });
  await expect(restore({ ...params, confirm: true }, auth, fetchCss)).rejects.toMatchObject({ code: 'APP_THEME_RESTORE_BLOCKED' });
  expect(writes()).toHaveLength(0);
});

test.each(['corpId', 'baseUrl', 'appType'])('blocks different target %s', async field => {
  const params = await pair();
  const targetAuth = { ...auth, ...(field === 'appType' ? {} : { [field]: field === 'baseUrl' ? 'https://other.example' : 'corp-other' }) };
  await expect(restore({ ...params, appType: field === 'appType' ? 'APP_OTHER' : 'APP_1', confirm: true }, targetAuth, fetchCss))
    .rejects.toMatchObject({ code: 'APP_THEME_IDENTITY_INVALID' });
  expect(writes()).toHaveLength(0);
});

test('current-state conflict cannot be bypassed by confirmation', async () => {
  const params = await pair();
  config.THEME_COLOR = '#ffffff';
  await expect(restore({ ...params, confirm: true }, auth, fetchCss)).rejects.toMatchObject({ code: 'APP_THEME_CONFLICT' });
  expect(writes()).toHaveLength(0);
});

test('detects concurrent change during snapshot collection', async () => {
  fetchCss.mockImplementation(async () => { config.NAV_THEME = 'dark'; return css; });
  await expect(take()).rejects.toMatchObject({ code: 'APP_THEME_CONFLICT' });
  expect(fs.existsSync(path.join(root, 'snap-0/snapshot.json'))).toBe(false);
});

test.each(['snapshot.json', 'theme.css'])('detects damaged backup %s before remote writes', async filename => {
  const params = await pair();
  fs.appendFileSync(path.join(path.dirname(params.snapshot), filename), 'damaged');
  await expect(restore({ ...params, confirm: true }, auth, fetchCss)).rejects.toMatchObject({ code: 'APP_THEME_SNAPSHOT_INVALID' });
  expect(writes()).toHaveLength(0);
});

test.each(['changed', 'unavailable'])('blocks %s original CSS without substituting/reuploading it', async failure => {
  const params = await pair(() => { config.CUSTOM_THEME_STYLE = JSON.stringify({ enabled: false }); });
  if (failure === 'changed') { fetchCss.mockResolvedValue(Buffer.from('different')); }
  else { fetchCss.mockRejectedValue(new Error('gone')); }
  await expect(restore(params, auth, fetchCss)).resolves.toMatchObject({ canRestore: false,
    blockers: [{ reason: 'original_css_unavailable_or_changed' }] });
  expect(writes()).toHaveLength(0);
});

test('records partial/unknown writes, reads back actual state and does not retry', async () => {
  const params = await pair(() => { config.COLOUR = 'red'; config.NAV_THEME = 'dark'; });
  httpPost.mockImplementation(async (base, endpoint, body) => {
    const key = new URLSearchParams(body).get('key');
    const result = await serve(base, endpoint, body);
    if (endpoint.includes('updateSingleConfig') && key === 'NAV_THEME') { throw new Error('network disconnected after write'); }
    return result;
  });
  await expect(restore({ ...params, confirm: true }, auth, fetchCss)).rejects.toMatchObject({ code: 'APP_THEME_RESTORE_INCOMPLETE' });
  const journal = JSON.parse(fs.readFileSync(path.join(params.outputDir, 'restore.json')));
  expect(journal).toMatchObject({ status: 'failed_or_unknown', verifiedWrites: ['COLOUR'], attemptedKey: 'NAV_THEME', observedState: { config: { COLOUR: 'custom', NAV_THEME: 'light' } } });
  expect(writes()).toHaveLength(2);
});

test('failed readback is not reported as restore success', async () => {
  const params = await pair();
  httpPost.mockImplementation((base, endpoint, body) => endpoint.includes('updateSingleConfig') ? ok(true) : serve(base, endpoint, body));
  await expect(restore({ ...params, confirm: true }, auth, fetchCss)).rejects.toMatchObject({ code: 'APP_THEME_RESTORE_INCOMPLETE' });
  expect(JSON.parse(fs.readFileSync(path.join(params.outputDir, 'restore.json'))).verifiedWrites).toEqual([]);
});

test('detects another edit between preflight and the first write', async () => {
  const params = await pair();
  let reads = 0;
  httpPost.mockImplementation(async (base, endpoint, body) => {
    const result = await serve(base, endpoint, body);
    if (endpoint.includes('getSingleConfig') && new URLSearchParams(body).get('key') === 'CREATED_WITH_MODERN_THEME' && ++reads === 1) {
      config.NAV_THEME = 'someone-else';
    }
    return result;
  });
  await expect(restore({ ...params, confirm: true }, auth, fetchCss)).rejects.toMatchObject({ code: 'APP_THEME_RESTORE_INCOMPLETE' });
  expect(writes()).toHaveLength(0);
  expect(config.NAV_THEME).toBe('someone-else');
});

test('an API read failure is not recorded as a missing original value', async () => {
  httpPost.mockResolvedValue({ success: false, content: null });
  await expect(take()).rejects.toMatchObject({ code: 'APP_THEME_READ_FAILED' });
  expect(fs.existsSync(path.join(root, 'snap-0/snapshot.json'))).toBe(false);
});

test('rejects an admin response for a different organization before reading config', async () => {
  context.corpId = 'other';
  await expect(take()).rejects.toMatchObject({ code: 'APP_THEME_IDENTITY_INVALID' });
  expect(httpPost).not.toHaveBeenCalled();
});

test.each([false, true])('handles modern theme without migrating it; modern=%s', async modern => {
  if (modern) { context.appThemeMode = 'modern'; context.appThemeEnable = 'y'; config.APP_THEME_MODE = 'modern'; }
  const params = await pair();
  await restore({ ...params, confirm: true }, auth, fetchCss);
  expect(writes().every(call => new URLSearchParams(call[2]).get('key') === 'NAV_THEME')).toBe(true);
  expect(config.APP_THEME_MODE).toBe(modern ? 'modern' : 'legacy');
});

test('no-op restore does not write platform config', async () => {
  const params = await pair(() => {});
  await expect(restore({ ...params, confirm: true }, auth, fetchCss)).resolves.toMatchObject({ verified: true, changed: false });
  expect(writes()).toHaveLength(0);
});

test.each([
  [], ['snapshot', '../APP', '--output-dir', 'x'], ['snapshot', 'APP_1'],
  ['snapshot', 'APP_1', '--output-dir', 'x', '--confirm'],
  ['restore', 'APP_1', '--snapshot', 'a', '--expected-current', 'b', '--confirm'],
  ['restore', 'APP_1', '--snapshot', 'a', '--expected-current', 'b', '--check', '--confirm', '--output-dir', 'x'],
  ['snapshot', 'APP_1', '--output-dir', 'x', '--force'],
].map(args => ({ args })))('rejects invalid command $args', ({ args }) => {
  expect(() => parseArgs(args)).toThrow();
});

test('manifest distinguishes snapshot reads from confirmed restore writes', () => {
  const commands = buildCommandManifest().commands;
  expect(commands.find(c => c.id === 'app-theme.snapshot').side_effect).toMatchObject({ mutates_yida: false, mutates_local: true });
  expect(commands.find(c => c.id === 'app-theme.restore').side_effect).toMatchObject({ mutates_yida: true });
});

test.each(['http://cdn.example/a.css', 'https://user:password@cdn.example/a.css', 'file:///tmp/a.css'])('rejects unsafe CSS URL %s before network', async url => {
  await expect(downloadCss(url)).rejects.toThrow();
});

test.each([
  { status: 200, type: 'text/css; charset=utf-8', body: 'body { color: red; }', valid: true },
  { status: 302, type: 'text/css', body: '', valid: false },
  { status: 200, type: 'text/html', body: '<html>login</html>', valid: false },
  { status: 200, type: 'text/css', body: '<html>login</html>', valid: false },
])('CSS fetch requires a direct CSS response: $status $type $valid', async ({ status, type, body, valid }) => {
  const { EventEmitter } = require('events');
  const request = new EventEmitter();
  request.setTimeout = jest.fn();
  request.destroy = error => request.emit('error', error);
  const response = new EventEmitter();
  response.statusCode = status;
  response.headers = { 'content-type': type };
  response.resume = jest.fn();
  const get = jest.spyOn(require('https'), 'get').mockImplementation((_url, options, callback) => {
    expect(options.headers).toEqual({ Accept: 'text/css' });
    queueMicrotask(() => { callback(response); response.emit('data', Buffer.from(body)); response.emit('end'); });
    return request;
  });
  try {
    const result = downloadCss('https://cdn.example/theme.css');
    if (valid) { await expect(result).resolves.toEqual(Buffer.from(body)); }
    else { await expect(result).rejects.toThrow(); }
    expect(get).toHaveBeenCalledTimes(1); // Redirects never forward credentials or issue another request.
  } finally { get.mockRestore(); }
});
