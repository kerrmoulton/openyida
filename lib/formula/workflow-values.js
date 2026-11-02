'use strict';

const esprima = require('esprima');
const { prepare } = require('./syntax');
const { t } = require('../core/i18n');
const ARRAY_TEXT_COMPONENTS = { EmployeeField: 'employeeField_', MultiSelectField: 'multiSelectField_', CheckboxField: 'checkboxField_' };

// Component declarations do not establish the consumer's runtime representation.
// Track serialized field sources separately from actual array-producing
// expressions; node outputs have their own contracts.
function checkWorkflowValueUsage(source, options = {}) {
  const prepared = prepare(source);
  let tree;
  try { tree = esprima.parseScript(prepared.code, { range: true }); } catch { return []; }
  const diagnostics = [], seen = new Set();
  function serializedReference(node) {
    if (node?.type !== 'Identifier') { return null; }
    const ref = prepared.refs.get(node.name);
    if (!ref || ref.nodeReference || ref.path.includes('//')) { return null; }
    const field = options.fields?.get(ref.fieldId);
    const component = field?.component || Object.keys(ARRAY_TEXT_COMPONENTS).find(name => ref.fieldId.startsWith(ARRAY_TEXT_COMPONENTS[name]));
    return Object.hasOwn(ARRAY_TEXT_COMPONENTS, component) ? { ...ref, component } : null;
  }
  function serializedSources(node) {
    const direct = serializedReference(node);
    if (direct) { return [direct]; }
    if (node?.type !== 'CallExpression' || node.callee.type !== 'Identifier') { return []; }
    if (['CONCATENATE', 'TRIM'].includes(node.callee.name)) { return node.arguments.flatMap(serializedSources); }
    if (node.callee.name === 'IF') { return node.arguments.slice(1).flatMap(serializedSources); }
    // SPLIT and node/script outputs can establish an actual Array. Do not
    // recursively taint them merely because their source contains a person.
    return [];
  }
  function add(code, level, name, ref) {
    const key = code + ':' + ref.fieldId;
    if (seen.has(key)) { return; }
    seen.add(key);
    diagnostics.push({ level, code, functionName: name, fieldId: ref.fieldId,
      componentName: ref.component, consumer: 'node-expression',
      message: t('workflow_values.' + code, ref.fieldId),
      suggestion: t('workflow_values.normalize'), index: ref.index });
  }
  function visit(node) {
    if (!node || typeof node !== 'object') { return; }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      if (node.callee.name === 'ARRAYGET') {
        for (const ref of serializedSources(node.arguments[0])) { add('serialized_array_access', 'error', 'ARRAYGET', ref); }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'range' && value && typeof value === 'object') {
        if (Array.isArray(value)) { value.forEach(visit); } else { visit(value); }
      }
    }
  }
  visit(tree);
  return diagnostics;
}

module.exports = { checkWorkflowValueUsage };
