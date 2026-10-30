'use strict';

jest.mock('../lib/core/yida-client', () => ({
  createAuthRef: jest.fn(() => ({ baseUrl: 'https://tenant.example.com' })),
  createYidaClient: jest.fn(),
  unwrapYidaResponse: jest.fn((response) => {
    if (response.success === false) { throw new Error(response.errorMsg); }
    return response.content;
  }),
}));
const { createAuthRef, createYidaClient } = require('../lib/core/yida-client');
jest.mock('../lib/app/form-navigation', () => ({ fetchFormPageList: jest.fn() }));
jest.mock('../lib/app/get-form-config', () => ({ fetchFormSchemaInfo: jest.fn() }));
const { fetchFormSchemaInfo } = require('../lib/app/get-form-config');
const { fetchFormPageList } = require('../lib/app/form-navigation');
const { run, parseArgs, normalizeUrl } = require('../lib/app/app-entry');
const origin = 'https://tenant.example.com';
const response = (accessEntries, revision = 'v1') => ({ success: true, content: { accessEntries, revision } });
let client;
beforeEach(() => {
  jest.clearAllMocks();
  fetchFormSchemaInfo.mockResolvedValue({ success: true, content: { formType: 'display', renderNav: false } });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  client = { get: jest.fn(), postForm: jest.fn().mockResolvedValue(response({})) };
  createYidaClient.mockReturnValue(client);
});
afterEach(() => jest.restoreAllMocks());

test.each([
  `${origin}/APP_TEST/custom/FORM`, `${origin}/APP_TEST/workbench`, `${origin}/APP_TEST/manage/FORM`,
  `${origin}/APP_TEST/workbench/FORM?viewUuid=VIEW&corpid=ding123&hideLeftNav=true#tab`,
  `${origin}/APP_TEST/workbench?corpid=ding123&locale=zh_CN`,
  `${origin}/APP_TEST/submission/FORM?processCode=PROC&noShowTopBottom=true`,
  `${origin}/o/public-alias`, `${origin}/o/public-alias/FORM-123`, `${origin}/s/app-alias`,
  'https://enterprise.example.com/o/public',
])('keeps complete runtime URL %s', (input) => {
  expect(normalizeUrl(input, 'APP_TEST')).toBe(input);
});
test.each([
  '', '/APP_TEST/custom/FORM', '//tenant.example.com/APP_TEST/custom/FORM',
  `${origin}/OTHER/custom/FORM`, `${origin}/APP_TEST/admin`, `${origin}/APP_TEST/custom/../admin`,
  `${origin}/APP_TEST/custom/%2e%2e`, `${origin}/APP_TEST/custom/FORM?token=secret`,
  `${origin}/APP_TEST/workbench/FORM?viewUuid=X&token=secret`, `${origin}/APP_TEST/custom/FORM#<script>`,
  `${origin}/APP_TEST/custom/FORM\\x`, `${origin}/APP_TEST/custom/FORM\nsecret`, `${origin}/APP_TEST/workbench?`, `${origin}/APP_TEST/workbench#`,
  `${origin}/s/alias/extra`, `${origin}/o/alias?formUuid=OTHER`, `${origin}/o/alias?corpid=a&corpid=b`,
  `${origin}/o/alias?hideLeftNav=invalid`, 'https://user:pass@tenant.example.com/o/alias',
  'javascript:alert(1)', 'ftp://tenant.example.com/o/alias',
])('rejects relative or unsafe address %s', (input) => {
  expect(() => normalizeUrl(input, 'APP_TEST')).toThrow();
});
test.each([
  ['set', 'APP_TEST'], ['get', '../APP_TEST'], ['set', 'APP_TEST', '--frontend'],
  ['set', 'APP_TEST', '--frontend', '--management'], ['get', 'APP_TEST', '--clear-frontend'],
  ['set', 'APP_TEST', '--frontend', '/APP_TEST/custom/F', '--clear-frontend'],
  ['set', 'APP_TEST', '--frontend', 'x', '--frontend-page', 'FORM-A'],
  ['set', 'APP_TEST', '--clear-frontend-page'], ['set', 'APP_TEST', '--management-page'],
])('rejects ambiguous arguments %j', (...args) => expect(() => parseArgs(args)).toThrow());
test('help does not require authentication', async () => {
  await run(['--help']);
  expect(createAuthRef).not.toHaveBeenCalled();
});
test.each([
  ['frontend', `${origin}/o/public-home`],
  ['management', `${origin}/APP_TEST/workbench`],
])('registers only %s for a new application without inventing the other entry', async (key, url) => {
  const entries = { [key]: { url } };
  client.get.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(entries, 'v2'));
  await run(['set', 'APP_TEST', `--${key}`, url]);
  expect(client.postForm).toHaveBeenCalledWith('/APP_TEST/query/app/saveAccessEntries.json', {
    accessEntries: JSON.stringify(entries), revision: 'v1',
  });
  expect(JSON.parse(console.log.mock.calls[0][0]).urls).toEqual({ [key]: url });
});
test('registers both entries only when both are explicitly supplied', async () => {
  const entries = {
    frontend: { url: `${origin}/o/public-home` },
    management: { url: `${origin}/APP_TEST/manage/FORM` },
  };
  client.get.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(entries, 'v2'));
  await run(['set', 'APP_TEST', '--frontend', entries.frontend.url, '--management', entries.management.url]);
  expect(JSON.parse(client.postForm.mock.calls[0][1].accessEntries)).toEqual(entries);
});
test('an application with no configured entries is returned without invented defaults', async () => {
  client.get.mockResolvedValue(response({}));
  await run(['get', 'APP_TEST']);
  expect(client.postForm).not.toHaveBeenCalled();
  expect(JSON.parse(console.log.mock.calls[0][0]).urls).toEqual({});
});
test('no entry arguments do not trigger authentication or network requests', async () => {
  await expect(run(['set', 'APP_TEST'])).rejects.toThrow();
  expect(createAuthRef).not.toHaveBeenCalled();
  expect(client.get).not.toHaveBeenCalled();
  expect(client.postForm).not.toHaveBeenCalled();
});
test('updates only the supplied entry and uses the read revision', async () => {
  const management = { url: `${origin}/APP_TEST/workbench` };
  client.get.mockResolvedValueOnce(response({ management })).mockResolvedValueOnce(response({
    management, frontend: { url: `${origin}/APP_TEST/custom/FORM` },
  }, 'v2'));
  const result = await run(['set', 'APP_TEST', '--frontend', `${origin}/APP_TEST/custom/FORM`, '--json']);
  expect(client.postForm).toHaveBeenCalledWith('/APP_TEST/query/app/saveAccessEntries.json', {
    accessEntries: JSON.stringify({ frontend: { url: `${origin}/APP_TEST/custom/FORM` } }), revision: 'v1',
  });
  expect(result.accessEntries.management).toEqual(management);
  expect(client.get).toHaveBeenCalledTimes(2);
});
test('clear is explicit and leaves other entries alone', async () => {
  client.get.mockResolvedValueOnce(response({ frontend: { url: `${origin}/APP_TEST/custom/F` } })).mockResolvedValueOnce(response({}, 'v2'));
  await run(['set', 'APP_TEST', '--clear-frontend']);
  expect(JSON.parse(client.postForm.mock.calls[0][1].accessEntries)).toEqual({ frontend: null });
});

test('registers an explicit platform-shell frontend without rewriting backend or page navigation', async () => {
  const frontend = { url: `${origin}/APP_TEST/workbench/FORM_FRONT?viewUuid=VIEW_FRONT#mine` };
  const management = { url: `${origin}/APP_TEST/workbench/FORM_BACK?viewUuid=VIEW_BACK` };
  client.get.mockResolvedValueOnce(response({ management })).mockResolvedValueOnce(response({ frontend, management }, 'v2'));
  const result = await run(['set', 'APP_TEST', '--frontend', frontend.url, '--json']);
  expect(result.urls).toEqual({ frontend: frontend.url, management: management.url });
  expect(result.verification).toEqual({ configurationReadback: true, runtimeVerified: false });
  expect(client.postForm).toHaveBeenCalledTimes(1);
  expect(JSON.parse(client.postForm.mock.calls[0][1].accessEntries)).toEqual({ frontend });
  expect(fetchFormSchemaInfo).not.toHaveBeenCalled();
  expect(fetchFormPageList).not.toHaveBeenCalled();
});
test('conflict does not retry or overwrite', async () => {
  client.get.mockResolvedValue(response({}));
  client.postForm.mockResolvedValue({ success: false, errorMsg: 'conflict' });
  await expect(run(['set', 'APP_TEST', '--management', `${origin}/APP_TEST/workbench`])).rejects.toThrow('conflict');
  expect(client.postForm).toHaveBeenCalledTimes(1);
  expect(client.get).toHaveBeenCalledTimes(1);
});
test('missing revision prevents writes', async () => {
  client.get.mockResolvedValue(response({}, ''));
  await expect(run(['set', 'APP_TEST', '--management', `${origin}/APP_TEST/workbench`])).rejects.toThrow();
  expect(client.postForm).not.toHaveBeenCalled();
});
test('readback mismatch is not reported as success', async () => {
  client.get.mockResolvedValue(response({}));
  await expect(run(['set', 'APP_TEST', '--management', `${origin}/APP_TEST/workbench`])).rejects.toThrow();
  expect(console.log).not.toHaveBeenCalled();
});
test('get is read-only and returns resolved URLs', async () => {
  client.get.mockResolvedValue(response({ management: { url: `${origin}/APP_TEST/workbench` } }));
  await run(['get', 'APP_TEST']);
  expect(client.postForm).not.toHaveBeenCalled();
  expect(JSON.parse(console.log.mock.calls[0][0]).urls.management).toBe(`${origin}/APP_TEST/workbench`);
});

test('keeps the verified enterprise URL even when the API authentication host differs', async () => {
  const url = 'https://enterprise.example.com/o/public?corpid=ding123#home';
  client.get.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ frontend: { url } }, 'v2'));
  await run(['set', 'APP_TEST', '--frontend', url]);
  expect(JSON.parse(client.postForm.mock.calls[0][1].accessEntries)).toEqual({ frontend: { url } });
  expect(JSON.parse(console.log.mock.calls[0][0]).urls.frontend).toBe(url);
});
test('rejects relative input before any request', async () => {
  await expect(run(['set', 'APP_TEST', '--frontend', '/APP_TEST/custom/FORM'])).rejects.toThrow();
  expect(client.get).not.toHaveBeenCalled();
  expect(client.postForm).not.toHaveBeenCalled();
});

test.each([
  `${origin}/APP_TEST/workbench/FORM-XYZ`,
  `${origin}/APP_TEST/workbench/FORM?corpid=ding123#tab`,
  `${origin}/APP_TEST/workbench`,
  `${origin}/APP_TEST/manage/FORM`,
])('preserves the exact management URL through write and readback: %s', url => {
  const entries = { management: { url } };
  client.get.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(entries, 'v2'));
  return run(['set', 'APP_TEST', '--management', url]).then(() => {
    expect(JSON.parse(client.postForm.mock.calls[0][1].accessEntries)).toEqual(entries);
    expect(fetchFormPageList).not.toHaveBeenCalled();
  });
});

test('--frontend-page builds the canonical custom URL for an online page', async () => {
  fetchFormPageList.mockResolvedValue([{ formUuid: 'FORM-A', pathName: 'store', formType: 'display' }]);
  const entries = { frontend: { url: `${origin}/APP_TEST/custom/FORM-A` } };
  client.get.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(entries, 'v2'));
  await run(['set', 'APP_TEST', '--frontend-page', 'FORM-A']);
  expect(fetchFormPageList).toHaveBeenCalledWith('APP_TEST', expect.any(Object));
  expect(JSON.parse(client.postForm.mock.calls[0][1].accessEntries)).toEqual(entries);
});

test('--frontend-page refuses an offline page before any write', async () => {
  fetchFormPageList.mockResolvedValue([{ formUuid: 'FORM-A', pathName: '', formType: 'display' }]);
  await expect(run(['set', 'APP_TEST', '--frontend-page', 'FORM-A'])).rejects.toThrow();
  expect(client.get).not.toHaveBeenCalled();
  expect(client.postForm).not.toHaveBeenCalled();
});

test('--frontend-page rejects a page from another application', async () => {
  fetchFormPageList.mockResolvedValue([{ formUuid: 'FORM-OTHER', pathName: 'x' }]);
  await expect(run(['set', 'APP_TEST', '--frontend-page', 'FORM-A'])).rejects.toThrow();
  expect(client.postForm).not.toHaveBeenCalled();
});

test('--management-page keeps the requested workbench page after verifying ownership', async () => {
  fetchFormPageList.mockResolvedValue([{ formUuid: 'FORM-A', pathName: '', formType: 'receipt' }]);
  const entries = { management: { url: `${origin}/APP_TEST/workbench/FORM-A` } };
  client.get.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(entries, 'v2'));
  await run(['set', 'APP_TEST', '--management-page', 'FORM-A']);
  expect(JSON.parse(client.postForm.mock.calls[0][1].accessEntries)).toEqual(entries);
});

test.each(['receipt', 'process', ''])('--frontend-page refuses non-display type %s before writing', async formType => {
  fetchFormPageList.mockResolvedValue([{ formUuid: 'FORM-A', pathName: 'online', formType }]);
  await expect(run(['set', 'APP_TEST', '--frontend-page', 'FORM-A'])).rejects.toThrow();
  expect(client.postForm).not.toHaveBeenCalled();
});


test.each([
  { renderNav: true }, {}, { renderNav: null, isRenderNav: false },
  { renderNav: 'true', isRenderNav: false }, { renderNav: false, appType: 'APP_OTHER' },
  { renderNav: false, formUuid: 'FORM-OTHER' }, { renderNav: false, formType: 'receipt' },
])('frontend shortcut rejects unverified or mismatched page configuration: %j', config => {
  fetchFormPageList.mockResolvedValue([{ formUuid: 'FORM-A', pathName: 'online', formType: 'display' }]);
  fetchFormSchemaInfo.mockResolvedValue({ success: true, content: config });
  return expect(run(['set', 'APP_TEST', '--frontend-page', 'FORM-A'])).rejects.toThrow().then(() => {
    expect(client.postForm).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
  });
});

test.each([null, { success: false }, { __needLogin: true }, { __csrfExpired: true }])('failed frontend configuration read never writes an entry: %j', response => {
  fetchFormPageList.mockResolvedValue([{ formUuid: 'FORM-A', pathName: 'online', formType: 'display' }]);
  fetchFormSchemaInfo.mockResolvedValue(response);
  return expect(run(['set', 'APP_TEST', '--frontend-page', 'FORM-A'])).rejects.toThrow().then(() => {
    expect(client.postForm).not.toHaveBeenCalled();
  });
});

test('legacy hidden navigation and distinct frontend/backend URLs share one verified output', async () => {
  fetchFormPageList.mockResolvedValue([{ formUuid: 'FORM-A', pathName: 'online', formType: 'display' }]);
  fetchFormSchemaInfo.mockResolvedValue({ success: true, content: { isRenderNav: 'false' } });
  const entries = { frontend: { url: `${origin}/APP_TEST/custom/FORM-A` }, management: { url: `${origin}/APP_TEST/workbench/FORM-B?viewUuid=VIEW-B` } };
  client.get.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(entries, 'v2'));
  const result = await run(['set', 'APP_TEST', '--frontend-page', 'FORM-A', '--management', entries.management.url]);
  expect(result).toEqual(JSON.parse(console.log.mock.calls[0][0]));
  expect(result.urls).toEqual({ frontend: entries.frontend.url, management: entries.management.url });
  expect(result.verification).toEqual({ configurationReadback: true, runtimeVerified: false });
  expect(JSON.parse(client.postForm.mock.calls[0][1].accessEntries)).toEqual(entries);
});
