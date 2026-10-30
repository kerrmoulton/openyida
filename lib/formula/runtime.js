'use strict';

const { isDeepStrictEqual } = require('util');
const { prepare, collectFields } = require('./syntax');
const { analyzeFormula } = require('./evaluate');
const { builtin, fail } = require('./metadata');
const { t } = require('../core/i18n');

// Match yc-utils evaluates/fields.ts and evaluates/api.ts. Calculation and
// component binding stay on the platform; this is not a local formula engine.
function indexFields(schema) {
  const fields = new Map();
  function visit(node, table = '') {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) { node.forEach(item => visit(item, table)); return; }
    const id = node.props?.fieldId;
    if (id && !fields.has(id)) { fields.set(id, { node, table }); }
    const next = node.componentName === 'TableField' ? id : table;
    if (node.children) { visit(node.children, next); }
    if (node.pages) { visit(node.pages, next); }
    if (node.componentsTree) { visit(node.componentsTree, next); }
  }
  visit(schema);
  return fields;
}

function savedFormula(node) {
  return node.props?.valueType === 'formula' && node.componentName !== 'SerialNumberField'
    ? node.props.complexValue?.formula || node.props.formula || '' : '';
}

function assertReadOnly(formula, options) {
  const result = analyzeFormula(formula, options);
  if (!result.ok) { fail(result.diagnostics.filter(item => item.level === 'error').map(item => item.message).join('; ')); }
  const unsafe = result.functions.filter(name => !['pure', 'context-read'].includes(builtin.functions[name]?.effect));
  if (unsafe.length) { fail(t('formula_v2.test_blocked', unsafe.join(', '))); }
  const special = result.functions.filter(name => ['EXIST', 'EQUAL'].includes(name));
  if (special.length) { fail(t('formula_v2.consumer_required', special.join(', '))); }
  return result;
}

function buildPlan(schema, values, fieldId, override, appType, metadata) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) { fail('data object'); }
  const fields = indexFields(schema);
  const target = fields.get(fieldId);
  if (!target) { fail('field: ' + fieldId); }
  const checkingFields = collectFields(schema);
  const bindings = [], done = new Set(), active = [], required = new Set();
  function walk(id) {
    if (active.includes(id)) { fail(t('formula_v2.config_cycle', [...active, id].join(' -> '))); }
    if (done.has(id)) { return; }
    const field = fields.get(id);
    if (!field) { fail('field: ' + id); }
    const formula = id === fieldId && override !== undefined ? override : savedFormula(field.node);
    if (!formula) { fail('no saved formula: ' + id); }
    assertReadOnly(formula, { fields: checkingFields, metadata, context: 'form' });
    active.push(id);
    for (const ref of prepare(formula).refs.values()) {
      // Custom subproperties and cross-node references need additional native
      // metadata. Reject an incomplete binding instead of guessing.
      if (!fields.has(ref.path)) { fail('unsupported field binding: ' + ref.path); }
      required.add(ref.path);
      if (savedFormula(fields.get(ref.path).node) || ref.path === fieldId) { walk(ref.path); }
    }
    active.pop(); done.add(id);
    const { node, table } = field;
    bindings.push({ type: 'GENERAL', fieldId: id, componentName: node.componentName,
      tableFieldId: table || undefined, specialFieldIds: null, formRule: formula,
      acrossAppType: appType, priority: bindings.length + 1,
      ...(['EmployeeField', 'DepartmentSelectField'].includes(node.componentName) && !node.props.multiple ? { resultLimitNum: 1 } : {}) });
  }
  walk(fieldId);
  const needed = new Set([...required, ...done]);
  // Entire tables are supplied so the backend can distinguish a current row
  // from a column aggregate and recalculate row formulas before their totals.
  for (const id of [...needed]) { if (fields.get(id)?.table) { needed.add(fields.get(id).table); } }
  const inputIds = new Set([...required].filter(id => !done.has(id)));
  function scalar(id, row) {
    // A stale caller-supplied calculated value must never masquerade as the
    // result of this trial when a backend converter fails to fill the field.
    if (done.has(id)) { return ''; }
    if (row && Object.hasOwn(row, id)) { return row[id]; }
    if (!row && Object.hasOwn(values, id)) { return values[id]; }
    if (inputIds.has(id)) { fail('missing data: ' + id); }
    return '';
  }
  const data = [];
  for (const [id, { node, table }] of fields) {
    if (table || !needed.has(id)) { continue; }
    let value;
    if (node.componentName === 'TableField') {
      const rows = values[id];
      if (!Array.isArray(rows)) { fail('table rows required: ' + id); }
      const children = [...fields].filter(([, item]) => item.table === id && needed.has(item.node.props.fieldId));
      value = rows.map(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) { fail('table row object: ' + id); }
        return children.map(([childId, child]) => ({ fieldId: childId, componentName: child.node.componentName,
          fieldData: { value: scalar(childId, row) } }));
      });
    } else { value = scalar(id); }
    data.push({ fieldId: id, componentName: node.componentName, fieldData: { value } });
  }
  // Reject typos instead of silently ignoring sample values for nonexistent
  // fields. Child fields must be inside their table's row objects.
  for (const id of Object.keys(values)) {
    if (!fields.has(id) || fields.get(id).table) { fail('data field: ' + id); }
    if (fields.get(id).node.componentName === 'TableField') {
      if (!Array.isArray(values[id])) { fail('table rows required: ' + id); }
      for (const row of values[id]) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) { fail('table row object: ' + id); }
        for (const child of Object.keys(row)) {
          if (fields.get(child)?.table !== id) { fail('table data field: ' + child); }
        }
      }
    }
  }
  return { fields, target, bindings, data, formula: bindings.find(item => item.fieldId === fieldId).formRule };
}

// yc-utils field/format.ts applies parseFloat to NumberField and DateField
// before passing values into widgets. Keep this stage visible, including a
// lossy/empty conversion; never silently replace TODAY() with TIMESTAMP().
function convertValue(value, node) {
  if (['NumberField', 'DateField'].includes(node.componentName)) {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? '' : parsed;
  }
  if (node.componentName === 'EmployeeField') {
    if (typeof value === 'string' || (Array.isArray(value) && typeof value[0] === 'string')) { return []; }
    if (Array.isArray(value)) {
      const result = value.map(item => ({ ...item, key: item?.key || item?.value, value: item?.key || item?.value }));
      return !node.props.multiple && node.props.valueNormalization ? result.slice(0, 1) : result;
    }
  }
  return value;
}

function extractValue(data, fieldId, table) {
  if (!Array.isArray(data)) { fail('platform response data'); }
  if (table) {
    const tableData = data.find(item => item.fieldId === table)?.fieldData?.value;
    if (!Array.isArray(tableData)) { fail('missing result table: ' + table); }
    return tableData.map(row => {
      const cell = Array.isArray(row) && row.find(item => item.fieldId === fieldId);
      if (!cell) { fail('missing result field: ' + fieldId); }
      return cell.fieldData?.value;
    });
  }
  const item = data.find(entry => entry.fieldId === fieldId);
  if (!item) { fail('missing result field: ' + fieldId); }
  return item.fieldData?.value;
}

async function evaluateField(client, { appType, formUuid, schema, values, fieldId, formula, metadata, timezoneOffset = 480, expected }) {
  if (!Number.isInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 840) { fail('timezone-offset: -840..840 minutes east of UTC'); }
  const plan = buildPlan(schema, values, fieldId, formula, appType, metadata);
  const initialData = JSON.parse(JSON.stringify(plan.data));
  let data = plan.data, bindings = plan.bindings, nextToken;
  const rounds = [], seen = new Set();
  for (let round = 0; round < 20; round++) {
    const response = await client.postFormOnce(`/alibaba/web/${encodeURIComponent(appType)}/query/formFormula/evaluatePlus.json`, {
      appType, formUuid, linkDataNum: 0, bindingComponentFormulaList: JSON.stringify(bindings), data: JSON.stringify(data),
      _locale_time_zone_offset: timezoneOffset * 60 * 1000,
      ...(nextToken ? { nextToken } : {}),
    });
    if (response?.success !== true) { fail(response?.errorMsg || 'platform field evaluation failed'); }
    const content = typeof response.content === 'string' ? JSON.parse(response.content) : response.content;
    if (!content || typeof content !== 'object') { fail('platform field response'); }
    // success:true at the HTTP level can still contain per-field errors.
    if (content.calcErrorMsg || content.unKnowErrorMsg) { fail(content.calcErrorMsg || content.unKnowErrorMsg); }
    if (!Array.isArray(content.data) || typeof content.calculateComplete !== 'boolean') { fail('incomplete platform field response'); }
    data = content.data;
    rounds.push({ calculateComplete: content.calculateComplete, remaining: content.nonEvaluateComponentFormulas?.length || 0 });
    if (content.calculateComplete) { break; }
    const pending = content.nonEvaluateComponentFormulas;
    if (!Array.isArray(pending) || !pending.length) { fail('missing pending formulas'); }
    // Only continue formulas from our read-only plan; do not accept injected
    // expressions or restart a non-progressing continuation indefinitely.
    const trusted = pending.map(item => {
      const original = plan.bindings.find(binding => binding.fieldId === item.fieldId);
      if (!original || ['type', 'formRule', 'componentName', 'tableFieldId', 'priority', 'acrossAppType', 'resultLimitNum']
        .some(key => (original[key] ?? null) !== (item[key] ?? null))) { fail('unexpected pending formula'); }
      return original;
    });
    const signature = JSON.stringify(trusted);
    if (seen.has(signature)) { fail('field evaluation made no progress'); }
    seen.add(signature); bindings = trusted;
    if (content.nextToken !== undefined && typeof content.nextToken !== 'string') { fail('invalid continuation token'); }
    nextToken = content.nextToken;
    if (round === 19) { fail('field evaluation continuation limit'); }
  }
  const rawValue = extractValue(data, fieldId, plan.target.table);
  const value = plan.target.table ? rawValue.map(item => convertValue(item, plan.target.node)) : convertValue(rawValue, plan.target.node);
  const numeric = ['NumberField', 'DateField'].includes(plan.target.node.componentName);
  const rawList = plan.target.table ? rawValue : [rawValue], converted = plan.target.table ? value : [value];
  const missing = rawList.some(item => item === undefined);
  const lost = missing || numeric && rawList.some((item, i) => item !== '' && item !== null && converted[i] === '');
  const partial = numeric && rawList.some((item, i) => converted[i] !== '' &&
    (!Number.isFinite(converted[i]) || typeof item === 'string' && item.trim() !== '' && !Number.isFinite(Number(item)) || Array.isArray(item)));
  const diagnostics = lost ? [{ code: missing ? 'field_result_missing' : 'target_conversion_empty', level: 'warning',
    message: t(missing ? 'formula_v2.result_missing' : 'formula_v2.conversion_empty') }] : [];
  if (partial) { diagnostics.push({ code: 'target_conversion_partial', level: 'warning', message: t('formula_v2.conversion_partial') }); }
  return { success: !lost && !partial && (expected === undefined || isDeepStrictEqual(value, expected)), appType, formUuid, fieldId,
    formula: plan.formula, value, rawValue: rawValue === undefined ? null : rawValue, missingResultValue: missing,
    expected, diagnostics, assertion: expected === undefined ? 'not_requested' : isDeepStrictEqual(value, expected) ? 'passed' : 'failed',
    verification: 'field-runtime', runtimeVerified: false, saved: false, timezoneOffset,
    checks: { fieldBinding: 'passed', platformCalculation: missing ? 'no_result' : 'passed', targetConversion: lost || partial ? 'failed' : numeric || plan.target.node.componentName === 'EmployeeField' ? 'modeled' : 'not_modeled',
      widgetFormatting: 'not_run', submission: 'not_run', runtime: 'not_run' },
    plan: { bindings: plan.bindings, data: initialData }, rounds };
}

module.exports = { indexFields, savedFormula, assertReadOnly, buildPlan, convertValue, extractValue, evaluateField };
