'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execute, parseArgs, normalize, configHash } = require('../lib/app/custom-button');

let dir, backupPath, buttons, client, metadata;
const clone = value => JSON.parse(JSON.stringify(value));
const args = (action, extra = []) => parseArgs([action, 'APP_TEST', 'FORM_TEST', ...extra, '--json']);
function file(value) {
  const filename = path.join(dir, 'config.json');
  fs.writeFileSync(filename, JSON.stringify(value));
  return filename;
}
function mutation(action, patch, extra = []) {
  return args(action, [...(action === 'update' ? ['BUTTON_A'] : []), '--config', file(patch), '--backup', backupPath, ...extra]);
}
function record(id = 'BUTTON_A') {
  return { buttonUuid: id, formUuid: 'FORM_TEST', name: { type: 'i18n', zh_CN: '分配', en_US: 'Assign' },
    description: { zh_CN: '修改负责人' }, icon: { type: 'icon', value: 'icon_diagonal_outlined' },
    actionType: 'fillInForm', actionConfig: { fillType: 'fillCurrentForm', fieldsSelected: ['owner'], futureOption: false },
    permissionConfig: null, tableViewUuids: ['VIEW_A'], detailId: ['DETAIL_A'], creatorName: 'Admin' };
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-button-test-'));
  backupPath = path.join(dir, 'before.json'); buttons = [record()];
  metadata = {
    'formdesign/getFormAndAppInfo.json': { formDatas: { values: [{ fields: [{ fieldId: 'owner' }, { fieldId: 'status' }] }] } },
    'formProcInstData/getFormVariables.json': [{ id: 'status', componentId: 'status', operatorMap: [{ value: 'Equal' }] }],
    'formdata/getAssociatedForm.json': [{ formUuid: 'FORM_LINKED', appType: 'APP_LINKED', formType: 'receipt' }],
    'formdesign/getFormListOrder.json': { data: [{ formUuid: 'PAGE_A', formType: 'display' }] },
    'appLogicflowBinding/listflowByFormUuid.json': { data: [{ processCode: 'FLOW_A', status: 'y' }, { processCode: 'FLOW_DRAFT', status: 'n' }] },
    'dataview/listDataViewInForm.json': [{ viewUuid: 'VIEW_A', viewType: 'table' }, { viewUuid: 'VIEW_GANTT', viewType: 'gantt' }],
    'configdesign/listConfigDesignInfo.json': [{ designId: 'DETAIL_A' }],
  };
  client = {
    get: jest.fn(async endpoint => {
      const key = endpoint.split('/query/')[1];
      return { success: true, content: clone(key === 'customButtonManage/list.json' ? buttons : metadata[key]) };
    }),
    postFormOnce: jest.fn(async (endpoint, params) => {
      if (endpoint.endsWith('/delete.json')) { buttons = buttons.filter(row => row.buttonUuid !== params.buttonUuid); }
      else {
        const saved = normalize({ ...params, buttonUuid: params.buttonUuid || 'BUTTON_NEW' });
        if (params.buttonUuid) { buttons = buttons.map(row => row.buttonUuid === params.buttonUuid ? saved : row); }
        else { buttons.push(saved); }
      }
      return { success: true, content: true };
    }),
  };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('list and inspect normalize serialized native responses without writing', async () => {
  buttons[0].name = JSON.stringify(buttons[0].name);
  buttons[0].actionConfig.fieldsSelected = '["owner"]';
  buttons[0].actionConfig.hideWhenNotMatch = 'false';
  buttons[0].actionConfig = JSON.stringify(buttons[0].actionConfig);
  expect((await execute(args('list'), client)).buttons[0].actionConfig.fieldsSelected).toEqual(['owner']);
  expect((await execute(args('list'), client)).buttons[0].actionConfig.hideWhenNotMatch).toBe(false);
  expect((await execute(args('inspect', ['BUTTON_A']), client)).configHash).toMatch(/^[a-f0-9]{64}$/);
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('options reads source-specific metadata including only table views and type 6 flows', async () => {
  expect((await execute(args('options'), client)).options.tableViews).toEqual([{ viewUuid: 'VIEW_A', viewType: 'table' }]);
  expect(client.get).toHaveBeenCalledWith(expect.stringContaining('listflowByFormUuid.json'), { formUuid: 'FORM_TEST', type: 6 });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('translation patch retains translations, future action options, conditions and display bindings', async () => {
  const original = clone(buttons[0]);
  const result = await execute(mutation('update', { name: { zh_CN: '重新分配' } }), client);
  expect(result).toMatchObject({ changed: true, readbackVerified: true });
  expect(result.button).toMatchObject({ name: { zh_CN: '重新分配', en_US: 'Assign' }, actionConfig: original.actionConfig,
    tableViewUuids: original.tableViewUuids, detailId: original.detailId });
  expect(JSON.parse(fs.readFileSync(backupPath)).buttons[0]).toEqual(original);
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
  expect(client.postFormOnce.mock.calls[0][1].relationId).toBe('FORM_TEST');
});

test('explicit empty display arrays clear references without deleting the definition', async () => {
  const result = await execute(mutation('update', { tableViewUuids: [], detailId: [] }), client);
  expect(result.button.tableViewUuids).toEqual([]);
  expect(client.postFormOnce.mock.calls[0][0]).toContain('saveButtonConfig');
});

test('sparse optional metadata remains null when renaming a native button', async () => {
  buttons[0].description = null; buttons[0].icon = null;
  const result = await execute(mutation('update', { name: { en_US: 'Reassign' } }), client);
  expect(result.button).toMatchObject({ description: null, icon: null });
  expect(client.postFormOnce.mock.calls[0][1]).toMatchObject({ description: '', icon: '' });
});

test('no-op writes do not create backups or issue mutations', async () => {
  expect((await execute(mutation('update', { name: { zh_CN: '分配' } }), client)).changed).toBe(false);
  expect(fs.existsSync(backupPath)).toBe(false);
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('create resolves linked-form app and type from the association list', async () => {
  const result = await execute(mutation('create', { name: { zh_CN: '跟进' }, actionType: 'fillInForm',
    actionConfig: { fillType: 'fillLinkageForm', linkageFormId: 'FORM_LINKED' } }), client);
  expect(result).toMatchObject({ buttonUuid: 'BUTTON_NEW', readbackVerified: true,
    button: { actionConfig: { linkageFormAppType: 'APP_LINKED', linkageFormType: 'receipt' } } });
  expect(client.postFormOnce.mock.calls[0][1].relationId).toBe('FORM_LINKED');
});

test('create accepts native i18n fallbacks and nullable metadata in readback', async () => {
  const post = client.postFormOnce.getMockImplementation();
  client.postFormOnce.mockImplementation(async (...params) => {
    const result = await post(...params);
    const saved = buttons[buttons.length - 1];
    for (const key of ['name', 'description']) {
      saved[key] = { ...saved[key], en_US: saved[key].en_US || saved[key].zh_CN,
        pureEn_US: saved[key].en_US || saved[key].zh_CN, ja_JP: null, value: null, key: null };
    }
    return result;
  });
  const result = await execute(mutation('create', { name: { type: 'i18n', zh_CN: '修改', en_US: 'Edit' },
    description: { type: 'i18n', zh_CN: '真实验收' }, actionType: 'fillInForm',
    actionConfig: { fillType: 'fillCurrentForm', fieldsSelected: ['owner'] } }), client);
  expect(result.readbackVerified).toBe(true);
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});

test('native i18n expansion cannot hide loss of a preserved translation', async () => {
  const post = client.postFormOnce.getMockImplementation();
  client.postFormOnce.mockImplementation(async (...params) => {
    const result = await post(...params);
    buttons[0].name.en_US = 'Incorrect';
    buttons[0].name.pureEn_US = 'Incorrect';
    return result;
  });
  await expect(execute(mutation('update', { name: { zh_CN: '修改' } }), client))
    .rejects.toMatchObject({ code: 'CUSTOM_BUTTON_READBACK_MISMATCH' });
});

test('updates accept nullable native i18n metadata and preserve other translations', async () => {
  buttons[0].name = { ...buttons[0].name, pureEn_US: 'Assign', ja_JP: null, value: null, key: null };
  buttons[0].description = { ...buttons[0].description, ja_JP: null, key: null };
  const result = await execute(mutation('update', { name: { zh_CN: '更新' } }), client);
  expect(result).toMatchObject({ readbackVerified: true, button: { name: { zh_CN: '更新', en_US: 'Assign', ja_JP: null } } });
});

test('overlong translated button names fail before any remote write', async () => {
  await expect(execute(mutation('update', { name: { en_US: 'Live test edit' } }), client))
    .rejects.toMatchObject({ code: 'CUSTOM_BUTTON_INVALID_CONFIG' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('action changes replace incompatible properties and published automation defaults to confirmation', async () => {
  const result = await execute(mutation('update', { actionType: 'invokeFlow', actionConfig: { processCode: 'FLOW_A' } }), client);
  expect(result.button.actionConfig).toEqual({ processCode: 'FLOW_A', needSecondCheck: ['y'] });
  expect(client.postFormOnce.mock.calls[0][1].relationId).toBe('FLOW_A');
});

test('inner-page link resolves type and explicit disabled runtime confirmation survives', async () => {
  const link = await execute(mutation('create', { name: { en_US: 'Open' }, actionType: 'linkToPage',
    actionConfig: { urlType: 'inner', urlFormUuid: 'PAGE_A', openWith: 'slide' } }), client);
  expect(link.button.actionConfig.urlFormType).toBe('display');
  expect(client.postFormOnce.mock.calls[0][1].relationId).toBeUndefined();
  fs.unlinkSync(backupPath);
  const flow = await execute(mutation('update', { actionType: 'invokeFlow', actionConfig: { processCode: 'FLOW_A', needSecondCheck: [] } }), client);
  expect(flow.button.actionConfig.needSecondCheck).toEqual([]);
});

test('external links retain parameters and accept only safe HTTP(S) URLs', async () => {
  const result = await execute(mutation('create', { name: { en_US: 'Docs' }, actionType: 'linkToPage',
    actionConfig: { urlType: 'outer', url: 'https://example.com/path', openWith: 'new', paramInfo: [
      { paramName: 'source', paramType: 'constant', paramValue: 'yida' },
    ] } }), client);
  expect(result.button.actionConfig.paramInfo).toHaveLength(1);
  client.postFormOnce.mockClear();
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com', 'invalid']) {
    await expect(execute(mutation('create', { name: { en_US: 'Open' }, actionType: 'linkToPage',
      actionConfig: { urlType: 'outer', url, openWith: 'new' } }), client)).rejects.toMatchObject({ code: 'CUSTOM_BUTTON_INVALID_CONFIG' });
  }
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test.each([
  { actionConfig: { fieldsSelected: ['missing'] } },
  { tableViewUuids: ['VIEW_GANTT'] },
  { detailId: ['DETAIL_MISSING'] },
  { actionType: 'invokeFlow', actionConfig: { processCode: 'FLOW_DRAFT' } },
  { actionConfig: { fillType: 'fillLinkageForm', linkageFormId: 'FORM_OTHER' } },
  { actionConfig: { fillType: 'fillLinkageForm', linkageFormId: 'FORM_LINKED', linkageFormAppType: 'APP_OTHER' } },
  { actionType: 'linkToPage', actionConfig: { urlType: 'inner', urlFormUuid: 'PAGE_OTHER', openWith: 'new' } },
  { actionType: 'invokeFlow' },
  { permissionConfig: { condition: 'AND', rules: [{ id: 'missing', op: 'Equal', opCode: 'Equal', value: 'x' }] } },
  { permissionConfig: { condition: 'AND', rules: [{ id: 'status', op: 'Equal', opCode: 'NotEqual', value: 'x' }] } },
  { relationId: 'FORM_OTHER' },
])('rejects invalid references and incomplete action switches before mutation: %j', async patch => {
  await expect(execute(mutation('update', patch), client)).rejects.toMatchObject({ code: 'CUSTOM_BUTTON_INVALID_CONFIG' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('native filter rules replace the previous tree and null restores all records', async () => {
  const rules = { condition: 'AND', rules: [{ id: 'status', op: 'Equal', opCode: 'Equal', valueType: 'literal', value: 'open' }] };
  const result = await execute(mutation('update', { permissionConfig: rules }), client);
  expect(result.button.permissionConfig).toMatchObject({ ...rules, conditionCode: '&&' });
  fs.unlinkSync(backupPath);
  expect((await execute(mutation('update', { permissionConfig: null }), client)).button.permissionConfig).toBeNull();
});

test('normalizing an existing rule never changes the read snapshot or causes a false conflict', async () => {
  buttons[0].permissionConfig = { condition: 'AND', rules: [{ id: 'status', op: 'Equal', opCode: 'Equal', value: 'open' }] };
  const original = clone(buttons[0]);
  const result = await execute(mutation('update', { name: { en_US: 'Reassign' } }, ['--expected-hash', configHash(original)]), client);
  expect(result.readbackVerified).toBe(true);
  expect(JSON.parse(fs.readFileSync(backupPath)).buttons[0]).toEqual(original);
});

test('live metadata SQL keys and editor labels resolve to consistent operator codes', async () => {
  metadata['formProcInstData/getFormVariables.json'] = [
    { id: 'status', componentId: 'status', operatorMap: [
      { value: 'eq', label: '等于', labelEn: 'equal' }, { value: 'is', label: '为空', labelEn: 'is null' },
    ] },
    { id: 'createTime', componentId: 'createTime', operatorMap: [{ value: 'lt', label: '早于' }] },
    { id: 'deadline', componentId: 'deadline', componentName: 'DateField', operatorMap: [{ value: 'lt', label: 'before', labelEn: 'before' }] },
  ];
  expect((await execute(args('options'), client)).options.variables.map(field => field.id)).toEqual(['status', 'deadline']);
  const result = await execute(mutation('update', { permissionConfig: { condition: 'OR', rules: [
    { id: 'status', op: 'eq', value: 'open' }, { id: 'status', op: '为空' }, { id: 'deadline', op: 'lt', value: 1000 },
  ] } }), client);
  expect(result.button.permissionConfig.rules).toEqual([
    expect.objectContaining({ id: 'status', op: 'eq', value: 'open', opCode: 'Equal', valueType: 'literal', ruleValue: 'open', extValue: 'value' }),
    expect.objectContaining({ id: 'status', op: '为空', opCode: 'NotExistValue', valueType: 'literal', ruleValue: '' }),
    expect.objectContaining({ id: 'deadline', op: 'lt', opCode: 'Before', valueType: 'literal', value: 1000, componentType: 'DateField', ruleType: 'rule_date' }),
  ]);
  expect(result.button.permissionConfig.ruleId).toMatch(/^group-/);
  for (const rule of result.button.permissionConfig.rules) {
    expect(rule.ruleId).toMatch(/^item-/);
    expect(rule.parentId).toBe(result.button.permissionConfig.ruleId);
  }
});

test('button limit rejects the eleventh creation', async () => {
  buttons = Array.from({ length: 10 }, (_, i) => record('BUTTON_' + i));
  await expect(execute(mutation('create', { name: { en_US: 'Open' }, actionType: 'fillInForm',
    actionConfig: { fillType: 'fillCurrentForm', fieldsSelected: ['owner'] } }), client)).rejects.toMatchObject({ code: 'CUSTOM_BUTTON_LIMIT' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('stale expected hash and concurrent display changes both reject writes', async () => {
  await expect(execute(mutation('update', { name: { en_US: 'Changed' } }, ['--expected-hash', 'old']), client))
    .rejects.toMatchObject({ code: 'CUSTOM_BUTTON_CONFLICT' });
  const get = client.get.getMockImplementation(); let count = 0;
  client.get.mockImplementation(async (...params) => {
    if (params[0].includes('customButtonManage/list') && ++count === 2) { buttons[0].detailId = []; }
    return get(...params);
  });
  await expect(execute(mutation('update', { name: { en_US: 'Changed' } }), client)).rejects.toMatchObject({ code: 'CUSTOM_BUTTON_CONFLICT' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('successful acknowledgement with false content or mismatched readback never reports success', async () => {
  client.postFormOnce.mockResolvedValue({ success: true, content: false });
  await expect(execute(mutation('update', { name: { en_US: 'Changed' } }), client)).rejects.toMatchObject({
    code: 'CUSTOM_BUTTON_API_ERROR', details: { backupPath, retrySafe: false, sideEffectState: 'unknown' },
  });
  fs.unlinkSync(backupPath);
  client.postFormOnce.mockResolvedValue({ success: true, content: true });
  await expect(execute(mutation('update', { name: { en_US: 'Changed' } }), client)).rejects.toMatchObject({
    code: 'CUSTOM_BUTTON_READBACK_MISMATCH', details: { mutationAccepted: true, sideEffectState: 'accepted_unverified' },
  });
});

test('timeout after server acceptance is sent once and reports an uncertain outcome', async () => {
  client.postFormOnce.mockRejectedValue(new Error('timeout'));
  await expect(execute(mutation('create', { name: { en_US: 'Open' }, actionType: 'fillInForm',
    actionConfig: { fillType: 'fillCurrentForm', fieldsSelected: ['owner'] } }), client)).rejects.toMatchObject({
    details: { retrySafe: false, backupPath, sideEffectState: 'unknown' },
  });
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});

test.each([undefined, { success: true }, { success: false }, { success: true, __needLogin: true, content: [] }, { success: true, content: {} }])(
  'malformed or unauthenticated list fails closed: %j', async response => {
    client.get.mockResolvedValue(response);
    await expect(execute(args('list'), client)).rejects.toHaveProperty('isCliError', true);
    expect(client.postFormOnce).not.toHaveBeenCalled();
  });

test('delete uses a fresh inspected hash, backs up and verifies absence', async () => {
  const hash = configHash(buttons[0]);
  const result = await execute(args('delete', ['BUTTON_A', '--yes', '--expected-hash', hash, '--backup', backupPath]), client);
  expect(result).toMatchObject({ changed: true, readbackVerified: true });
  expect(JSON.parse(fs.readFileSync(backupPath)).buttons).toHaveLength(1);
  expect(client.postFormOnce).toHaveBeenCalledWith(expect.stringContaining('/delete.json'), { formUuid: 'FORM_TEST', buttonUuid: 'BUTTON_A' });
});

test('platform denial keeps its diagnostic reason in the localized CLI error', async () => {
  client.get.mockResolvedValue({ success: false, errorMsg: 'Edition does not support this action', errorCode: 'FORBIDDEN' });
  await expect(execute(args('list'), client)).rejects.toMatchObject({
    message: expect.stringContaining('Edition does not support this action'), details: { platformErrorCode: 'FORBIDDEN' },
  });
});

test('duplicate button ids, wrong-form records and missing targets fail closed', async () => {
  buttons.push(record());
  await expect(execute(args('list'), client)).rejects.toMatchObject({ code: 'CUSTOM_BUTTON_INVALID_RESPONSE' });
  buttons = [{ ...record(), formUuid: 'FORM_OTHER' }];
  await expect(execute(args('list'), client)).rejects.toMatchObject({ code: 'CUSTOM_BUTTON_INVALID_RESPONSE' });
  buttons = [];
  await expect(execute(args('inspect', ['BUTTON_A']), client)).rejects.toMatchObject({ code: 'CUSTOM_BUTTON_NOT_FOUND' });
});

test('existing backup and prototype keys block mutations', async () => {
  fs.writeFileSync(backupPath, 'keep');
  await expect(execute(mutation('update', { name: { en_US: 'New' } }), client)).rejects.toHaveProperty('code', 'EEXIST');
  expect(fs.readFileSync(backupPath, 'utf8')).toBe('keep');
  const patch = JSON.parse('{"actionConfig":{"__proto__":{"bad":true}}}');
  await expect(execute(mutation('update', patch), client)).rejects.toMatchObject({ code: 'CUSTOM_BUTTON_INVALID_CONFIG' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test.each([
  [], ['delete', 'APP_TEST', 'FORM_TEST', 'BUTTON_A', '--yes'], ['create', 'APP_TEST', 'FORM_TEST'],
  ['list', '../APP', 'FORM_TEST'], ['list', 'APP_TEST', 'FORM_TEST', '--yes'],
  ['update', 'APP_TEST', 'FORM_TEST', 'BUTTON_A', '--config', '--json'],
  ['list', 'APP_TEST', 'FORM_TEST', '--json', '--json'],
].map(input => [input]))('strict argument parsing rejects %j', input => expect(() => parseArgs(input)).toThrow());
