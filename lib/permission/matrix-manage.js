'use strict';

const fs = require('fs');
const { createAuthRef, createYidaClient } = require('../core/yida-client');
const { parse } = require('../integration/integration-manage');
const { queryFeature } = require('./matrix-availability');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');
const { hash } = require('../integration/integration-baseline');

function fail(reason, details = {}) {
  throw new CliError(t('matrix_manage.failed', reason), { code: 'MATRIX_MANAGE_FAILED', details });
}
async function run(args) {
  if (!args.length || args.includes('--help')) { console.log(t('matrix_manage.usage')); return; }
  const { positional, flags } = parse(args, ['file', 'page', 'limit', 'expect']);
  const [action, matrixId] = positional;
  if (!['list', 'detail', 'references', 'rows', 'create', 'update', 'delete', 'upsert-rows', 'delete-rows'].includes(action)
    || positional.length !== (['list', 'create'].includes(action) ? 1 : 2)) { fail('action/identity'); }
  const authRef = createAuthRef();
  const client = createYidaClient({ authRef });
  const call = async (endpoint, params, write = false) => {
    const response = await client[write ? 'postFormOnce' : 'get'](`/query/matrix/${endpoint}.json`, params);
    if (response?.success !== true) { fail(response?.errorMsg || endpoint, { retrySafe: !write }); }
    return response.content;
  };
  const page = Number(flags.page || 1), limit = Number(flags.limit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) { fail('pagination'); }
  const read = { list: 'getMatrixList', detail: 'getMatrixById', references: 'getMatrixCites', rows: 'getMatrixDataList' };
  let output;
  if (read[action]) {
    const content = await call(read[action], { ...(matrixId ? { matrixId } : {}), page, limit });
    output = { success: true, content, ...(action === 'detail' ? { fingerprint: hash(content) } : {
      page, limit, complete: Number.isInteger(content?.totalCount) && page === 1 && content.totalCount <= (content.data?.length || 0) }) };
  } else {
    const availability = await queryFeature(authRef, null, 'matrixManageEntry');
    if (availability.status !== 'available') { fail('matrix management unavailable/unknown', { availability, remoteWrites: 0 }); }
    const before = matrixId ? await call('getMatrixById', { matrixId }) : null;
    if (matrixId && (!before || before.matrixId !== matrixId)) { fail('matrix identity/readback'); }
    if (flags.expect && flags.expect !== hash(before)) { fail('matrix changed', { remoteWrites: 0 }); }
    let endpoint, params;
    const input = flags.file ? JSON.parse(fs.readFileSync(flags.file, 'utf8')) : null;
    if (action === 'create' || action === 'update') {
      if (!input || Array.isArray(input) || Object.keys(input).some(key => !['name', 'description', 'admins', 'content'].includes(key))) { fail('matrix config'); }
      const after = { ...(before || {}), ...input };
      if (!after.name || !after.description || !Array.isArray(after.admins) || !after.admins.length
        || !Array.isArray(after.content?.condition) || !after.content.condition.length
        || !Array.isArray(after.content?.result) || !after.content.result.length) { fail('complete matrix definition required'); }
      const columns = [...after.content.condition, ...after.content.result];
      if (columns.some(col => !col.columnId || !col.name || !col.componentType)
        || new Set(columns.map(col => col.columnId)).size !== columns.length) { fail('column IDs/types'); }
      endpoint = 'upsertMatrixInfo';
      params = Object.fromEntries(['name', 'description', 'admins', 'content'].map(key => [key, JSON.stringify(after[key])]));
      if (matrixId) { params.matrixId = matrixId; }
    } else if (action === 'delete') {
      const cites = await call('getMatrixCites', { matrixId, page: 1, limit: 1 });
      if (cites?.totalCount !== 0 || cites?.data?.length) { fail('matrix references exist/unknown', { remoteWrites: 0 }); }
      if (!flags.confirm && !flags['dry-run']) { fail('delete requires --confirm'); }
      endpoint = 'deleteMatrixById'; params = { matrixId };
    } else {
      if (!Array.isArray(input) || !input.length || input.length > 100) { fail('nonempty rows array <= 100 required'); }
      endpoint = action === 'upsert-rows' ? 'batchUpsertMatrixData' : 'batchDeleteMatrixData';
      if (action === 'delete-rows' && (input.some(id => typeof id !== 'string' || !id || /[,\s]/.test(id))
        || !flags.confirm && !flags['dry-run'])) { fail('row IDs and --confirm required'); }
      params = { matrixId, ...(action === 'upsert-rows' ? { dataJson: JSON.stringify(input) } : { rowIds: input.join(',') }) };
    }
    if (flags['dry-run']) { output = { success: true, dryRun: true, before, endpoint, params, remoteWrites: 0 }; }
    else {
      const result = await call(endpoint, params, true);
      const id = matrixId || result;
      const after = action === 'delete' ? await call('getMatrixById', { matrixId })
        : await call(action.endsWith('rows') ? 'getMatrixDataList' : 'getMatrixById', { matrixId: id, page, limit });
      output = { success: true, mutationAccepted: true, matrixId: id, content: after,
        verification: 'inspect_readback', runtimeVerified: false };
    }
  }
  console.log(JSON.stringify(output, null, 2)); return output;
}

module.exports = { run };
