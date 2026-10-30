'use strict';

const fs = require('fs');
const { createAuthRef, createYidaClient } = require('../core/yida-client');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

function fail(reason, details = {}) {
  throw new CliError(t('integration_manage.failed', reason), {
    code: 'INTEGRATION_MANAGE_FAILED', details,
  });
}

function parse(args, options = [], booleans = []) {
  const positional = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (Object.hasOwn(flags, key) || ![...options, ...booleans, 'json', 'dry-run', 'confirm'].includes(key)) { fail(`argument: ${args[i]}`); }
    if ([...booleans, 'json', 'dry-run', 'confirm'].includes(key)) { flags[key] = true; }
    else if (!args[i + 1] || args[i + 1].startsWith('--')) { fail(`value: ${key}`); }
    else { flags[key] = args[++i]; }
  }
  return { positional, flags };
}

async function request(authRef, appType, endpoint, params, write = false) {
  const client = createYidaClient({ authRef });
  const response = await client[write ? 'postFormOnce' : 'get'](
    `/alibaba/web/${encodeURIComponent(appType)}/query/formLogicflowBinding/${endpoint}.json`, params
  );
  if (!response || response.success !== true) { fail(response?.errorMsg || endpoint,
    { mutationAttempted: write, retrySafe: !write, nextStep: write ? 'Inspect remote state before retrying.' : undefined }); }
  return response.content;
}

async function binding(auth, appType, formUuid, processCode) {
  const content = await request(auth, appType, 'listFlowByProcessCodes', { processCodes: processCode });
  if (!Array.isArray(content?.data)) { fail('binding readback incomplete'); }
  const candidates = content.data.filter(item => item.processCode === processCode);
  if (candidates.length !== 1 || candidates[0].formUuid !== formUuid) { fail('binding ownership mismatch'); }
  return candidates[0];
}

async function run(action, args) {
  if (args.includes('--help') || !args.length) {
    console.log(t('integration_manage.usage')); return;
  }
  const { positional, flags } = parse(args, ['name', 'file']);
  const [appType, formUuid, processCode] = positional;
  const auth = createAuthRef();
  let output;
  if (action === 'monitor') {
    if (positional.length !== 1) { fail('monitor <appType> [--file config.json]'); }
    const before = await request(auth, appType, 'getErrorMonitor', {});
    const limits = await request(auth, appType, 'getErrorMonitorLimitForVersion', {});
    if (!Array.isArray(before)) { fail('monitor readback incomplete'); }
    if (!flags.file) { output = { success: true, monitors: before, limits }; }
    else {
      const config = JSON.parse(fs.readFileSync(flags.file, 'utf8'));
      const keys = ['processCodes', 'uuid', 'intervalTime', 'receiverIds', 'status'];
      if (!config || Array.isArray(config) || Object.keys(config).some(key => !keys.includes(key))
        || !['y', 'n'].includes(config.status) || !Number.isInteger(config.intervalTime) || config.intervalTime < 5
        || !Array.isArray(config.processCodes) || !config.processCodes.length
        || !Array.isArray(config.receiverIds) || !config.receiverIds.length
        || [...config.processCodes, ...config.receiverIds].some(id => typeof id !== 'string' || !id || /[,\s]/.test(id))
        || config.uuid && before.filter(item => item.uuid === config.uuid).length !== 1) { fail('monitor config'); }
      const flows = await request(auth, appType, 'listFlowByProcessCodes', { processCodes: config.processCodes.join(',') });
      if (!Array.isArray(flows?.data) || config.processCodes.some(code => flows.data.filter(item => item.processCode === code).length !== 1)) {
        fail('monitor process ownership unknown');
      }
      const check = await request(auth, appType, 'checkErrorMonitorLimit', {});
      if (!config.uuid && check !== true) { fail('monitor limit reached/unknown'); }
      const params = { ...config, processCodes: config.processCodes.join(','), receiverIds: config.receiverIds.join(',') };
      if (flags['dry-run']) { output = { success: true, dryRun: true, remoteWrites: 0, before, after: config, limits }; }
      else {
        await request(auth, appType, 'saveErrorMonitor', params, true);
        const after = await request(auth, appType, 'getErrorMonitor', {});
        const split = value => (Array.isArray(value) ? value : String(value || '').split(',')).filter(Boolean).sort().join(',');
        const candidates = Array.isArray(after) ? after.filter(item => config.uuid ? item.uuid === config.uuid
          : !before.some(old => old.uuid === item.uuid)) : [];
        const matches = candidates.filter(item => split(item.processCodes) === (config.status === 'n' ? '' : split(config.processCodes))
          && split(item.receiverIds) === split(config.receiverIds) && Number(item.intervalTime) === config.intervalTime
          && item.status === config.status);
        if (matches.length !== 1) { fail('monitor readback mismatch/unknown', { mutationAccepted: true, retrySafe: false }); }
        output = { success: true, mutationAccepted: true, monitor: matches[0], readbackVerified: true, runtimeVerified: false };
      }
    }
  } else if (['copy', 'rename', 'delete'].includes(action)) {
    if (positional.length !== 3 || action !== 'delete' && (!flags.name || flags.name.length > 30)) { fail('target/name'); }
    const before = await binding(auth, appType, formUuid, processCode);
    const type = String(before.type || before.flowType || before.eventType || '1');
    if (!['1', '2', '3', '5', '6'].includes(type)) { fail('flow type'); }
    if (action === 'delete' && (before.status !== 'n' || !flags.confirm && !flags['dry-run'])) {
      fail('delete requires disabled flow and --confirm');
    }
    const params = { formUuid, processCode, type, ...(flags.name ? { name: flags.name } : {}) };
    if (flags['dry-run']) { output = { success: true, dryRun: true, remoteWrites: 0, action, before, params }; }
    else {
      const content = await request(auth, appType, { copy: 'copyflow', rename: 'updateflow', delete: 'deleteflow' }[action], params, true);
      output = { success: true, action, mutationAccepted: true, content, runtimeVerified: false };
      if (action === 'rename') {
        const after = await binding(auth, appType, formUuid, processCode);
        if ((after.name || after.flowName) !== flags.name) { fail('rename verification failed', { mutationAccepted: true }); }
        output.readbackVerified = true;
      } else if (action === 'delete') {
        const after = await request(auth, appType, 'listFlowByProcessCodes', { processCodes: processCode });
        if (!Array.isArray(after?.data) || after.data.some(item => item.processCode === processCode)) {
          fail('delete verification failed', { mutationAccepted: true });
        }
        output.readbackVerified = true;
      } else {
        if (!content?.processCode || content.processCode === processCode) { fail('copy identity unknown', { mutationAccepted: true }); }
        let after = await binding(auth, appType, formUuid, content.processCode);
        // Some platform deployments ignore copyflow.name and always append _COPY.
        // Rename only the newly returned identity, never replay the copy operation.
        if ((after.name || after.flowName) !== flags.name) {
          await request(auth, appType, 'updateflow', { formUuid, processCode: content.processCode, type, name: flags.name }, true);
          after = await binding(auth, appType, formUuid, content.processCode);
        }
        if ((after.name || after.flowName) !== flags.name) { fail('copy name verification failed', {
          mutationAccepted: true, processCode: content.processCode, retrySafe: false }); }
        output.content = { ...content, name: after.name || after.flowName };
        if (after.status !== 'n') { fail('copy must remain disabled', { mutationAccepted: true }); }
        output.readbackVerified = true;
      }
    }
  } else { fail('action'); }
  console.log(JSON.stringify(output, null, 2));
  return output;
}

module.exports = { run, parse, request, binding };
