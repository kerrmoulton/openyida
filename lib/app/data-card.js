'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');
const { resolveProjectRoot } = require('../core/utils');
const { createAuthRef, createYidaClient } = require('../core/yida-client');
const { resolveContentLocale } = require('../core/yida-i18n');
const { buildApplicationSettingsUrls } = require('./application-entry-urls');
const { buildCardConfig, assertCapacity } = require('./data-card-builder');
const { buildReportProbeTargets } = require('../report/runtime-probe');

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const appValid = value => /^APP_[A-Za-z0-9_-]+$/.test(value || '');
const cardValid = value => /^CARD-[A-Za-z0-9_-]+$/.test(value || '');
function fail(code, detail, details) {
  throw new CliError(t('data_card.failed', detail || code), { code: `DATA_CARD_${code}`, details });
}
function stable(value) {
  if (Array.isArray(value)) { return value.map(stable); }
  if (!object(value)) { return value; }
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function schemaHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function parseJson(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch (_) { return fail('INVALID_SCHEMA', 'Invalid JSON'); }
}
function safeKeys(value) {
  if (!value || typeof value !== 'object') { return; }
  for (const key of Object.keys(value)) {
    // actions.module.source legitimately contains a constructor entry.
    if (key === '__proto__') { fail('INVALID_SCHEMA', key); }
    safeKeys(value[key]);
  }
}
function validateSchema(schema) {
  if (!object(schema) || (schema.schemaType !== undefined && schema.schemaType !== 'superform')
    || (schema.schemaVersion !== undefined && typeof schema.schemaVersion !== 'string')
    || !Array.isArray(schema.pages) || schema.pages.length !== 1
    || !Array.isArray(schema.pages[0]?.componentsTree) || !schema.pages[0].componentsTree.length) {
    fail('INVALID_SCHEMA', 'Expected complete superform schema with one page and componentsTree', {
      schemaType: schema?.schemaType, schemaVersion: schema?.schemaVersion, keys: object(schema) ? Object.keys(schema) : [],
      pageCount: schema?.pages?.length, componentsTreeType: typeof schema?.pages?.[0]?.componentsTree,
    });
  }
  safeKeys(schema);
  const ids = new Set();
  const fields = new Set();
  const visit = node => {
    if (!object(node) || typeof node.componentName !== 'string' || !node.componentName) { fail('INVALID_SCHEMA', 'componentName'); }
    for (const [id, seen] of [[node.id, ids], [node.props?.fieldId, fields]]) {
      if (id === undefined) { continue; }
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) { fail('INVALID_SCHEMA', `Duplicate or invalid component ID: ${id}`); }
      seen.add(id);
    }
    if (node.children !== undefined && !Array.isArray(node.children)) { fail('INVALID_SCHEMA', 'children'); }
    (node.children || []).forEach(visit);
  };
  schema.pages[0].componentsTree.forEach(visit);
  return schema;
}
function parseArgs(args = []) {
  const positional = [];
  const flags = {};
  const booleans = ['--json', '--published', '--allow-send', '--help', '-h'];
  const valued = ['--name', '--description', '--schema', '--config', '--expected-hash', '--backup', '--out', '--version', '--page', '--size', '--search'];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (booleans.includes(arg) || valued.includes(arg)) {
      if (Object.hasOwn(flags, arg)) { fail('USAGE', arg); }
      if (booleans.includes(arg)) { flags[arg] = true; }
      else {
        if (!args[i + 1] || args[i + 1].startsWith('--')) { fail('USAGE', arg); }
        flags[arg] = args[++i];
      }
    } else if (arg.startsWith('-')) { fail('USAGE', arg); }
    else { positional.push(arg); }
  }
  if (flags['--help'] || flags['-h']) { return { help: true }; }
  const [action, appType, cardCode] = positional;
  const allowed = {
    list: ['--page', '--size', '--search', '--published'], create: ['--name', '--description', '--out'],
    get: ['--published', '--version', '--out'], probe: ['--published'], save: ['--schema', '--config', '--expected-hash', '--backup'],
    publish: ['--expected-hash', '--backup'],
    'release-get': ['--out'], 'release-check': [], refs: ['--page', '--size'],
    'release-save': ['--config', '--expected-hash', '--backup', '--allow-send'],
    'release-test': ['--config', '--allow-send'],
  };
  if (!allowed[action] || !appValid(appType) || positional.length !== (['list', 'create'].includes(action) ? 2 : 3)
    || (cardCode && !cardValid(cardCode)) || Object.keys(flags).some(key => key !== '--json' && !allowed[action].includes(key))
    || (action === 'create' && !flags['--name']?.trim())
    || (action === 'save' && (!!flags['--schema'] === !!flags['--config']))
    || (action === 'release-save' && !flags['--config'])
    || (['save', 'publish', 'release-save'].includes(action) && !/^[a-f0-9]{64}$/.test(flags['--expected-hash'] || ''))
    || (action === 'release-test' && !flags['--allow-send'])
    || (flags['--published'] && flags['--version'])) { fail('USAGE', t('data_card.usage')); }
  for (const [flag, max] of [['--page', action === 'refs' ? 100 : 1000], ['--size', 100]]) {
    if (flags[flag] !== undefined && (!/^\d+$/.test(flags[flag]) || Number(flags[flag]) < 1 || Number(flags[flag]) > max)) { fail('USAGE', flag); }
  }
  return { action, appType, cardCode, flags };
}
function unwrap(response, endpoint) {
  if (!response || response.success !== true || response.__needLogin || response.__csrfExpired) {
    fail('API_ERROR', response?.errorMsg || response?.message || endpoint, { endpoint, platformErrorCode: response?.errorCode });
  }
  return response.content;
}
function writeFile(filename, value) {
  const output = path.resolve(filename);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  return output;
}
function backup(target, value, filename) {
  const output = filename || path.join(resolveProjectRoot().projectRoot, '.cache', 'openyida', 'data-card', `${Date.now()}-${crypto.randomUUID()}.json`);
  return writeFile(output, { ...target, card: value });
}
function cardUrls(appType, cardCode, baseUrl) {
  const settingsUrls = buildApplicationSettingsUrls({ appType, baseUrl });
  if (!settingsUrls.dataCardManageUrl) { fail('INVALID_TARGET', 'baseUrl'); }
  const origin = new URL(settingsUrls.dataCardManageUrl).origin;
  return { ...settingsUrls,
    designerUrl: `${origin}/alibaba/web/${appType}/report/dataCardDesigner.html?cardCode=${encodeURIComponent(cardCode)}`,
    previewUrl: `${origin}/alibaba/web/${appType}/report/dataCardView.html?cardCode=${encodeURIComponent(cardCode)}`,
    releaseUrl: `${origin}/${appType}/admin/${encodeURIComponent(cardCode)}/dataCardRelease`,
  };
}
function i18nKeys(schema) {
  if (schema.config?.i18nKeyList !== undefined && !Array.isArray(schema.config.i18nKeyList)) { fail('INVALID_SCHEMA', 'i18nKeyList'); }
  const keys = new Set(schema.config?.i18nKeyList || []);
  const visit = value => {
    if (!value || typeof value !== 'object') { return; }
    if (value.type === 'i18n' && typeof value.key === 'string' && value.key && !value.key.startsWith('i18n')) { keys.add(value.key); }
    Object.values(value).forEach(visit);
  };
  visit(schema.pages);
  if ([...keys].some(key => typeof key !== 'string' || !key || key.includes(','))) { fail('INVALID_SCHEMA', 'i18nKeyList'); }
  return [...keys].sort();
}
async function appendIndicators(schema, config, client, appType) {
  return validateSchema(await buildCardConfig(schema, config, client, appType));
}
async function execute(parsed, client = createYidaClient({ authRef: createAuthRef() })) {
  const { action, appType, flags } = parsed;
  let { cardCode } = parsed;
  const prefix = `/${appType}/visual/dataCardRpc/`;
  const get = async (endpoint, params) => unwrap(await client.get(prefix + endpoint + '.json', params), endpoint);
  const post = async (endpoint, params) => unwrap(await client.postFormOnce(prefix + endpoint + '.json', params), endpoint);
  const read = async (draft = true, version) => {
    const card = await get('getCardSchema', { cardCode, draft, ...(version ? { version } : {}) });
    if (!object(card) || card.cardCode !== cardCode || (card.appType && card.appType !== appType)) { fail('TARGET_MISMATCH', cardCode); }
    return { ...card, schemaBody: validateSchema(parseJson(card.schemaBody)) };
  };
  const target = { success: true, action, appType };
  if (action === 'list') {
    const content = await get('listCardInfo', { pageSize: Number(flags['--size'] || 50), currentPage: Number(flags['--page'] || 1),
      onlyPublished: !!flags['--published'], ...(flags['--search'] ? { searchKey: flags['--search'] } : {}) });
    if (!object(content) || !Array.isArray(content.data) || !Number.isFinite(Number(content.totalCount))) { fail('INVALID_RESPONSE', 'listCardInfo'); }
    return { ...content, ...target };
  }
  // Fail local inputs (including existing output files) before remote writes.
  if (flags['--out'] && fs.existsSync(path.resolve(flags['--out']))) { fail('OUTPUT_EXISTS', flags['--out']); }
  if (action === 'create') {
    // Do not duplicate the same text into four locales: the platform stores this model in bounded columns.
    const locale = resolveContentLocale({ baseUrl: client.getAuthRef().baseUrl });
    const text = value => JSON.stringify({ type: 'i18n', [locale]: value });
    const params = { cardName: text(flags['--name']) };
    if (flags['--description'] !== undefined) { params.description = text(flags['--description']); }
    cardCode = await post('createCard', params);
    if (!cardValid(cardCode)) { fail('INVALID_RESPONSE', 'createCard returned no cardCode; inspect the list before retrying'); }
  }
  const urls = cardUrls(appType, cardCode, client.getAuthRef().baseUrl);
  let before;
  const draftMode = ['get', 'probe'].includes(action) ? !(flags['--published'] || flags['--version']) : true;
  try {
    before = await read(draftMode, action === 'get' ? flags['--version'] : undefined);
  } catch (error) {
    if (action === 'create') { error.details = { ...error.details, appType, cardCode, resourceCreated: true, urls }; }
    throw error;
  }
  const output = { ...target, cardCode, urls, card: before, draft: draftMode, schemaHash: schemaHash(before.schemaBody), readbackVerified: true };
  if (action.startsWith('release-') || action === 'refs') {
    return require('./data-card-release').executeRelease(parsed, client, {
      target: { ...target, cardCode, urls }, read, unwrap, schemaHash, backup, writeFile, fail,
    });
  }
  if (action === 'probe') {
    const probes = [];
    for (const item of buildReportProbeTargets(before.schemaBody, { reportId: cardCode })) {
      try {
        const response = await client.postFormOnce(`/${appType}/visual/visualizationDataRpc/getDataAsync.json`, {
          visualType: 'CARD', prdId: cardCode, pageId: cardCode, cid: item.cid, cname: item.className,
          dataSetKey: item.dataSetKey, draft: draftMode, enabledCache: false, timezone: 'GMT+8',
          queryContext: JSON.stringify({ aliasList: [], filterValueMap: {}, dim2table: true, orderByList: [],
            needTotalCount: item.className === 'YoushuTable', variableParams: {}, paging: { start: 0, limit: 100 } }),
        });
        const data = unwrap(response, 'getDataAsync');
        if (!data || !Array.isArray(data.data) || !Array.isArray(data.meta)) { fail('INVALID_RESPONSE', 'Expected runtime data and meta arrays'); }
        probes.push({ cid: item.cid, componentName: item.className, dataSetKey: item.dataSetKey, success: true, data });
      } catch (error) {
        probes.push({ cid: item.cid, componentName: item.className, dataSetKey: item.dataSetKey, success: false,
          code: error.code, message: error.message, ...error.details });
      }
    }
    if (!probes.length || probes.some(item => !item.success)) { fail('RUNTIME_QUERY_FAILED', 'One or more native card components failed runtime query', { cardCode, probes }); }
    return { ...output, runtimeQueryVerified: probes.length > 0, probes };
  }
  if (['get', 'create'].includes(action)) {
    if (flags['--out']) { output.schemaFile = writeFile(flags['--out'], before.schemaBody); }
    return output;
  }
  if (output.schemaHash !== flags['--expected-hash']) { fail('CONFLICT', t('data_card.conflict')); }
  const expected = action !== 'save' ? before.schemaBody : flags['--config']
    ? await appendIndicators(before.schemaBody, parseJson(fs.readFileSync(flags['--config'], 'utf8')), client, appType)
    : validateSchema(parseJson(fs.readFileSync(flags['--schema'], 'utf8')));
  assertCapacity(expected);
  const keys = action === 'save' ? i18nKeys(expected) : [];
  if (action === 'save' && keys.length) { expected.config = { ...expected.config, i18nKeyList: keys }; }
  // Full-schema replacement is intentional; callers must edit an exported schema and supply its original hash.
  const backupPath = backup({ appType, cardCode }, before, flags['--backup']);
  if (schemaHash((await read()).schemaBody) !== output.schemaHash) { fail('CONFLICT', t('data_card.conflict'), { backupPath }); }
  if (action === 'save') {
    if (schemaHash(keys) !== schemaHash(i18nKeys(before.schemaBody))) {
      unwrap(await client.postFormOnce(`/${appType}/query/appI18n/updateI18nBinding.json`, {
        targetType: 'dataCard', catalog1: cardCode, i18nKeyList: keys.join(','),
      }), 'updateI18nBinding');
    }
    const result = await post('updateCard', { cardCode, schemaBody: JSON.stringify(expected) });
    if (result !== true) { fail('INVALID_RESPONSE', 'updateCard', { backupPath }); }
    const after = await read();
    if (schemaHash(after.schemaBody) !== schemaHash(expected)) { fail('READBACK_MISMATCH', t('data_card.mismatch'), { backupPath, cardCode }); }
    return { ...output, card: after, schemaHash: schemaHash(after.schemaBody), backupPath, published: false };
  }
  const publishResult = await post('publishCard', { cardCode });
  const after = await read(false);
  if (after.status !== 'PUBLISHED' || !after.version || schemaHash(after.schemaBody) !== output.schemaHash) {
    fail('READBACK_MISMATCH', t('data_card.mismatch'), { backupPath, cardCode, publishResult });
  }
  return { ...output, card: after, draft: false, version: after.version, backupPath, published: true };
}
async function run(args = []) {
  const parsed = parseArgs(args);
  if (parsed.help) { console.log(t('data_card.usage')); return; }
  console.log(JSON.stringify(await execute(parsed), null, 2));
}
module.exports = { run, execute, parseArgs, validateSchema, schemaHash, cardUrls, appendIndicators };
