'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execute, parseArgs, validateSchema, schemaHash } = require('../lib/app/data-card');
const settings = require('../lib/app/app-settings');
const { buildApplicationSettingsUrls } = require('../lib/app/application-entry-urls');
const { resolveManagedPolicy } = require('../lib/core/managed-policy');

let dir, client, draft, published;
const clone = value => JSON.parse(JSON.stringify(value));
const initial = () => ({ i18nData: [], pages: [{ componentsTree: [{ componentName: 'Page', id: 'page', children: [
  { componentName: 'RootContent', id: 'root', children: [] },
] }], dataSource: { online: [], offline: [] } }], config: { unknownSetting: { keep: true } } });
const args = (action, flags = []) => parseArgs([action, 'APP_TEST', ...(['list', 'create'].includes(action) ? [] : ['CARD-abc']), ...flags]);
function save(schema, hash = schemaHash(draft)) {
  const filename = path.join(dir, 'edited.json');
  fs.writeFileSync(filename, JSON.stringify(schema));
  return args('save', ['--schema', filename, '--expected-hash', hash, '--backup', path.join(dir, 'before.json')]);
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-card-'));
  draft = initial(); published = null;
  client = {
    getAuthRef: () => ({ baseUrl: 'https://tenant.aliwork.com' }),
    get: jest.fn(async (endpoint, params) => {
      if (endpoint.includes('getAppIncludingAecpInfo')) { return { success: true, content: { appType: 'APP_TEST' } }; }
      if (endpoint.includes('listCardInfo')) { return { success: true, content: { data: [{ cardCode: 'CARD-abc' }], totalCount: 51, currentPage: params.currentPage } }; }
      return { success: true, content: { cardCode: 'CARD-abc', schemaBody: clone(params.draft ? draft : published), status: published ? 'PUBLISHED' : 'UNPUBLISHED', version: published ? '1' : '0' } };
    }),
    postFormOnce: jest.fn(async (endpoint, params) => {
      if (endpoint.includes('createCard')) { return { success: true, content: 'CARD-abc' }; }
      if (endpoint.includes('updateCard')) { draft = JSON.parse(params.schemaBody); }
      if (endpoint.includes('publishCard')) { published = clone(draft); return { success: true, content: '1' }; }
      return { success: true, content: true };
    }),
  };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('reads and exports the platform initial schema without invented schemaType/version', async () => {
  const out = path.join(dir, 'schema.json');
  const result = await execute(args('get', ['--out', out]), client);
  expect(result.card.schemaBody).toEqual(initial());
  expect(JSON.parse(fs.readFileSync(out))).toEqual(initial());
  expect(result.urls.designerUrl).toContain('APP_TEST/report/dataCardDesigner.html?cardCode=CARD-abc');
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('preserves native action constructors as data without rejecting a designer export', () => {
  const schema = initial();
  schema.actions = { module: { source: { constructor: { type: 'JSFunction', value: 'function() {}' } } } };
  expect(validateSchema(schema)).toBe(schema);
});
test.each([
  ['explicit Chinese', { OPENYIDA_CONTENT_LOCALE: 'zh_CN' }, 'zh_CN'],
  ['explicit English', { OPENYIDA_CONTENT_LOCALE: 'en_US' }, 'en_US'],
  ['explicit Japanese', { OPENYIDA_CONTENT_LOCALE: 'ja_JP' }, 'ja_JP'],
  ['English system locale', { LANG: 'en_US.UTF-8' }, 'en_US'],
])('creates a native resource once with the selected content locale: %s', async (_name, environment, locale) => {
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    OPENYIDA_CONTENT_LOCALE: '', YIDA_CONTENT_LOCALE: '', OPENYIDA_APP_LOCALE: '',
    OPENYIDA_LANG: '', LC_ALL: '', LANG: '', ...environment,
  };
  try {
    const result = await execute(args('create', ['--name', '销售', '--description', '业务统计']), client);
    expect(result.cardCode).toBe('CARD-abc');
    const [endpoint, body] = client.postFormOnce.mock.calls[0];
    expect(endpoint).toBe('/APP_TEST/visual/dataCardRpc/createCard.json');
    expect(JSON.parse(body.cardName)).toEqual({ type: 'i18n', [locale]: '销售' });
    expect(JSON.parse(body.description)).toEqual({ type: 'i18n', [locale]: '业务统计' });
    expect(client.postFormOnce).toHaveBeenCalledTimes(1);
  } finally {
    process.env = originalEnv;
  }
});
test('a failed creation readback retains the created card ID for recovery', async () => {
  client.get.mockRejectedValue(new Error('read timeout'));
  await expect(execute(args('create', ['--name', 'test']), client)).rejects.toMatchObject({ details: { cardCode: 'CARD-abc', resourceCreated: true } });
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});
test('creation does not overwrite an existing export or retry a failed write', async () => {
  const file = path.join(dir, 'exists.json'); fs.writeFileSync(file, '{}');
  await expect(execute(args('create', ['--name', 'test', '--out', file]), client)).rejects.toMatchObject({ code: 'DATA_CARD_OUTPUT_EXISTS' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
  client.postFormOnce.mockRejectedValueOnce(new Error('timeout'));
  await expect(execute(args('create', ['--name', 'test']), client)).rejects.toThrow('timeout');
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});
test('listing preserves server pagination and onlyPublished filters', async () => {
  const result = await execute(args('list', ['--published', '--page', '2', '--search', '销售']), client);
  expect(result.totalCount).toBe(51);
  expect(client.get.mock.calls[0][1]).toEqual({ pageSize: 50, currentPage: 2, onlyPublished: true, searchKey: '销售' });
});
test('a specified historical version reads the online version axis rather than the draft', async () => {
  published = initial();
  const result = await execute(args('get', ['--version', '1']), client);
  expect(result.draft).toBe(false);
  expect(client.get.mock.calls[0][1]).toEqual({ cardCode: 'CARD-abc', draft: false, version: '1' });
});
test('saves a full draft, backs up the original and never publishes implicitly', async () => {
  const edited = clone(draft);
  edited.config.unknownSetting.keep = false;
  const result = await execute(save(edited), client);
  expect(result.readbackVerified).toBe(true);
  expect(result.published).toBe(false);
  expect(result.card.schemaBody).toEqual(edited);
  expect(JSON.parse(fs.readFileSync(result.backupPath)).card.schemaBody).toEqual(initial());
  expect(published).toBeNull();
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});
function indicatorConfig(overrides = {}) {
  return { indicators: [{ title: '报名统计', formUuid: 'FORM-source', fieldId: 'serialNumberField_real', aggregate: 'COUNT', label: '报名总数', ...overrides }] };
}
function setupIndicatorSource(config = indicatorConfig(), componentName = 'SerialNumberField') {
  draft.pages[0].componentsTree[0].children[0].props = { rglSwitch: true };
  const filename = path.join(dir, 'indicators.json');
  fs.writeFileSync(filename, JSON.stringify(config));
  const original = client.get.getMockImplementation();
  client.getAuthRef = () => ({ baseUrl: 'https://tenant.aliwork.com', corpId: 'ding-real' });
  client.get.mockImplementation(async (endpoint, params) => endpoint.includes('getFormSchema')
    ? { success: true, content: JSON.stringify({ pages: [{ componentsTree: [{ componentName: 'Page', children: [
      { componentName, props: { fieldId: 'serialNumberField_real' } },
    ] }] }] }) } : original(endpoint, params));
  return args('save', ['--config', filename, '--expected-hash', schemaHash(draft), '--backup', path.join(dir, 'before.json')]);
}
test('builds and saves a native indicator from simple config and live source metadata, preserving the platform skeleton', async () => {
  const parsed = setupIndicatorSource();
  const result = await execute(parsed, client);
  const page = result.card.schemaBody.pages[0];
  const content = page.componentsTree[0].children[0];
  const indicator = content.children[0];
  expect(result.published).toBe(false);
  expect(result.card.schemaBody.config.unknownSetting.keep).toBe(true);
  expect(page.componentsMap.map(entry => entry.componentName)).toContain('YoushuSimpleIndicatorCard');
  expect(indicator.componentName).toBe('YoushuSimpleIndicatorCard');
  expect(indicator.props.dataSetModelMap.youshuData.dataViewQueryModel).toMatchObject({
    cubeCode: 'FORM_source', cubeTenantId: 'ding-real',
    fieldDefinitionList: [expect.objectContaining({ fieldCode: 'serialNumberField_real', dataType: 'STRING', aggregateType: 'COUNT' })],
  });
  expect(content.props.layout[0]).toMatchObject({ i: indicator.props.fieldId, x: 0, y: 0, w: 3, h: 11 });
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});
test('appends indicators after existing components and keeps their data bindings and layouts', async () => {
  const parsed = setupIndicatorSource();
  const content = draft.pages[0].componentsTree[0].children[0];
  content.children.push({ componentName: 'YoushuSimpleIndicatorCard', id: 'existing', props: { fieldId: 'existingField', custom: true } });
  content.props.layout = [{ i: 'existingField', x: 0, y: 0, w: 3, h: 11 }];
  parsed.flags['--expected-hash'] = schemaHash(draft);
  const result = await execute(parsed, client);
  const after = result.card.schemaBody.pages[0].componentsTree[0].children[0];
  expect(after.children[0].props.custom).toBe(true);
  expect(after.props.layout[1].y).toBe(11);
});
test.each([
  [{ fieldId: 'invented' }, 'SerialNumberField', 'DATA_CARD_SOURCE_FIELD_NOT_FOUND'],
  [{ aggregate: 'SUM' }, 'SerialNumberField', 'DATA_CARD_INVALID_CONFIG'],
  [{ aggregate: 'COUNT' }, 'EmployeeField', 'DATA_CARD_INVALID_CONFIG'],
  [{ appTag: 'override' }, 'SerialNumberField', 'DATA_CARD_INVALID_CONFIG'],
])('rejects unverified/unsupported indicator inputs without remote writes %j', async (overrides, component, code) => {
  const parsed = setupIndicatorSource(indicatorConfig(overrides), component);
  await expect(execute(parsed, client)).rejects.toMatchObject({ code });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('source permission or entitlement denial stops config generation with the platform code', async () => {
  const parsed = setupIndicatorSource();
  const original = client.get.getMockImplementation();
  client.get.mockImplementation(async (...a) => a[0].includes('getFormSchema')
    ? { success: false, errorCode: 'EDGE_990412', errorMsg: '请升级宜搭权益' } : original(...a));
  await expect(execute(parsed, client)).rejects.toMatchObject({ details: { platformErrorCode: 'EDGE_990412' } });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('stale hashes and changes during preflight both prevent writing', async () => {
  await expect(execute(save(draft, '0'.repeat(64)), client)).rejects.toMatchObject({ code: 'DATA_CARD_CONFLICT' });
  const original = client.get.getMockImplementation();
  let reads = 0;
  client.get.mockImplementation(async (...a) => {
    if (++reads === 2) { draft.config.concurrent = true; }
    return original(...a);
  });
  await expect(execute(save(initial()), client)).rejects.toMatchObject({ code: 'DATA_CARD_CONFLICT' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('rejects malformed schema and duplicate identifiers without writing', async () => {
  const schema = initial(); schema.pages[0].componentsTree[0].children[0].id = 'page';
  expect(() => validateSchema(schema)).toThrow();
  await expect(execute(save({ componentsTree: [] }), client)).rejects.toMatchObject({ code: 'DATA_CARD_INVALID_SCHEMA' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('detects false success where readback retains the old schema', async () => {
  client.postFormOnce.mockResolvedValue({ success: true, content: true });
  const edited = initial(); edited.config.added = true;
  await expect(execute(save(edited), client)).rejects.toMatchObject({ code: 'DATA_CARD_READBACK_MISMATCH' });
});
test.each([{ success: false, errorCode: 'EDGE_990412', errorMsg: 'quota' }, { success: true, __needLogin: true, content: {} }])('rejects business or login failure %j', async response => {
  client.get.mockResolvedValue(response);
  await expect(execute(args('get'), client)).rejects.toMatchObject({ code: 'DATA_CARD_API_ERROR' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('refuses a mismatched returned card identity', async () => {
  client.get.mockResolvedValue({ success: true, content: { cardCode: 'CARD-other', schemaBody: initial() } });
  await expect(execute(args('get'), client)).rejects.toMatchObject({ code: 'DATA_CARD_TARGET_MISMATCH' });
});
test('publishes the existing draft separately and verifies online schema and version', async () => {
  const result = await execute(args('publish', ['--expected-hash', schemaHash(draft), '--backup', path.join(dir, 'before.json')]), client);
  expect(result).toMatchObject({ published: true, readbackVerified: true, version: '1' });
  expect(client.postFormOnce.mock.calls.map(c => c[0])).toEqual(['/APP_TEST/visual/dataCardRpc/publishCard.json']);
});
test('publication must not report success for stale online data', async () => {
  published = initial(); published.config.stale = true;
  client.postFormOnce.mockResolvedValue({ success: true, content: '1' });
  await expect(execute(args('publish', ['--expected-hash', schemaHash(draft), '--backup', path.join(dir, 'before.json')]), client)).rejects.toMatchObject({ code: 'DATA_CARD_READBACK_MISMATCH' });
});
test('updates changed dataCard i18n bindings before the draft, preserving unknown config', async () => {
  const edited = initial();
  edited.pages[0].componentsTree[0].props = { title: { type: 'i18n', key: 'real-key', zh_CN: '标题' } };
  const result = await execute(save(edited), client);
  expect(client.postFormOnce.mock.calls[0]).toEqual(['/APP_TEST/query/appI18n/updateI18nBinding.json', { targetType: 'dataCard', catalog1: 'CARD-abc', i18nKeyList: 'real-key' }]);
  expect(result.card.schemaBody.config).toEqual({ unknownSetting: { keep: true }, i18nKeyList: ['real-key'] });
});
test.each([
  ['create', 'APP_TEST', '--name', 'x', '--published'], ['get', 'APP_TEST', 'CARD-a', '--schema', 'x'],
  ['save', 'APP_TEST', 'CARD-a', '--schema', 'x'], ['publish', 'APP_TEST', 'CARD-a'],
  ['list', 'APP_TEST', '--size', '101'], ['get', 'APP_TEST/other', 'CARD-a'],
  ['get', 'APP_TEST', 'FORM-a'], ['get', 'APP_TEST', 'CARD-a', '--published', '--version', '1'],
  ['save', 'APP_TEST', 'CARD-a', '--schema', 'x', '--config', 'y', '--expected-hash', '0'.repeat(64)],
])('rejects ambiguous/invalid arguments %j', argv => expect(() => parseArgs(argv)).toThrow());

test('settings resolve the requested tenant entry without carrying credentials', async () => {
  const links = buildApplicationSettingsUrls({ appType: 'APP_TEST', baseUrl: 'https://base.test', systemLink: 'https://tenant.test/APP_TEST/workbench?token=secret&locale=zh_CN' });
  expect(links.themeSettingsUrl).toBe('https://tenant.test/APP_TEST/admin/appSetting/themeSetting?locale=zh_CN');
  const result = await settings.execute(settings.parseArgs(['APP_TEST', '--section', 'data-card', '--json']), client);
  expect(result.url).toBe('https://tenant.aliwork.com/APP_TEST/admin/appSetting/dataCardManage');
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('managed policies bind every action to its app and reject unknown subcommands', () => {
  for (const action of ['get', 'list', 'probe', 'create', 'save', 'publish']) {
    const resolved = resolveManagedPolicy('data-card', [action, 'APP_TEST', 'CARD-a']);
    expect(resolved.policy.appPosition).toBe(1);
    expect(!!resolved.policy.mutation).toBe(['create', 'save', 'publish'].includes(action));
  }
  expect(resolveManagedPolicy('data-card', ['delete', 'APP_TEST', 'CARD-a'])).toBeNull();
});
test('probe uses native CARD runtime queries and returns actual component data without saving', async () => {
  draft.pages[0].componentsTree[0].children.push({ componentName: 'YoushuSimpleIndicatorCard', id: 'indicator',
    props: { cid: 'indicator', dataSetModelMap: { youshuData: {} } } });
  client.postFormOnce.mockResolvedValue({ success: true, content: { data: [{ n: 24 }], meta: [{ alias: 'n' }] } });
  const result = await execute(args('probe'), client);
  expect(result.runtimeQueryVerified).toBe(true);
  expect(result.probes[0].data.data[0].n).toBe(24);
  expect(client.postFormOnce.mock.calls[0][1]).toMatchObject({ visualType: 'CARD', prdId: 'CARD-abc', cid: 'indicator', draft: true, enabledCache: false });
  expect(client.postFormOnce.mock.calls[0][0]).toContain('visualizationDataRpc/getDataAsync');
});
test.each([{ success: true, content: {} }, { success: false, errorCode: 'EDGE_DENIED', errorMsg: 'denied' }])('probe rejects false query success and preserves failures %j', async response => {
  draft.pages[0].componentsTree[0].children.push({ componentName: 'YoushuTable', id: 'table', props: { cid: 'table', dataSetModelMap: { table: {} } } });
  client.postFormOnce.mockResolvedValue(response);
  await expect(execute(args('probe'), client)).rejects.toMatchObject({ code: 'DATA_CARD_RUNTIME_QUERY_FAILED', details: {
    probes: [expect.objectContaining({ componentName: 'YoushuTable', success: false })],
  } });
});
