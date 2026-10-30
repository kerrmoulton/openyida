'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');
const { resolveProjectRoot } = require('../core/utils');
const { createYidaClient } = require('../core/yida-client');

const ACTIONS = ['list', 'inspect', 'options', 'create', 'update', 'delete'];
const FIELDS = ['name', 'description', 'icon', 'actionType', 'actionConfig', 'permissionConfig', 'tableViewUuids', 'detailId'];
const JSON_FIELDS = FIELDS.filter(key => key !== 'actionType');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idPattern = /^[A-Za-z0-9_-]+$/;
// Same operator codes as the native custom-button rule editor.
const OP_CODES = {
  等于: 'Equal', 不等于: 'NotEqual', 大于: 'Bigger', 大于等于: 'BiggerOrEqual', 小于: 'Lesser', 小于等于: 'LesserOrEqual',
  早于: 'Before', 晚于: 'After', 不早于: 'NotBefore', 不晚于: 'NotAfter', 包含: 'Contain', 不包含: 'NotContain',
  开始为: 'BeginWith', 结束为: 'EndWith', 有值: 'ExistValue', 没有值: 'NotExistValue', 等于任意一个: 'EqualAny',
  不等于任意一个: 'NotEqualAny', 在范围内: 'InRange', 不在范围内: 'NotInRange', 属于: 'Contain', 不属于: 'NotContain', 匹配: 'Like',
};
const NATIVE_OP_CODES = new Set(Object.values(OP_CODES));
const SQL_OP_CODES = { eq: 'Equal', ne: 'NotEqual', gt: 'Bigger', ge: 'BiggerOrEqual', lt: 'Lesser', le: 'LesserOrEqual',
  ilike: 'Like', in: 'EqualAny', not_in: 'NotEqualAny', is: 'NotExistValue', is_not: 'ExistValue', between: 'InRange' };
const EN_OP_CODES = { equal: 'Equal', 'not equal': 'NotEqual', before: 'Before', after: 'After',
  'not before': 'NotBefore', 'not after': 'NotAfter', 'is null': 'NotExistValue', 'is not null': 'ExistValue',
  'in any': 'EqualAny', 'not in any': 'NotEqualAny', like: 'Like', between: 'InRange' };
const EXCLUDED_VARIABLES = new Set(['originatorCorp', 'processInstanceId', 'createTime', 'modifiedTime', 'currentNodeName', 'taskId']);
const RULE_TYPES = { TextField: 'rule_text', TextareaField: 'rule_text', SerialNumberField: 'rule_text',
  NumberField: 'rule_number', SelectField: 'rule_select', RadioField: 'rule_radio', DateField: 'rule_date', EmployeeField: 'rule_employee' };

function fail(code, key, detail = '', details) {
  throw new CliError(t(`custom_button.${key}`, detail), { code: `CUSTOM_BUTTON_${code}`, details });
}

function parseJson(value, label) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch (_) { return fail('INVALID_CONFIG', 'invalid_config', label); }
}

function safe(value) {
  if (!value || typeof value !== 'object') { return; }
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) { fail('INVALID_CONFIG', 'invalid_config', key); }
    safe(value[key]);
  }
}

function stable(value) {
  if (Array.isArray(value)) { return value.map(stable); }
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
}

function configHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(writable(value)))).digest('hex');
}

function writable(value) {
  return Object.fromEntries(FIELDS.map(key => [key, value[key] ?? null]));
}

function matchesReadback(saved, expected) {
  return FIELDS.every(key => {
    // The server expands i18n values with fallback translations and nullable
    // metadata. Verify every supplied/preserved value without requiring those
    // derived properties to have existed in the request.
    if (['name', 'description'].includes(key) && object(expected[key]) && object(saved[key])) {
      return Object.entries(expected[key]).every(([locale, value]) => locale === 'pureEn_US'
        || isDeepStrictEqual(stable(saved[key][locale]), stable(value)));
    }
    return isDeepStrictEqual(stable(saved[key] ?? null), stable(expected[key] ?? null));
  });
}

function normalize(raw) {
  if (!object(raw) || typeof raw.buttonUuid !== 'string' || !idPattern.test(raw.buttonUuid)) {
    fail('INVALID_RESPONSE', 'invalid_response', 'buttonUuid');
  }
  const value = { ...raw };
  for (const key of JSON_FIELDS) { value[key] = raw[key] === null || raw[key] === undefined || raw[key] === '' ? null : parseJson(raw[key], key); }
  if (!object(value.actionConfig)) { fail('INVALID_RESPONSE', 'invalid_response', 'actionConfig'); }
  // Match the native editor: individual properties may themselves be JSON
  // strings (arrays, booleans, or translated objects). Plain strings stay as is.
  value.actionConfig = { ...value.actionConfig };
  for (const [key, item] of Object.entries(value.actionConfig)) {
    if (typeof item === 'string') {
      try { value.actionConfig[key] = JSON.parse(item); } catch (_) { /* native scalar string */ }
    }
  }
  for (const key of ['tableViewUuids', 'detailId']) { value[key] = value[key] || []; }
  safe(value);
  return value;
}

function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (Object.hasOwn(flags, arg)) { fail('USAGE', 'usage'); }
    if (['--json', '--yes', '--help', '-h'].includes(arg)) { flags[arg] = true; continue; }
    if (['--config', '--backup', '--expected-hash'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('-')) { fail('USAGE', 'usage'); }
      flags[arg] = args[++i]; continue;
    }
    if (arg.startsWith('-')) { fail('USAGE', 'usage'); }
    positional.push(arg);
  }
  if (flags['--help'] || flags['-h']) { return { help: true }; }
  const [action, appType, formUuid, buttonUuid] = positional;
  const targeted = ['inspect', 'update', 'delete'].includes(action);
  if (!ACTIONS.includes(action) || positional.length !== (targeted ? 4 : 3)
    || [appType, formUuid, ...(targeted ? [buttonUuid] : [])].some(id => !id || !idPattern.test(id))
    || (['create', 'update'].includes(action) && !flags['--config'])
    || (action === 'delete' && (!flags['--yes'] || !flags['--expected-hash']))) { fail('USAGE', 'usage'); }
  const allowed = {
    list: [], inspect: [], options: [], create: ['--config', '--backup'],
    update: ['--config', '--backup', '--expected-hash'], delete: ['--yes', '--backup', '--expected-hash'],
  };
  if (Object.keys(flags).some(key => key !== '--json' && !allowed[action].includes(key))) { fail('USAGE', 'usage'); }
  return { action, appType, formUuid, buttonUuid, flags };
}

function unwrap(response, endpoint) {
  if (!response || response.success !== true || response.__needLogin || response.__csrfExpired || response.content === false) {
    fail('API_ERROR', 'api_error', response?.errorMsg || response?.message || endpoint,
      { endpoint, platformErrorCode: response?.errorCode, needLogin: !!response?.__needLogin });
  }
  return response.content;
}

function array(value, label) {
  if (!Array.isArray(value)) { fail('INVALID_RESPONSE', 'invalid_response', label); }
  return value;
}

function ids(value, label, nonempty = false) {
  if (!Array.isArray(value) || (nonempty && !value.length) || value.some(id => typeof id !== 'string' || !idPattern.test(id))
    || new Set(value).size !== value.length) { fail('INVALID_CONFIG', 'invalid_config', label); }
}

function i18n(value, label, required) {
  if (!required && value === null) { return; }
  if (!object(value) || (required && !Object.entries(value).some(([key, text]) => key !== 'type' && typeof text === 'string' && text.trim()))
    || Object.entries(value).some(([key, text]) => key !== 'type' && text !== null && typeof text !== 'string')) {
    fail('INVALID_CONFIG', 'invalid_config', label);
  }
}

function patchConfig(base, patch) {
  if (!object(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !FIELDS.includes(key))) {
    fail('INVALID_CONFIG', 'invalid_config', FIELDS.join(', '));
  }
  safe(patch);
  for (const key of ['name', 'description', 'icon', 'actionConfig']) {
    if (patch[key] !== undefined && !(patch[key] === null && ['description', 'icon'].includes(key)) && !object(patch[key])) {
      fail('INVALID_CONFIG', 'invalid_config', key);
    }
  }
  const changedAction = (patch.actionType !== undefined && patch.actionType !== base.actionType)
    || (patch.actionConfig?.fillType !== undefined && patch.actionConfig.fillType !== base.actionConfig?.fillType)
    || (patch.actionConfig?.urlType !== undefined && patch.actionConfig.urlType !== base.actionConfig?.urlType);
  const next = { ...base, ...patch };
  // Translations merge. Arrays, conditions and a changed action replace.
  for (const key of ['name', 'description', 'icon', 'actionConfig']) {
    if (patch[key] === undefined && !(key === 'actionConfig' && changedAction)) { next[key] = base[key]; continue; }
    if (patch[key] === null) { next[key] = null; continue; }
    next[key] = key === 'actionConfig' && changedAction ? { ...patch[key] } : { ...base[key], ...patch[key] };
  }
  // Reference validation enriches action/rule metadata. Never mutate the read
  // snapshot used for backups, concurrency checks or no-op comparisons.
  return JSON.parse(JSON.stringify(next));
}

function validateConfig(value) {
  i18n(value.name, 'name', true);
  if (Object.entries(value.name).some(([locale, text]) => /^[a-z]{2}_[A-Z]{2}$/.test(locale)
    && typeof text === 'string' && text.length > 10)) { fail('INVALID_CONFIG', 'invalid_config', 'name (max 10)'); }
  i18n(value.description, 'description', false);
  if ((value.icon !== null && !object(value.icon)) || !object(value.actionConfig)) { fail('INVALID_CONFIG', 'invalid_config', 'icon / actionConfig'); }
  ids(value.tableViewUuids, 'tableViewUuids'); ids(value.detailId, 'detailId');
  const config = value.actionConfig;
  if (value.actionType === 'fillInForm') {
    if (config.fillType === 'fillCurrentForm') { ids(config.fieldsSelected, 'fieldsSelected', true); }
    else if (config.fillType !== 'fillLinkageForm' || !config.linkageFormId) { fail('INVALID_CONFIG', 'invalid_config', 'fillType / linkageFormId'); }
  } else if (value.actionType === 'invokeFlow') {
    if (!config.processCode || !Array.isArray(config.needSecondCheck)
      || config.needSecondCheck.length > 1 || config.needSecondCheck.some(item => item !== 'y')) {
      fail('INVALID_CONFIG', 'invalid_config', 'processCode / needSecondCheck');
    }
  } else if (value.actionType === 'linkToPage') {
    if (!['new', 'slide'].includes(config.openWith)) { fail('INVALID_CONFIG', 'invalid_config', 'openWith'); }
    if (config.urlType === 'outer') {
      let url;
      try { url = new URL(config.url); } catch (_) { fail('INVALID_CONFIG', 'invalid_config', 'url'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) { fail('INVALID_CONFIG', 'invalid_config', 'url'); }
    } else if (config.urlType !== 'inner' || !config.urlFormUuid) { fail('INVALID_CONFIG', 'invalid_config', 'urlType / urlFormUuid'); }
    if (config.paramInfo !== undefined && (!Array.isArray(config.paramInfo) || config.paramInfo.some(param => !object(param)
      || typeof param.paramName !== 'string' || !param.paramName.trim()
      || !['constant', 'variable', 'formula'].includes(param.paramType) || param.paramValue === undefined))) {
      fail('INVALID_CONFIG', 'invalid_config', 'paramInfo');
    }
  } else { fail('INVALID_CONFIG', 'invalid_config', 'actionType'); }
  if (value.permissionConfig !== null && !object(value.permissionConfig)) { fail('INVALID_CONFIG', 'invalid_config', 'permissionConfig'); }
}

async function execute(parsed, client = createYidaClient()) {
  const { action, appType, formUuid, buttonUuid, flags } = parsed;
  const target = { appType, formUuid, ...(buttonUuid ? { buttonUuid } : {}) };
  const prefix = `/dingtalk/web/${appType}/query/`;
  const read = async (endpoint, params = {}) => unwrap(await client.get(prefix + endpoint, { formUuid, ...params }), endpoint);
  const list = async () => {
    const rows = array(await read('customButtonManage/list.json'), 'buttons').map(normalize);
    if (rows.some(row => row.formUuid && row.formUuid !== formUuid)
      || new Set(rows.map(row => row.buttonUuid)).size !== rows.length) { fail('INVALID_RESPONSE', 'invalid_response', 'buttons'); }
    return rows;
  };
  const metadata = async () => {
    const info = await read('formdesign/getFormAndAppInfo.json', { appType });
    const fields = array(info?.formDatas?.values?.[0]?.fields, 'fields');
    const variables = array(await read('formProcInstData/getFormVariables.json', { appType, operatorMode: 'local' }), 'variables')
      .filter(field => !EXCLUDED_VARIABLES.has(field.componentId) && Array.isArray(field.operatorMap) && field.operatorMap.length);
    const relatedForms = array(await read('formdata/getAssociatedForm.json'), 'relatedForms');
    const forms = array((await read('formdesign/getFormListOrder.json'))?.data, 'pages');
    const flows = array((await read('appLogicflowBinding/listflowByFormUuid.json', { type: 6 }))?.data, 'flows');
    const views = array(await read('dataview/listDataViewInForm.json', { appType }), 'views').filter(view => view.viewType === 'table');
    const details = array(await read('configdesign/listConfigDesignInfo.json', { relationCode: 'DETAIL' }), 'details');
    return { fields, variables, relatedForms, pages: forms, flows, tableViews: views, detailPages: details };
  };
  const output = { success: true, action, ...target };
  if (action === 'options') { return { ...output, options: await metadata() }; }
  const beforeList = await list();
  const before = buttonUuid ? beforeList.find(button => button.buttonUuid === buttonUuid) : null;
  if (buttonUuid && !before) { fail('NOT_FOUND', 'not_found', buttonUuid); }
  if (action === 'list') { return { ...output, buttons: beforeList, totalCount: beforeList.length }; }
  if (action === 'inspect') { return { ...output, button: before, configHash: configHash(before) }; }
  if (flags['--expected-hash'] && flags['--expected-hash'] !== configHash(before)) { fail('CONFLICT', 'conflict'); }
  let expected;
  if (action !== 'delete') {
    const patch = parseJson(fs.readFileSync(flags['--config'], 'utf8'), 'config');
    if (action === 'create' && beforeList.length >= 10) { fail('LIMIT', 'limit'); }
    const defaults = { name: {}, description: {}, icon: { type: 'icon', value: 'icon_diagonal_outlined' },
      actionConfig: {}, permissionConfig: null, tableViewUuids: [], detailId: [] };
    expected = patchConfig(before || defaults, patch);
    if (expected.actionType === 'invokeFlow' && expected.actionConfig.needSecondCheck === undefined) {
      expected.actionConfig.needSecondCheck = ['y'];
    }
    validateConfig(expected);
    const options = await metadata();
    validateReferences(expected, options, formUuid);
    if (before && isDeepStrictEqual(stable(writable(expected)), stable(writable(before)))) {
      return { ...output, changed: false, button: before, configHash: configHash(before), readbackVerified: true };
    }
  }
  // List includes display bindings. A concurrent edit anywhere stops the write.
  if (!isDeepStrictEqual(stable(beforeList.map(row => [row.buttonUuid, configHash(row)])),
    stable((await list()).map(row => [row.buttonUuid, configHash(row)])))) { fail('CONFLICT', 'conflict'); }
  const backupPath = flags['--backup'] ? path.resolve(flags['--backup']) : path.join(resolveProjectRoot().projectRoot,
    '.cache', 'openyida', 'custom-button', `${Date.now()}-${crypto.randomUUID()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({ ...target, action, buttons: beforeList }, null, 2), { flag: 'wx', mode: 0o600 });
  const mutationDetails = { target, backupPath, retrySafe: false, sideEffectState: 'unknown', readbackAllowed: true };
  const endpoint = action === 'delete' ? 'customButtonManage/delete.json' : 'customButtonManage/saveButtonConfig.json';
  const params = action === 'delete' ? { formUuid, buttonUuid } : serialize(expected, formUuid, buttonUuid);
  try { unwrap(await client.postFormOnce(prefix + endpoint, params), endpoint); }
  catch (error) { throw new CliError(error.message, { code: error.code || 'CUSTOM_BUTTON_WRITE_FAILED', details: { ...error.details, ...mutationDetails } }); }
  try {
    const after = await list();
    let saved;
    if (action === 'delete') {
      if (after.some(row => row.buttonUuid === buttonUuid)) { fail('READBACK_MISMATCH', 'readback_mismatch'); }
    } else {
      const added = after.filter(row => !beforeList.some(old => old.buttonUuid === row.buttonUuid));
      saved = action === 'create' ? (added.length === 1 ? added[0] : null) : after.find(row => row.buttonUuid === buttonUuid);
      if (!saved || !matchesReadback(saved, expected)) { fail('READBACK_MISMATCH', 'readback_mismatch'); }
    }
    return { ...output, buttonUuid: saved?.buttonUuid || buttonUuid, changed: true, backupPath, readbackVerified: true,
      ...(saved ? { button: saved, configHash: configHash(saved) } : {}) };
  } catch (error) {
    throw new CliError(error.message, { code: error.code || 'CUSTOM_BUTTON_READBACK_FAILED',
      details: { ...mutationDetails, mutationAccepted: true, sideEffectState: 'accepted_unverified' } });
  }
}

function validateReferences(value, options, formUuid) {
  const config = value.actionConfig;
  const check = (condition, label) => { if (!condition) { fail('INVALID_CONFIG', 'invalid_config', label); } };
  for (const id of value.tableViewUuids) { check(options.tableViews.some(view => view.viewUuid === id), `tableViewUuids: ${id}`); }
  for (const id of value.detailId) { check(options.detailPages.some(page => page.designId === id), `detailId: ${id}`); }
  if (value.actionType === 'fillInForm') {
    if (config.fillType === 'fillCurrentForm') {
      for (const id of config.fieldsSelected) { check(options.fields.some(field => field.fieldId === id), `fieldsSelected: ${id}`); }
      value.relationId = formUuid;
    } else {
      const form = options.relatedForms.find(form => form.formUuid === config.linkageFormId);
      check(form && form.appType && form.formType, 'linkageFormId');
      check(!config.linkageFormAppType || config.linkageFormAppType === form.appType, 'linkageFormAppType');
      check(!config.linkageFormType || config.linkageFormType === form.formType, 'linkageFormType');
      config.linkageFormAppType = form.appType; config.linkageFormType = form.formType;
      value.relationId = form.formUuid;
    }
  } else if (value.actionType === 'invokeFlow') {
    check(options.flows.some(flow => flow.processCode === config.processCode && flow.status === 'y'), 'processCode (published type 6)');
    value.relationId = config.processCode;
  } else if (config.urlType === 'inner') {
    const page = options.pages.find(page => page.formUuid === config.urlFormUuid);
    check(page && ['receipt', 'process', 'report', 'display', 'portal', 'manage', 'datav'].includes(page.formType), 'urlFormUuid');
    check(!config.urlFormType || config.urlFormType === page.formType, 'urlFormType');
    config.urlFormType = page.formType;
  }
  const visit = (group, parentId) => {
    check(object(group) && ['AND', 'OR'].includes(group.condition) && Array.isArray(group.rules) && group.rules.length, 'permissionConfig');
    group.conditionCode = group.condition === 'AND' ? '&&' : '||';
    group.ruleId = group.ruleId || `group-${crypto.randomUUID()}`;
    if (parentId) { group.parentId = parentId; }
    for (const rule of group.rules) {
      check(object(rule), 'permissionConfig.rules');
      if (rule.rules) { visit(rule, group.ruleId); continue; }
      const field = options.variables.find(field => field.id === rule.id);
      // Platform metadata uses SQL keys (eq, in, is...) while saved editor
      // trees may use labels or canonical codes. Resolve through the same field.
      const operator = field?.operatorMap?.find(op => op.value === rule.op || op.label === rule.op || op.labelEn === rule.op
        || (OP_CODES[op.label] || EN_OP_CODES[op.labelEn] || SQL_OP_CODES[op.value]) === rule.op);
      check(operator, `permissionConfig: ${rule.id} / ${rule.op}`);
      const code = operator.opCode || OP_CODES[operator.label] || EN_OP_CODES[operator.labelEn] || SQL_OP_CODES[operator.value]
        || OP_CODES[rule.op] || (NATIVE_OP_CODES.has(rule.op) ? rule.op : null);
      check(code && (rule.opCode === undefined || rule.opCode === code), 'permissionConfig.opCode');
      rule.opCode = code;
      if (rule.valueType === undefined) { rule.valueType = rule.extValue === 'column' ? 'column' : 'literal'; }
      check(['literal', 'column'].includes(rule.valueType), 'permissionConfig.valueType');
      check(rule.value !== undefined || ['ExistValue', 'NotExistValue'].includes(code), 'permissionConfig.value');
      // Native runtime evaluates ruleValue using the component's rule parser;
      // id/op/value alone renders in the editor but cannot execute correctly.
      rule.ruleId = rule.ruleId || `item-${crypto.randomUUID()}`;
      rule.parentId = group.ruleId;
      if (field.componentName) { rule.componentType = field.componentName; }
      rule.ruleType = rule.ruleType || RULE_TYPES[rule.componentType] || 'rule_text';
      rule.name = rule.name || field.varName?.zh_CN || field.varName?.en_US || rule.id;
      rule.extValue = rule.valueType === 'column' ? 'column' : 'value';
      rule.ruleValue = rule.value ?? '';
      if (rule.value === undefined) { rule.value = ''; }
    }
  };
  if (value.permissionConfig) { visit(value.permissionConfig); }
  for (const param of config.paramInfo || []) {
    if (param.paramType === 'variable') {
      check(['formUuid', 'formInstId'].includes(param.paramValue) || options.fields.some(field => field.fieldId === param.paramValue), 'paramInfo.paramValue');
    }
  }
}

function serialize(value, formUuid, buttonUuid) {
  const params = { formUuid, buttonUuid: buttonUuid || '' };
  for (const key of FIELDS) {
    params[key] = JSON_FIELDS.includes(key)
      ? (value[key] === null || (['tableViewUuids', 'detailId'].includes(key) && !value[key].length) ? '' : JSON.stringify(value[key])) : value[key];
  }
  if (value.actionType !== 'linkToPage') { params.relationId = value.relationId; }
  return params;
}

async function run(args, options = {}) {
  const parsed = parseArgs(args);
  if (parsed.help) { process.stdout.write(t('custom_button.usage') + '\n'); return; }
  const result = await execute(parsed, options.client);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

module.exports = { run, execute, parseArgs, normalize, configHash, patchConfig, validateConfig, validateReferences, serialize };
