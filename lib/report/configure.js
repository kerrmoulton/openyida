'use strict';

const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');
const { createAuthRef, isAuthRefReady } = require('../core/yida-client');
const { requireSchemaServerRevision } = require('../core/server-revision');
const { getReportSchema, saveReportSchema } = require('./http');
const { normalizeReportSchemaContent, prepareReportSchemaForSave, assertReportSchemaReadback } = require('./contract');
const { probeReportSchema } = require('./runtime-probe');
const { configureZeroValues, getZeroValueOptions } = require('./zero-values');
const { buildReportWorkbenchUrl } = require('./url');

/** Require a literal boolean and an exact cid; unknown flags must not become positions. */
function parseArgs(args) {
  const positions = [];
  const options = {};
  let enabled;
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') {continue;}
    if (arg === '--dry-run') {dryRun = true; continue;}
    if (arg === '--hide-zero-values' && enabled === undefined && ['true', 'false'].includes(args[index + 1])) {
      enabled = args[++index] === 'true';
    } else if (['--hide-zero-categories', '--hide-zero-legends'].includes(arg)
      && ['true', 'false'].includes(args[index + 1])) {
      const key = arg === '--hide-zero-categories' ? 'hideZeroCategories' : 'hideZeroLegends';
      if (options[key] !== undefined) {throw new CliError(t('report_runtime.zero_usage'), { code: 'REPORT_CONFIGURE_INVALID_ARGUMENTS' });}
      options[key] = args[++index] === 'true';
    } else if (arg.startsWith('-')) {
      throw new CliError(t('report_runtime.zero_usage'), { code: 'REPORT_CONFIGURE_INVALID_ARGUMENTS' });
    } else {
      positions.push(arg);
    }
  }
  if (positions.length !== 3 || enabled === undefined || positions.some(value => !value.trim())) {
    throw new CliError(t('report_runtime.zero_usage'), { code: 'REPORT_CONFIGURE_INVALID_ARGUMENTS' });
  }
  const [appType, reportId, cid] = positions;
  if (!enabled && Object.values(options).includes(true)) {
    throw new CliError(t('report_runtime.zero_requires_enabled'), { code: 'REPORT_CONFIGURE_INVALID_ARGUMENTS' });
  }
  return { appType, reportId, cid, enabled, dryRun, options };
}

/** Resolve only inspect's exact cid, across all pages; duplicate identities fail closed. */
function findChart(schema, cid) {
  const matches = [];
  function visit(node) {
    if (!node || typeof node !== 'object') {return;}
    if ((node.props && node.props.cid || node.cid || node.id) === cid) {matches.push(node);}
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
  }
  (schema.pages || []).forEach(page => (page.componentsTree || []).forEach(visit));
  if (matches.length !== 1) {
    throw new CliError(t('report_runtime.zero_cid'), { code: 'REPORT_CONFIGURE_CID_INVALID' });
  }
  const chart = matches[0];
  const model = chart.props && chart.props.dataSetModelMap && chart.props.dataSetModelMap.chartData;
  if (chart.componentName !== 'YoushuGroupedBarChart' || !model
    || !Array.isArray(model.yField) || !model.yField.length
    || model.yField.some(field => !field || typeof field.fieldKey !== 'string' || !field.fieldKey)) {
    throw new CliError(t('report_runtime.zero_supported'), { code: 'REPORT_ZERO_VALUES_UNSUPPORTED' });
  }
  return chart;
}

/** Update one chart with revision protection and strict whole-schema readback. */
async function run(args = []) {
  const { appType, reportId, cid, enabled, dryRun, options } = parseArgs(args);
  const authRef = createAuthRef();
  if (!isAuthRefReady(authRef)) {
    throw new CliError(t('report_runtime.inspect_login_required'), { code: 'NEED_LOGIN' });
  }
  const response = await getReportSchema(authRef, appType, reportId);
  if (!response || response.success === false || response.__needLogin || response.__csrfExpired) {
    throw new CliError(t('report_runtime.inspect_read_failed'), { code: 'REPORT_CONFIGURE_READ_FAILED' });
  }
  const current = normalizeReportSchemaContent(response);
  if (current.id && current.id !== reportId) {
    throw new CliError(t('report_runtime.zero_target'), { code: 'REPORT_CONFIGURE_TARGET_MISMATCH' });
  }
  const revision = requireSchemaServerRevision(current);
  const schema = JSON.parse(JSON.stringify(current));
  const chart = findChart(schema, cid);
  const changed = configureZeroValues(chart.props, enabled, options);
  const desired = getZeroValueOptions(chart.props.afterFetch);
  const url = buildReportWorkbenchUrl(authRef.baseUrl, appType, reportId);
  const result = { success: true, operation: 'report.configure', appType, reportId, cid, pageType: 'report',
    hideZeroValues: enabled, hideZeroCategories: desired?.hideZeroCategories || false,
    hideZeroLegends: desired?.hideZeroLegends || false, changed, dryRun, revision, url, workbenchUrl: url };
  if (dryRun || !changed) {
    Object.assign(result, { mutationPerformed: false, readbackVerified: !dryRun });
    console.log(JSON.stringify(result));
    return result;
  }
  const expected = prepareReportSchemaForSave(schema, { serverRevision: revision });
  const target = { appType, reportId, cid };
  const failureDetails = { target, retrySafe: false, readbackAllowed: true, sideEffectState: 'unknown',
    nextStep: 'openyida report inspect ' + appType + ' ' + reportId + ' --json' };
  // Do not replay an uncertain save or overwrite concurrent designer edits.
  let saved;
  try {
    saved = await saveReportSchema(authRef, appType, reportId, expected, revision);
  } catch (cause) {
    throw new CliError(t('report_runtime.zero_save'), {
      code: 'REPORT_CONFIGURE_SAVE_FAILED', details: failureDetails,
    });
  }
  if (!saved || saved.success !== true || saved.__needLogin || saved.__csrfExpired) {
    throw new CliError(t('report_runtime.zero_save'), {
      code: 'REPORT_CONFIGURE_SAVE_FAILED', details: failureDetails,
    });
  }
  let verified;
  let verification;
  try {
    const readback = await getReportSchema(authRef, appType, reportId);
    if (!readback || readback.success === false || readback.__needLogin || readback.__csrfExpired) {
      throw new Error('readback');
    }
    verified = normalizeReportSchemaContent(readback);
    if (verified.id && verified.id !== reportId) {throw new Error('reportId');}
    verification = assertReportSchemaReadback(expected, verified);
    if (JSON.stringify(getZeroValueOptions(findChart(verified, cid).props.afterFetch)) !== JSON.stringify(desired)) {
      throw new Error('afterFetch');
    }
  } catch (cause) {
    throw new CliError(t('report_runtime.zero_readback'), {
      code: 'REPORT_CONFIGURE_READBACK_FAILED',
      details: { ...failureDetails, sideEffectState: 'partial', mutationPerformed: true },
    });
  }
  // Probe only the selected component; unrelated broken charts do not change this mutation's scope.
  const probeSchema = { ...verified, pages: [{ componentsTree: [findChart(verified, cid)] }] };
  try {
    const runtime = await probeReportSchema(authRef, appType, reportId, probeSchema);
    if (!runtime.runtimeQueryVerified) {throw new Error('query');}
  } catch (cause) {
    throw new CliError(t('report_runtime.zero_query'), {
      code: 'REPORT_CONFIGURE_QUERY_FAILED',
      details: { ...failureDetails, sideEffectState: 'partial', mutationPerformed: true, readbackVerified: true },
    });
  }
  Object.assign(result, { mutationPerformed: true, readbackVerified: true, runtimeQueryVerified: true,
    verificationLevel: verification.verificationLevel, revision: requireSchemaServerRevision(verified) });
  console.log(JSON.stringify(result));
  return result;
}

module.exports = { run, parseArgs, findChart };
