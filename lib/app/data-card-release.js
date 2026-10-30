'use strict';

const fs = require('fs');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const REPEATS = ['DAILY', 'WORKDAY', 'LEGAL_WORKDAY', 'WEEKLY', 'BI_WEEKLY', 'MONTHLY',
  'LAST_DAY_PER_MONTH', 'LAST_WORKDAY_PER_MONTH', 'LAST_LEGAL_WORKDAY_PER_MONTH', 'YEARLY'];
const CONFIG_KEYS = ['enableCardRelease', 'repeatRule', 'schedule', 'workIds', 'groupIds', 'jumpUrl', 'messageText'];
function invalid(detail) {
  throw new CliError(t('data_card.failed', detail), { code: 'DATA_CARD_INVALID_RELEASE_CONFIG', details: { reason: detail } });
}
function json(value, label) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return invalid(label); }
}
function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) { invalid(label); }
}
function text(value, label, max = 100) {
  if (typeof value !== 'string' || value.length > max) { invalid(label); }
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) { invalid('Use YYYY-MM-DD HH:mm in Asia/Shanghai'); }
  const result = Date.parse(value.replace(' ', 'T') + ':00+08:00');
  if (!Number.isFinite(result) || new Date(result + 28800000).toISOString().slice(0, 16).replace('T', ' ') !== value) { invalid('Invalid calendar date'); }
  return result;
}
function buildRule(schedule, appType) {
  keys(schedule, ['startDate', 'repeat', 'maxCount', 'endDate'], 'schedule');
  if ((schedule.maxCount === undefined) === (schedule.endDate === undefined)) { invalid('Choose maxCount or endDate'); }
  return { startDate: timestamp(schedule.startDate), repeatRuleType: schedule.repeat || 'DAILY',
    overTimeType: schedule.endDate === undefined ? 'count' : 'time',
    ...(schedule.endDate === undefined ? { overCount: schedule.maxCount } : { overTime: schedule.endDate }),
    type: 'trigger', triggerType: 'TimerEvent', triggerId: appType };
}
function validateRule(rule, appType) {
  keys(rule, ['startDate', 'repeatRuleType', 'repeatRuleText', 'monthRuleType', 'month', 'dateRuleType', 'day', 'week',
    'hourRuleType', 'hour', 'minute', 'overTimeType', 'overTime', 'overCount', 'type', 'triggerType', 'triggerId'], 'repeatRule');
  if (!Number.isSafeInteger(rule.startDate) || !REPEATS.includes(rule.repeatRuleType)
    || rule.startDate < 0 || rule.startDate > 8640000000000000 - 28800000
    || rule.triggerId !== undefined && rule.triggerId !== appType
    || rule.triggerType !== undefined && rule.triggerType !== 'TimerEvent'
    || rule.type !== undefined && rule.type !== 'trigger') { invalid('repeatRule identity/startDate/repeatRuleType'); }
  if (!['count', 'time'].includes(rule.overTimeType)
    || rule.overTimeType === 'count' && (!Number.isInteger(rule.overCount) || rule.overCount < 1 || rule.overCount > 200)
    || rule.overTimeType === 'time' && timestamp(rule.overTime) <= rule.startDate) { invalid('End after 1..200 runs or a later endDate'); }
  const hour = new Date(rule.startDate + 28800000).getUTCHours();
  if (hour < 7) { invalid('Broadcast start time must be 07:00..23:59 Asia/Shanghai'); }
  return rule;
}
function validateConfig(value, appType) {
  keys(value, CONFIG_KEYS, 'release config keys');
  if (typeof value.enableCardRelease !== 'boolean' || (!!value.repeatRule === !!value.schedule)) { invalid('enableCardRelease and exactly one schedule/repeatRule required'); }
  const workIds = value.workIds || [];
  const groupIds = value.groupIds || [];
  if (!Array.isArray(workIds) || workIds.length > 10 || !Array.isArray(groupIds) || groupIds.length > 1
    || !workIds.length && !groupIds.length) { invalid('Choose 1..10 users and/or one group'); }
  const ids = [];
  for (const user of workIds) {
    keys(user, ['id', 'name', 'label'], 'workIds entries');
    if (typeof user.id !== 'string' || !user.id.trim() || ids.includes(user.id)) { invalid('Unique organization user id required'); }
    ids.push(user.id);
    for (const key of ['name', 'label']) { if (user[key] !== undefined) { text(user[key], `workIds.${key}`, 200); } }
  }
  if (groupIds.some(id => typeof id !== 'string' || !id.trim())) { invalid('groupIds'); }
  const jumpUrl = text(value.jumpUrl ?? '', 'jumpUrl');
  if (jumpUrl) {
    let url;
    try { url = new URL(jumpUrl); } catch { invalid('jumpUrl must be an absolute HTTP(S) URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) { invalid('jumpUrl must be an absolute HTTP(S) URL without credentials'); }
  }
  return { enableCardRelease: value.enableCardRelease,
    repeatRule: validateRule(value.schedule ? buildRule(value.schedule, appType) : value.repeatRule, appType),
    workIds, groupIds, jumpUrl, messageText: text(value.messageText ?? '', 'messageText') };
}
function normalizeStored(value) {
  if (value === null || value === undefined || object(value) && !Object.keys(value).length) { return null; }
  if (!object(value) || typeof value.uuid !== 'string' || !value.uuid || typeof value.enableCardRelease !== 'boolean') { invalid('Malformed server release configuration'); }
  const repeatRule = json(value.repeatRule, 'server repeatRule');
  const workIds = json(value.workIds, 'server workIds');
  const groupIds = json(value.groupIds, 'server groupIds');
  if (!object(repeatRule) || !Array.isArray(workIds) || !Array.isArray(groupIds)) { invalid('Malformed server release configuration'); }
  return { uuid: value.uuid, enableCardRelease: value.enableCardRelease, repeatRule, workIds, groupIds,
    jumpUrl: value.jumpUrl ?? '', messageText: value.messageText ?? '' };
}
function loadConfig(filename) { return json(fs.readFileSync(filename, 'utf8'), 'config JSON'); }

async function executeRelease(parsed, client, helpers) {
  const { action, appType, cardCode, flags } = parsed;
  const { target, read, unwrap, schemaHash, backup, writeFile, fail } = helpers;
  const prefix = `/${appType}/visual/dataCardRpc/`;
  const get = async (endpoint, params = {}) => {
    try { return unwrap(await client.get(`${prefix}${endpoint}.json`, { cardCode, ...params }), endpoint); }
    catch (error) {
      if (endpoint === 'getCardPushConfig') {
        error.details = { ...error.details, nativeReadMayInitializeCoolApp: true,
          recovery: 'The native read may initialize a cool app. Resolve the platform read error before saving again; do not treat it as an empty configuration.' };
      }
      throw error;
    }
  };
  const post = async (endpoint, params) => unwrap(await client.postFormOnce(`${prefix}${endpoint}.json`, { cardCode, ...params }), endpoint);
  const ensurePublished = async () => {
    const card = await read(false);
    if (card.status !== 'PUBLISHED' || !card.version) { fail('NOT_PUBLISHED', 'Publish the native card before distribution'); }
    return card.version;
  };
  if (action === 'refs') {
    const content = await get('queryCardRef', { currentPage: Number(flags['--page'] || 1), pageSize: Number(flags['--size'] || 20) });
    if (!object(content) || !Array.isArray(content.data) || !Number.isFinite(Number(content.totalCount))
      || content.data.some(ref => ref.cardCode && ref.cardCode !== cardCode)) { fail('INVALID_RESPONSE', 'queryCardRef'); }
    return { ...content, ...target, readbackVerified: true };
  }
  if (action === 'release-check') {
    const version = await ensurePublished();
    await get('checkDataCardPushCount');
    return { ...target, eligible: true, publishedVersion: version, deliveryVerified: false };
  }
  if (action === 'release-test') {
    if (!flags['--allow-send']) { fail('SEND_CONFIRMATION_REQUIRED', '--allow-send'); }
    const config = flags['--config'] ? loadConfig(flags['--config']) : {};
    keys(config, ['jumpUrl', 'messageText'], 'Test config only accepts jumpUrl/messageText; recipient is the current operator');
    const jumpUrl = text(config.jumpUrl ?? '', 'jumpUrl');
    if (jumpUrl) {
      let url;
      try { url = new URL(jumpUrl); } catch { invalid('jumpUrl'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { invalid('jumpUrl'); }
    }
    const messageText = text(config.messageText ?? '', 'messageText');
    const version = await ensurePublished();
    const result = await post('testDataCardPush', { jumpUrl, messageText });
    if (result !== true) { fail('INVALID_RESPONSE', 'testDataCardPush'); }
    return { ...target, accepted: true, publishedVersion: version, recipientScope: 'current_operator', deliveryVerified: false };
  }
  // Validate local inputs before saving or performing any entitlement preflight.
  const expected = action === 'release-save' ? validateConfig(loadConfig(flags['--config']), appType) : null;
  if (expected?.enableCardRelease && !flags['--allow-send']) { fail('SEND_CONFIRMATION_REQUIRED', 'Enabling scheduled broadcasts requires --allow-send'); }
  const raw = await get('getCardPushConfig');
  const before = normalizeStored(raw);
  const releaseHash = schemaHash(before);
  if (action === 'release-get') {
    const releaseConfig = before ? Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'uuid')) : null;
    const output = { ...target, releaseConfig, releaseHash, configured: !!before, rawRelease: raw, readbackVerified: true };
    if (flags['--out']) { output.configFile = writeFile(flags['--out'], releaseConfig); }
    return output;
  }
  if (releaseHash !== flags['--expected-hash']) { fail('RELEASE_CONFLICT', 'Broadcast configuration changed; read release-get again'); }
  // New records require tomorrow or later, even when initially saved as disabled.
  const now = Date.now();
  if (!before || expected.enableCardRelease && schemaHash(expected.repeatRule) !== schemaHash(before.repeatRule)) {
    const tomorrow = Math.floor((now + 28800000) / 86400000) * 86400000 + 86400000 - 28800000;
    if (expected.repeatRule.startDate < tomorrow || expected.repeatRule.startDate > now + 365 * 86400000) { invalid('First send must be tomorrow or later, within one year'); }
  }
  if (expected.enableCardRelease && expected.repeatRule.overTimeType === 'time'
    && timestamp(expected.repeatRule.overTime) > now + 365 * 86400000) { invalid('End date must be within one year'); }
  const version = await ensurePublished();
  if (expected.enableCardRelease && !before?.enableCardRelease) { await get('checkDataCardPushCount'); }
  const backupPath = backup({ appType, cardCode, kind: 'data-card-release' }, { release: raw, releaseHash }, flags['--backup']);
  if (schemaHash(normalizeStored(await get('getCardPushConfig'))) !== releaseHash) { fail('RELEASE_CONFLICT', 'Broadcast configuration changed', { backupPath }); }
  const params = { ...expected, repeatRule: JSON.stringify(expected.repeatRule), workIds: JSON.stringify(expected.workIds), groupIds: JSON.stringify(expected.groupIds),
    ...(before ? { uuid: before.uuid } : {}) };
  let result;
  try { result = await post('saveCardPushConfig', params); }
  catch (error) {
    error.details = { ...error.details, backupPath, cardCode, writeAttempted: true,
      recovery: 'Read release-get before retrying; the server may have changed the schedule.' };
    throw error;
  }
  if (!object(result) || typeof result.uuid !== 'string' || !result.uuid || before && result.uuid !== before.uuid) { fail('INVALID_RESPONSE', 'saveCardPushConfig', { backupPath, writeAttempted: true }); }
  let afterRaw, after;
  try {
    afterRaw = await get('getCardPushConfig');
    after = normalizeStored(afterRaw);
  } catch (error) {
    error.details = { ...error.details, backupPath, cardCode, writeAttempted: true,
      writeAccepted: true, readbackVerified: false, uuid: result.uuid,
      requestedEnabled: expected.enableCardRelease,
      recovery: 'Do not save again automatically. Inspect the release page and getCardPushConfig error; the platform may initialize a cool app during readback.' };
    throw error;
  }
  if (schemaHash(after) !== schemaHash({ uuid: result.uuid, ...expected })) { fail('READBACK_MISMATCH', 'Broadcast configuration readback differs', { backupPath, writeAttempted: true }); }
  return { ...target, releaseConfig: expected, releaseHash: schemaHash(after), uuid: result.uuid, backupPath,
    readbackVerified: true, scheduled: expected.enableCardRelease, publishedVersion: version,
    groupInstallationRequired: expected.enableCardRelease && expected.groupIds.length > 0,
    coolAppCode: result.coolAppCode || afterRaw.coolAppCode || '', deliveryVerified: false };
}

module.exports = { executeRelease, validateConfig, normalizeStored, buildRule, REPEATS };
