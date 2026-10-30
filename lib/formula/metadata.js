'use strict';

const fs = require('fs');
const builtin = require('./catalog.json');
const { createAuthRef, createYidaClient } = require('../core/yida-client');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

const CONTEXTS = ['form', 'validation', 'automation', 'business'];
function fail(reason) { throw new CliError(t('formula_v2.failed', reason), { code: 'FORMULA_INVALID_INPUT' }); }
function context(value = 'form') {
  if (!CONTEXTS.includes(value)) { fail('context: ' + CONTEXTS.join(', ')); }
  return value;
}
function normalize(response, source = {}) {
  const raw = response?.content === undefined ? response : response.content;
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data?.expressionMapping || !data?.componentMapping) { fail('metadata'); }
  const functions = {};
  for (const [name, info] of Object.entries(data.expressionMapping)) {
    const inputs = info.inputs || {};
    functions[name] = {
      required: (inputs.requiredParams || []).map(item => item.baseType || []),
      optional: (inputs.notRequiredParams || []).map(item => item.baseType || []),
      variadic: inputs.notRequiredCount === 'N', result: info.outputs?.baseType || [],
      sameType: !!inputs.needSameType, description: info.desc || '', subtable: info.suportSubTable,
      contexts: builtin.functions[name]?.contexts || [], effect: builtin.functions[name]?.effect || 'unknown',
    };
  }
  return { source: { kind: 'platform-metadata', platformVerified: true,
    scope: 'expression signatures and component types; not the complete consumer contract',
    availabilityBasis: 'bundled-function-menu', ...source }, functions,
  components: Object.fromEntries(Object.entries(data.componentMapping).map(([name, info]) => [name, info.type || []])),
  supportQueryFuncs: data.supportQueryFuncs, binaryOperators: data.binaryOperators };
}
function load(file) { return file ? normalize(JSON.parse(fs.readFileSync(file, 'utf8')), { kind: 'metadata-file', platformVerified: false }) : builtin; }
async function fetchMetadata(appType) {
  const response = await createYidaClient({ authRef: createAuthRef() }).get(
    `/alibaba/web/${encodeURIComponent(appType)}/query/expression/rule/metadata.json`, {}
  );
  if (response?.success !== true) { fail(response?.errorMsg || 'metadata unavailable'); }
  return { raw: response, catalog: normalize(response) };
}
module.exports = { builtin, CONTEXTS, context, fail, normalize, load, fetchMetadata };
