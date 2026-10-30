'use strict';

const { createAuthRef, createYidaClient } = require('../core/yida-client');
const { parse } = require('../integration/integration-manage');
const { normalizePackageType } = require('./package-type');
const { fetchAllPermitPackages } = require('./permit-package-service');
const { savePermitPackage, verifyPackageDimensions } = require('./save-permission');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

function fail(reason, details = {}) {
  throw new CliError(t('permission_manage.failed', reason), { code: 'PERMISSION_MANAGE_FAILED', details });
}
async function run(args) {
  if (!args.length || args.includes('--help')) { console.log(t('permission_manage.usage')); return; }
  const { positional, flags } = parse(args, ['name', 'package-type']);
  const [action, appType, formUuid, packageUuid] = positional;
  if (positional.length !== 4 || !['copy', 'rename', 'delete'].includes(action)
    || action === 'rename' && !flags.name || flags.name && flags.name.length > 100) { fail('target/name'); }
  const packageType = normalizePackageType(flags['package-type']);
  const auth = createAuthRef();
  const list = () => fetchAllPermitPackages(appType, formUuid, auth, { packageType }).then(result => result.packages);
  const before = await list();
  const original = before.find(item => item.packageUuid === packageUuid);
  if (!original) { fail('package ownership/identity'); }
  if (action === 'copy' && !flags.name) {
    if (flags['dry-run']) {
      const output = { success: true, dryRun: true, remoteWrites: 0, action, packageUuid,
        copyMode: 'native_same_form', sourceName: original.packageName };
      console.log(JSON.stringify(output, null, 2)); return output;
    }
    const response = await createYidaClient({ authRef: auth }).postFormOnce(
      `/${appType}/permission/manage/copyPermitPkgNewToForm.json`, { packageUuid, formUuids: formUuid });
    if (response?.success !== true) { fail(response?.errorMsg || 'native copy outcome unknown', { retrySafe: false }); }
    const packages = await list();
    const candidates = packages.filter(item => !before.some(old => old.packageUuid === item.packageUuid));
    const matches = candidates.filter(item => !verifyPackageDimensions(original, original, item,
      ['roleData', 'dataPermit', 'operatePermit', 'fieldPermit']).mismatches.length);
    if (matches.length !== 1) { fail('native copy identity/readback unknown', { mutationAccepted: true, retrySafe: false }); }
    const output = { success: true, action, packageUuid: matches[0].packageUuid, copyMode: 'native_same_form',
      verification: 'identity_and_visible_dimensions', unreadableDimensionsVerified: false, runtimeVerified: false };
    console.log(JSON.stringify(output, null, 2)); return output;
  }
  const name = { zh_CN: flags.name, en_US: flags.name, type: 'i18n' };
  const after = { ...original, packageName: name };
  if (action === 'copy') { delete after.packageUuid; }
  if (action !== 'delete' && (original.roleDataComplete === false
    || ['roleData', 'dataPermit', 'operatePermit', 'fieldPermit', 'viewData', 'customButtonPermit'].some(key => original[key] === undefined))) {
    fail('full package definition unavailable', { remoteWrites: 0 });
  }
  if (flags['dry-run']) {
    const output = { success: true, dryRun: true, action, remoteWrites: 0, before: original, after: action === 'delete' ? null : after };
    console.log(JSON.stringify(output, null, 2)); return output;
  }
  if (action === 'delete' && !flags.confirm) { fail('delete requires --confirm', { remoteWrites: 0 }); }
  let response;
  if (action === 'delete') {
    response = await createYidaClient({ authRef: auth }).postFormOnce(
      `/${appType}/permission/permit/removePermitPkg.json`, { packageUuid });
  } else { response = await savePermitPackage(appType, formUuid, after, null, auth, { oneShot: true }); }
  if (response?.success !== true) { fail(response?.errorMsg || 'write outcome unknown', { retrySafe: false }); }
  const packages = await list();
  let current;
  if (action === 'delete') {
    if (packages.some(item => item.packageUuid === packageUuid)) { fail('delete readback mismatch', { mutationAccepted: true }); }
  } else {
    const candidates = action === 'rename' ? packages.filter(item => item.packageUuid === packageUuid)
      : packages.filter(item => !before.some(old => old.packageUuid === item.packageUuid));
    const expected = { ...after, packageType };
    const fields = ['roleData', 'dataPermit', 'operatePermit', 'fieldPermit', 'viewData', 'customButtonPermit'];
    const matches = candidates.filter(item => {
      const itemName = typeof item.packageName === 'string' ? JSON.parse(item.packageName) : item.packageName;
      return itemName?.zh_CN === flags.name && !verifyPackageDimensions(original, expected, item, fields).mismatches.length;
    });
    if (matches.length !== 1) { fail('copy/rename readback unknown', { mutationAccepted: true, retrySafe: false }); }
    current = matches[0];
  }
  const output = { success: true, action, packageUuid: current?.packageUuid || packageUuid, readbackVerified: true };
  console.log(JSON.stringify(output, null, 2)); return output;
}

module.exports = { run };
