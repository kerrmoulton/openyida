/**
 * searchFormDatas 空值条件构造器。field 来自 get-schema --field-map-json。
 * 将这些函数合并到页面源码；Node.js 可直接 require 此文件。
 * 区间使用下方显式端点模式；complete 表示两端均已填写。
 * 多选选项数量、子表行数使用同步维护的数字字段。
 */
'use strict';

const EMPTY_QUERY_TYPES = Object.freeze({
  TextField: 'TEXT', TextareaField: 'TEXT', NumberField: 'DOUBLE', DateField: 'DOUBLE',
  RadioField: 'ARRAY', SelectField: 'ARRAY',
  EmployeeField: 'STRING', AttachmentField: 'TEXT', ImageField: 'TEXT',
});

function buildEmptyConditions(field, mode) {
  if (!field || typeof field.fieldId !== 'string' || !field.fieldId.trim()) {
    throw new Error('Provide fieldId from the current form schema.');
  }
  const condition = (key, componentName, type, empty) => ({
    key, componentName, type, operator: empty ? 'is' : 'is_not', value: '',
    ...(field.parentId ? { parentId: field.parentId } : {}),
  });
  if (field.componentName === 'CascadeDateField') {
    const modes = {
      empty: [['start', true], ['end', true]],
      complete: [['start', false], ['end', false]],
      'start-empty': [['start', true]], 'start-filled': [['start', false]],
      'end-empty': [['end', true]], 'end-filled': [['end', false]],
      'start-only': [['start', false], ['end', true]],
      'end-only': [['start', true], ['end', false]],
    };
    if (!Object.prototype.hasOwnProperty.call(modes, mode)) {
      throw new Error('Choose an explicit date range mode: ' + Object.keys(modes).join(', '));
    }
    return modes[mode].map(([part, empty]) => condition(field.fieldId + '.' + part, 'DateField', 'DOUBLE', empty));
  }
  if (!Object.prototype.hasOwnProperty.call(EMPTY_QUERY_TYPES, field.componentName)) {
    if (['CheckboxField', 'MultiSelectField', 'TableField'].includes(field.componentName)) {
      throw new Error('Query a synchronized count field with eq 0 or gt 0 for business emptiness.');
    }
    throw new Error('Verify this component before adding its query mapping: ' + field.componentName);
  }
  if (mode !== 'empty' && mode !== 'filled') {
    throw new Error('Choose empty or filled for a single field.');
  }
  return [condition(field.fieldId, field.componentName, EMPTY_QUERY_TYPES[field.componentName], mode === 'empty')];
}

// 同一次保存中维护业务计数，并回填历史记录。
function countFilledRangeEndpoints(value) {
  const present = item => item !== null && item !== undefined && item !== '';
  return Array.isArray(value) ? value.slice(0, 2).filter(present).length : 0;
}

function buildCountConditions(field, mode) {
  if (!field || field.componentName !== 'NumberField' || typeof field.fieldId !== 'string' || !field.fieldId.trim()) {
    throw new Error('Provide the synchronized NumberField from the current form schema.');
  }
  if (mode !== 'empty' && mode !== 'filled') {
    throw new Error('Choose empty or filled for a count field.');
  }
  return [{ key: field.fieldId, componentName: 'NumberField', type: 'DOUBLE',
    operator: mode === 'empty' ? 'eq' : 'gt', value: 0,
    ...(field.parentId ? { parentId: field.parentId } : {}) }];
}

if (typeof module !== 'undefined') {
  module.exports = { buildEmptyConditions, buildCountConditions, countFilledRangeEndpoints };
}
