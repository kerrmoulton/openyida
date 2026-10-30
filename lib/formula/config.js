'use strict';

const { fail } = require('./metadata');
const { prepare } = require('./syntax');
const { t } = require('../core/i18n');

function formulaFields(schema) {
  const result = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.props?.fieldId && node.componentName !== 'SerialNumberField' && node.props.valueType === 'formula') {
      result.set(node.props.fieldId, { formula: node.props.complexValue?.formula || node.props.formula || '', component: node.componentName });
    }
    for (const [key, value] of Object.entries(node)) { if (key !== 'props') { visit(value); } }
  }
  visit(schema);
  return result;
}

// Persistence owns structural consistency and dependency cycles. The optional
// static checker has an incomplete function/type catalog and must not become
// a mandatory gate for formulas that the native consumer can already save.
function validateSchemaFormulas(schema, before = new Map()) {
  const formulas = formulaFields(schema);
  const dependencies = new Map();
  for (const [id, item] of formulas) {
    dependencies.set(id, [...prepare(item.formula).refs.values()].map(ref => ref.path));
  }
  for (const [id, item] of formulas) {
    if (before.get(id)?.formula === item.formula) { continue; }
    const completed = new Set();
    const visit = (current, path) => {
      if (path.includes(current)) { fail(t('formula_v2.config_cycle', [...path, current].join(' -> '))); }
      if (completed.has(current)) { return; }
      for (const ref of dependencies.get(current) || []) {
        // Subproperty dependencies need component metadata. Do not infer a
        // parent dependency merely from an unverified dotted token.
        if (formulas.has(ref)) { visit(ref, [...path, current]); }
      }
      completed.add(current);
    };
    visit(id, []);
  }
}

function applyFieldFormula(props, input, componentType) {
  if (componentType === 'SerialNumberField') { return props; }
  const formula = input.formula ?? input.complexValue?.formula
    ?? (input.valueType === 'formula' ? props.complexValue?.formula || props.formula : undefined);
  if (formula === undefined && input.valueType === 'formula') { fail(t('formula_v2.config_text')); }
  if (formula === undefined) { return props; }
  if (input.formula !== undefined && input.complexValue?.formula !== undefined && input.formula !== input.complexValue.formula) {
    fail(t('formula_v2.config_conflict'));
  }
  if (input.valueType === 'custom' && formula === '') {
    props.valueType = 'custom'; props.formula = '';
    props.complexValue = { ...(props.complexValue || {}), ...(input.complexValue || {}), complexType: 'custom', formula: '' };
    return props;
  }
  if (typeof formula !== 'string' || !formula.trim()) { fail(t('formula_v2.config_text')); }
  if (input.valueType && input.valueType !== 'formula') { fail(t('formula_v2.config_mode')); }
  props.valueType = 'formula';
  props.formula = formula;
  props.complexValue = { ...(props.complexValue || {}), ...(input.complexValue || {}), complexType: 'formula', formula };
  return props;
}
module.exports = { applyFieldFormula, formulaFields, validateSchemaFormulas };
