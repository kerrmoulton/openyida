'use strict';

const { randomUUID } = require('crypto');
const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');

const OPS = {
  TextField: ['eq', 'ne', 'like', 'contain'],
  TextareaField: ['eq', 'ne', 'like', 'contain'],
  NumberField: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
  DateField: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
  SelectField: ['eq', 'ne', 'in'],
  RadioField: ['eq', 'ne', 'in'],
  MultiSelectField: ['contain', 'inany'],
  CheckboxField: ['contain', 'inany'],
  EmployeeField: ['contain', 'inany'],
  DepartmentSelectField: ['contain', 'inany', 'belong'],
};

function invalid(reason) {
  throw new CliError(t('permission_conditions.invalid', reason), {
    code: 'PERMISSION_CONDITIONS_INVALID', details: { reason, remoteWrites: 0 },
  });
}

// Compile the native FormulaRule tree, retaining grouping instead of flattening OR.
function compilePermissionConditions(input, fields) {
  const known = new Map(fields.map(field => [field.fieldId, field]));
  let count = 0;
  function visit(node, parentId, depth) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 10 || ++count > 100) {
      invalid('object / depth <= 10 / rules <= 100');
    }
    const group = Object.hasOwn(node, 'rules');
    const allowed = group ? ['logic', 'rules'] : ['field', 'op', 'value', 'variable'];
    if (Object.keys(node).some(key => !allowed.includes(key))) { invalid('unknown key'); }
    const ruleId = `${group ? 'group' : 'item'}-${randomUUID()}`;
    if (group) {
      if (!['AND', 'OR'].includes(node.logic) || !Array.isArray(node.rules) || !node.rules.length) {
        invalid('nonempty AND/OR group required');
      }
      return { condition: node.logic, ruleId, ...(parentId ? { parentId } : {}),
        rules: node.rules.map(child => visit(child, ruleId, depth + 1)) };
    }
    const field = known.get(node.field);
    if (!field || field.parentFieldId || !OPS[field.componentName]?.includes(node.op)) {
      invalid(`field/operator: ${node.field}/${node.op}`);
    }
    let value = node.value;
    if (node.variable !== undefined) {
      if (Object.hasOwn(node, 'value')) { invalid('variable/value conflict'); }
      if (node.variable === 'currentUser' && field.componentName === 'EmployeeField') { value = '${loginUser}'; }
      else if (node.variable === 'currentDepartments' && field.componentName === 'DepartmentSelectField') { value = '${departments}'; }
      else { invalid('variable incompatible with field'); }
    } else {
      if (!Object.hasOwn(node, 'value') || value === null || value === undefined) { invalid('value required'); }
      if (['NumberField', 'DateField'].includes(field.componentName)
        && (typeof value !== 'number' || !Number.isFinite(value))) { invalid('numeric value required'); }
      if (['EmployeeField', 'DepartmentSelectField'].includes(field.componentName)
        && (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !id.trim()))) {
        invalid('member/department IDs must be a nonempty string array');
      }
      if (typeof value === 'object' && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) {
        invalid('literal must be scalar or string array');
      }
      if (typeof value === 'string' && value.includes('${')) { invalid('use variable instead of interpolation'); }
    }
    return { id: field.fieldId, fieldId: field.fieldId, componentType: field.componentName,
      type: field.componentName, name: field.label, label: field.label, op: node.op,
      value, ruleValue: value, extValue: 'field', valueType: 'value',
      entityType: 'Default', filterType: 'bizField', ruleId, ...(parentId ? { parentId } : {}) };
  }
  const formulaData = visit(input, null, 0);
  if (!formulaData.rules) { invalid('root must be an AND/OR group'); }
  return { dataRange: 'FORMULA', formulaData };
}

module.exports = { compilePermissionConditions };
