'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { getLogicflowDetail } = require('./integration-api');
const { extractNonEmptyDetail } = require('./integration-readback');
const { binding } = require('./integration-manage');
const { queryProcessVersions } = require('../process/services/process-service');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

function stable(value) {
  if (Array.isArray(value)) { return value.map(stable); }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function identity(auth, target) { return { baseUrl: auth.baseUrl, corpId: auth.corpId, ...target }; }
function location(auth, target) {
  return path.resolve('project/.cache/openyida/integration-baselines', `${hash(identity(auth, target))}.json`);
}
function fail(reason, details = {}) {
  throw new CliError(t('integration_baseline.failed', reason), {
    code: 'INTEGRATION_BASELINE_UNSAFE', details: { reason, remoteWrites: 0, ...details },
  });
}
function writePrivate(file, data, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
}
async function readState(auth, target) {
  const before = await binding(auth, target.appType, target.formUuid, target.processCode);
  const response = await getLogicflowDetail(auth, target);
  const viewJson = extractNonEmptyDetail(response);
  if (!viewJson?.schema?.children?.length) { fail('incomplete view definition'); }
  const versions = await queryProcessVersions(auth, target.appType, target.processCode, '', { pageSize: 1 });
  const content = typeof versions?.content === 'string' ? JSON.parse(versions.content) : versions?.content;
  const latest = content?.data?.[0];
  if (versions?.success !== true || !latest?.id || latest.version === undefined
    || !(latest.modifyTime || latest.modifiedTime || latest.gmtModified)) { fail('version stamp unavailable'); }
  return { viewJson, binding: before, version: latest,
    fingerprint: hash({ viewJson, ownership: { processCode: before.processCode, formUuid: before.formUuid },
      version: { id: latest.id, version: latest.version, modifiedTime: latest.modifyTime || latest.modifiedTime || latest.gmtModified } }) };
}
async function recordBaseline(auth, target, processJson, viewJson, nodeIdMap = {}) {
  const state = await readState(auth, target);
  if (!isDeepStrictEqual(stable(viewJson), stable(state.viewJson))) { fail('saved view differs from submitted definition'); }
  const record = { schemaVersion: 1, identity: identity(auth, target), processJson, viewJson,
    nodeIdMap, state, recordedAt: new Date().toISOString() };
  record.integrity = hash(record);
  const file = location(auth, target);
  writePrivate(file, record);
  return { available: true, baselinePath: file, fingerprint: state.fingerprint, flowStatus: state.binding.status };
}
function loadBaseline(auth, target) {
  const file = location(auth, target);
  if (!fs.existsSync(file)) { fail('trusted runtime baseline unavailable', { baselinePath: file }); }
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { integrity, ...rest } = record;
  if (hash(rest) !== integrity || !isDeepStrictEqual(record.identity, identity(auth, target))) { fail('baseline identity/integrity'); }
  return record;
}

module.exports = { hash, stable, identity, location, fail, writePrivate, readState, recordBaseline, loadBaseline };
