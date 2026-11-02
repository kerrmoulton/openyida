'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { analyzeFormula } = require('../lib/formula/evaluate');
const { checkWorkflowValueUsage } = require('../lib/formula/workflow-values');
const { nodeFormula } = require('../lib/process/services/process-node-contract');

const check = formula => analyzeFormula(formula, { contract: 'node-expression' });

test.each([
  'ARRAYGET(#{employeeField_owner},1)',
  'ARRAYGET(CONCATENATE(#{employeeField_owner}),1)',
  'ARRAYGET(TRIM(CONCATENATE(#{employeeField_owner})),1)',
  'ARRAYGET(IF(TRUE(),#{employeeField_owner},SPLIT("u,v",",")),1)',
  'IF(TRUE(),ARRAYGET(#{employeeField_owner},1),"fallback")',
])('rejects unsupported array assumptions before node compilation: %s', source => {
  const result = check(source);
  expect(result.ok).toBe(false);
  expect(result.checks).toMatchObject({ types: 'failed', runtime: 'not_run' });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    level: 'error', code: 'serialized_array_access', fieldId: 'employeeField_owner', componentName: 'EmployeeField',
  }));
  expect(() => nodeFormula(source, 'parameter')).toThrow(expect.objectContaining({ code: 'PROCESS_NODE_FORMULA_INVALID' }));
});

test.each([
  'ARRAYGET(SPLIT("item-a,item-b",","),1)',
  'ARRAYGET(SPLIT(#{employeeField_owner},","),1)',
  'ARRAYGET(["item-a"],1)',
  'ARRAYGET(#{lookup//result.users},1)',
  'ARRAYGET(#{employeeField_lookup//result.users},1)',
  'CONCATENATE("ARRAYGET(#{employeeField_owner},1)")',
])('does not ban known array producers, node results or quoted tokens: %s', source => {
  expect(checkWorkflowValueUsage(source)).toEqual([]);
  expect(check(source).diagnostics.filter(d => d.code === 'serialized_array_access')).toEqual([]);
});

test('schema metadata takes precedence over field naming and supports custom personnel IDs', () => {
  const fields = new Map([['owner', { component: 'EmployeeField' }], ['employeeField_custom', { component: 'TextField' }]]);
  expect(checkWorkflowValueUsage('ARRAYGET(#{owner},1)', { fields })).toContainEqual(expect.objectContaining({ fieldId: 'owner' }));
  expect(checkWorkflowValueUsage('ARRAYGET(#{employeeField_custom},1)', { fields })).toEqual([]);
  expect(checkWorkflowValueUsage('ARRAYGET(#{employeeField_sparse},1)', { fields: new Map([['employeeField_sparse', {}]]) }))
    .toContainEqual(expect.objectContaining({ fieldId: 'employeeField_sparse' }));
});

test.each([
  ['multiSelectField_options', 'MultiSelectField'],
  ['checkboxField_options', 'CheckboxField'],
])('applies collection type constraints to %s', (fieldId, componentName) => {
  expect(check(`ARRAYGET(#{${fieldId}},1)`).diagnostics).toContainEqual(expect.objectContaining({
    level: 'error', code: 'serialized_array_access', fieldId, componentName,
  }));
});

test('does not treat emptiness checks as array access', () => {
  expect(checkWorkflowValueUsage('ISEMPTY(#{employeeField_owner})')).toEqual([]);
  expect(checkWorkflowValueUsage('ISNULL(#{employeeField_owner})')).toEqual([]);
  expect(checkWorkflowValueUsage('ISEMPTY(#{lookup//users})')).toEqual([]);
});

test('source metadata cannot hide a hazardous editor expression behind a safe runtime value', () => {
  expect(() => nodeFormula({ value: '"item-a"', __source: 'ARRAYGET(#{employeeField_owner},1)' }, 'parameter'))
    .toThrow(expect.objectContaining({ details: expect.objectContaining({ diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: 'serialized_array_access', fieldId: 'employeeField_owner' }),
    ]) }) }));
});

test('syntax errors are left to the syntax checker and duplicate references are diagnosed once', () => {
  expect(checkWorkflowValueUsage('ARRAYGET(')).toEqual([]);
  const result = checkWorkflowValueUsage('CONCATENATE(ARRAYGET(#{employeeField_owner},1),ARRAYGET(#{employeeField_owner},1))');
  expect(result.filter(d => d.code === 'serialized_array_access')).toHaveLength(1);
});

test('CLI check enforces runtime type constraints without network access', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/yida.js'), 'formula', 'check',
    'ARRAYGET(#{employeeField_owner},1)', '--contract', 'node-expression', '--strict', '--json'],
  { encoding: 'utf8', env: { ...process.env, OPENYIDA_SKIP_UPDATE_CHECK: '1', OPENYIDA_MANAGED_RUN: '0' } });
  expect(result.status).not.toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, checks: { platform: 'not_run', runtime: 'not_run' } });
  expect(JSON.parse(result.stdout).diagnostics).toContainEqual(expect.objectContaining({ code: 'serialized_array_access' }));
});
