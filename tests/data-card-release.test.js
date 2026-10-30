'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execute, parseArgs, schemaHash } = require('../lib/app/data-card');
const { validateConfig } = require('../lib/app/data-card-release');
const { flattenCommandManifest } = require('../lib/core/command-manifest');

const app = 'APP_TEST', card = 'CARD-abc', prefix = `/${app}/visual/dataCardRpc/`;
const schema = { pages: [{ componentsTree: [{ componentName: 'Page', id: 'page' }] }] };
let dir, client, stored, published;
const tomorrow = () => new Date(Date.now() + 2 * 86400000 + 28800000).toISOString().slice(0, 10) + ' 09:00';
const config = (enabled = false) => ({ enableCardRelease: enabled, schedule: { startDate: tomorrow(), repeat: 'DAILY', maxCount: 3 },
  workIds: [{ id: 'operator', name: 'Operator' }], groupIds: [], messageText: 'Synthetic verification', jumpUrl: '' });
function argv(action, flags = []) { return parseArgs([action, app, card, ...flags]); }
function file(value, name = 'config.json') { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(value)); return f; }
function save(value = config(), hash = schemaHash(null), extra = []) {
  return argv('release-save', ['--config', file(value), '--expected-hash', hash, '--backup', path.join(dir, 'backup.json'), ...extra]);
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-release-')); stored = null; published = true;
  client = {
    getAuthRef: () => ({ baseUrl: 'https://tenant.aliwork.com' }),
    get: jest.fn(async (url, params) => {
      if (url.endsWith('getCardSchema.json')) { return { success: true, content: { cardCode: card, appType: app, schemaBody: schema,
        status: published ? 'PUBLISHED' : 'UNPUBLISHED', version: published ? '2' : null } }; }
      if (url.endsWith('getCardPushConfig.json')) { return { success: true, content: stored || {} }; }
      if (url.endsWith('queryCardRef.json')) { return { success: true, content: { data: [{ cardCode: card, refererCode: 'FORM-portal' }], currentPage: params.currentPage, totalCount: 3 } }; }
      return { success: true, content: {} };
    }),
    postFormOnce: jest.fn(async (url, params) => {
      if (url.endsWith('testDataCardPush.json')) { return { success: true, content: true }; }
      stored = { ...params, uuid: params.uuid || 'push-real', coolAppCode: 'cool-real' };
      delete stored.cardCode;
      return { success: true, content: { uuid: stored.uuid, coolAppCode: 'cool-real' } };
    }),
  };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('reads absent config and exports null without inventing recipients or a schedule', async () => {
  const output = path.join(dir, 'out.json');
  const result = await execute(argv('release-get', ['--out', output]), client);
  expect(result).toMatchObject({ configured: false, releaseConfig: null, releaseHash: schemaHash(null), readbackVerified: true });
  expect(result.urls.releaseUrl).toBe(`https://tenant.aliwork.com/${app}/admin/${card}/dataCardRelease`);
  expect(JSON.parse(fs.readFileSync(output))).toBeNull();
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('saves disabled configuration with native serialized parameters, backup and readback', async () => {
  const result = await execute(save(), client);
  expect(result).toMatchObject({ scheduled: false, deliveryVerified: false, readbackVerified: true, publishedVersion: '2', uuid: 'push-real' });
  const [url, body] = client.postFormOnce.mock.calls[0];
  expect(url).toBe(prefix + 'saveCardPushConfig.json');
  expect(JSON.parse(body.workIds)).toEqual([{ id: 'operator', name: 'Operator' }]);
  expect(JSON.parse(body.groupIds)).toEqual([]);
  expect(JSON.parse(body.repeatRule)).toMatchObject({ triggerId: app, triggerType: 'TimerEvent', repeatRuleType: 'DAILY', overTimeType: 'count', overCount: 3 });
  expect(JSON.parse(fs.readFileSync(result.backupPath)).card.release).toEqual({});
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
  expect(client.get.mock.calls.some(([url]) => url.includes('checkDataCardPushCount'))).toBe(false);
});
test('enabling requires explicit send flag; entitlement check precedes single write', async () => {
  await expect(execute(save(config(true)), client)).rejects.toMatchObject({ code: 'DATA_CARD_SEND_CONFIRMATION_REQUIRED' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
  const result = await execute(save(config(true), schemaHash(null), ['--allow-send']), client);
  expect(result.scheduled).toBe(true);
  expect(client.get.mock.calls.some(([url]) => url.endsWith('checkDataCardPushCount.json'))).toBe(true);
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});
test('native end-date rules retain datetime semantics and group setup is not delivery evidence', async () => {
  const value = config(true); value.workIds = []; value.groupIds = ['cid-real'];
  delete value.schedule.maxCount; value.schedule.endDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) + ' 18:00';
  const result = await execute(save(value, schemaHash(null), ['--allow-send']), client);
  expect(result).toMatchObject({ groupInstallationRequired: true, coolAppCode: 'cool-real', deliveryVerified: false });
  expect(result.releaseConfig.repeatRule.overTimeType).toBe('time');
});
test('readback config can be edited and disabled using server UUID without enabling or testing', async () => {
  await execute(save(config(true), schemaHash(null), ['--allow-send']), client);
  const read = await execute(argv('release-get'), client);
  const value = { ...read.releaseConfig, enableCardRelease: false };
  const result = await execute(argv('release-save', ['--config', file(value), '--expected-hash', read.releaseHash,
    '--backup', path.join(dir, 'second-backup.json')]), client);
  expect(result.scheduled).toBe(false);
  expect(client.postFormOnce.mock.calls[1][1].uuid).toBe('push-real');
  expect(client.postFormOnce.mock.calls.some(([url]) => url.includes('testDataCardPush'))).toBe(false);
});
test('stale hash and a concurrent change both stop the write', async () => {
  await expect(execute(save(config(), '0'.repeat(64)), client)).rejects.toMatchObject({ code: 'DATA_CARD_RELEASE_CONFLICT' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
  const base = client.get.getMockImplementation(); let count = 0;
  client.get.mockImplementation(async (...args) => {
    if (args[0].includes('getCardPushConfig') && ++count === 2) {
      return { success: true, content: { uuid: 'other', ...validateConfig(config(), app) } };
    }
    return base(...args);
  });
  await expect(execute(save(), client)).rejects.toMatchObject({ code: 'DATA_CARD_RELEASE_CONFLICT' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('unpublished cards and platform quota denial never save or send', async () => {
  published = false;
  await expect(execute(save(), client)).rejects.toMatchObject({ code: 'DATA_CARD_NOT_PUBLISHED' });
  published = true;
  const base = client.get.getMockImplementation();
  client.get.mockImplementation(async (...args) => args[0].includes('checkDataCardPushCount')
    ? { success: false, errorCode: 'EDGE_990405', errorMsg: 'Upgrade required' } : base(...args));
  await expect(execute(save(config(true), schemaHash(null), ['--allow-send']), client)).rejects.toMatchObject({ details: { platformErrorCode: 'EDGE_990405' } });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('write timeout is not retried and provides a recovery instruction', async () => {
  client.postFormOnce.mockRejectedValue(new Error('timeout'));
  await expect(execute(save(), client)).rejects.toMatchObject({ details: { writeAttempted: true, cardCode: card, recovery: expect.any(String) } });
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});
test('platform cool-app initialization failure after save retains acceptance and disables blind retries', async () => {
  const base = client.get.getMockImplementation();
  client.get.mockImplementation(async (...args) => args[0].includes('getCardPushConfig') && stored
    ? { success: false, errorCode: '500', errorMsg: 'Create cool app failed: illegal parameter' } : base(...args));
  await expect(execute(save(), client)).rejects.toMatchObject({ code: 'DATA_CARD_API_ERROR', details: {
    platformErrorCode: '500', writeAccepted: true, readbackVerified: false, uuid: 'push-real', requestedEnabled: false,
  } });
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
});
test('release read errors remain failures and are never interpreted as unconfigured', async () => {
  const base = client.get.getMockImplementation();
  client.get.mockImplementation(async (...args) => args[0].includes('getCardPushConfig')
    ? { success: false, errorCode: '500', errorMsg: 'illegal parameter' } : base(...args));
  await expect(execute(argv('release-get'), client)).rejects.toMatchObject({ code: 'DATA_CARD_API_ERROR', details: {
    platformErrorCode: '500', nativeReadMayInitializeCoolApp: true,
  } });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('mismatching readback and false test acceptance are failures', async () => {
  client.postFormOnce.mockResolvedValue({ success: true, content: { uuid: 'not-saved' } });
  await expect(execute(save(), client)).rejects.toMatchObject({ code: 'DATA_CARD_READBACK_MISMATCH' });
  client.postFormOnce.mockResolvedValue({ success: true, content: false });
  await expect(execute(argv('release-test', ['--allow-send']), client)).rejects.toMatchObject({ code: 'DATA_CARD_INVALID_RESPONSE' });
});
test('test only sends to current operator and reports async acceptance, never delivery', async () => {
  expect(() => argv('release-test')).toThrow();
  const result = await execute(argv('release-test', ['--allow-send', '--config', file({ messageText: 'Test' })]), client);
  expect(result).toMatchObject({ accepted: true, recipientScope: 'current_operator', deliveryVerified: false });
  expect(client.postFormOnce.mock.calls).toEqual([[prefix + 'testDataCardPush.json', { cardCode: card, jumpUrl: '', messageText: 'Test' }]]);
});
test('published state/entitlement check and usage pagination use their own APIs', async () => {
  expect(await execute(argv('release-check'), client)).toMatchObject({ eligible: true, deliveryVerified: false });
  expect(await execute(argv('refs', ['--page', '2', '--size', '5']), client)).toMatchObject({ currentPage: 2, totalCount: 3 });
  expect(client.get.mock.calls.at(-1)).toEqual([prefix + 'queryCardRef.json', { cardCode: card, currentPage: 2, pageSize: 5 }]);
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test.each([
  value => { value.groupIds = ['a', 'b']; }, value => { value.workIds = []; },
  value => { value.workIds = [{ id: 'a' }, { id: 'a' }]; }, value => { value.schedule.maxCount = 201; },
  value => { value.schedule.repeat = 'CUSTOM'; }, value => { value.schedule.repeat = 'HOURLY'; },
  value => { value.schedule.startDate = '2026-02-30 09:00'; }, value => { value.schedule.startDate = '2026-11-01 05:00'; },
  value => { value.jumpUrl = 'javascript:alert(1)'; }, value => { value.messageText = 'a'.repeat(101); },
  value => { value.appTag = 'bypass'; }, value => { value.enableCardRelease = 'false'; },
])('rejects malformed configuration without a write', async edit => {
  const value = config(); edit(value);
  await expect(execute(save(value), client)).rejects.toMatchObject({ code: 'DATA_CARD_INVALID_RELEASE_CONFIG' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('test rejects recipient overrides and save rejects an old first-send date', async () => {
  await expect(execute(argv('release-test', ['--allow-send', '--config', file({ workIds: ['someone'] })]), client)).rejects.toMatchObject({ code: 'DATA_CARD_INVALID_RELEASE_CONFIG' });
  const value = config(); value.schedule.startDate = '2020-01-01 09:00';
  await expect(execute(save(value), client)).rejects.toMatchObject({ code: 'DATA_CARD_INVALID_RELEASE_CONFIG' });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});
test('agent policy requires explicit authorization for broadcast save and test', () => {
  const entry = flattenCommandManifest().find(entry => entry.id === 'data-card');
  expect(entry.permission.ask_actions).toEqual(expect.arrayContaining(['release-save', 'release-test']));
  expect(entry.sideEffect.mutating_actions).toContain('release-get');
  expect(entry.sideEffect.read_actions).toEqual(expect.arrayContaining(['release-check', 'refs']));
});
