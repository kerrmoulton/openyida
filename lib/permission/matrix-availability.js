'use strict';

const { createYidaClient } = require('../core/yida-client');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

const GUIDE_URL = 'https://docs.aliwork.com/docs/yida_support/_15/ifpp7g/rxz494bh83kecq29';

async function queryFeature(authRef, appType, featureKey) {
  try {
    const response = await createYidaClient({ authRef }).get(
      `${appType ? `/${appType}` : ''}/query/feature/get.json`,
      { featureKey, dimension: appType ? 'app' : 'corp' }
    );
    if (!response || response.success === false || response.__needLogin) {
      return { status: 'unknown', errorCode: response && response.errorCode,
        errorMsg: response && response.errorMsg };
    }
    const value = response.content;
    return { status: value === true ? 'available' : value === false ? 'unavailable' : 'unknown' };
  } catch (error) {
    return { status: 'unknown', errorCode: error.code, errorMsg: error.message };
  }
}

async function queryMatrixAvailability(authRef, appType) {
  // Matrix management is corp-scoped; using a matrix in an app is app-scoped.
  const management = await queryFeature(authRef, null, 'matrixManageEntry');
  const usage = await queryFeature(authRef, appType, 'matrixAbility');
  return { requiredPackage: 'OA_ENHANCEMENT', management, usage, purchaseVerified: false,
    guideUrl: GUIDE_URL, notice: t('permission_scope.matrix_notice') };
}

async function assertMatrixUsage(authRef, appType) {
  const result = await queryFeature(authRef, appType, 'matrixAbility');
  if (result.status !== 'available') {
    throw new CliError(t(result.status === 'unavailable'
      ? 'permission_scope.matrix_unavailable' : 'permission_scope.matrix_unknown'), {
      code: result.status === 'unavailable' ? 'PERMISSION_MATRIX_UNAVAILABLE' : 'PERMISSION_MATRIX_UNKNOWN',
      details: { ...result, guideUrl: GUIDE_URL, remoteWrites: 0 },
    });
  }
  return result;
}

module.exports = { queryFeature, queryMatrixAvailability, assertMatrixUsage };
