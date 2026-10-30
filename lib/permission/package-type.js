'use strict';

const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

const VIEW = 'FORM_PACKAGE_VIEW';
const START = 'FORM_PACKAGE_START';

/** Select business permission packages; this never changes product licensing or entitlements. */
function normalizePackageType(value = VIEW) {
  const normalized = { view: VIEW, start: START }[value] || value;
  if (![VIEW, START].includes(normalized)) {
    throw new CliError(t('permission_common.package_type_invalid'), { code: 'PERMISSION_PACKAGE_TYPE_INVALID' });
  }
  return normalized;
}

/** START controls submission, not existing-record visibility or edit/delete operations. */
function validateStartOptions({ packageType, actionPermission, dataPermission, matrix }) {
  if (packageType !== START) { return; }
  const invalidOperation = actionPermission && Object.keys(actionPermission.operations || {})
    .some(key => key !== 'OPERATE_CREATE');
  const invalidRange = dataPermission && (dataPermission.rule || !['ALL', undefined].includes(dataPermission.dataRange));
  if (invalidOperation || invalidRange || matrix) {
    throw new CliError(t('permission_common.start_scope_invalid'), { code: 'START_PERMISSION_SCOPE_INVALID' });
  }
}

module.exports = { VIEW, START, normalizePackageType, validateStartOptions };
