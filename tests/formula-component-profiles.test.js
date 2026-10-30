'use strict';

const { analyzeFormula, parseArgs, collectComponentFormulaDiagnostics } = require('../lib/formula/evaluate');
const { EMPLOYEE_FUNCTIONS, getComponentFormulaProfile } = require('../lib/formula/component-profiles');
const { _private: { saveSchemaAndUpdateConfig } } = require('../lib/app/create-form');

function schemaFor(formula, overrides = {}) {
  return { pages: [{ componentsTree: [{ componentName: 'FormContainer', children: [{
    componentName: 'EmployeeField', props: {
      fieldId: 'employeeField_officer', valueType: 'formula', formula,
      complexValue: { complexType: 'formula', formula }, ...overrides,
    },
  }] }] }] };
}

test('profile lists the 11 editor functions and is not applied to other controls', () => {
  expect(EMPLOYEE_FUNCTIONS).toHaveLength(11);
  expect(getComponentFormulaProfile('EmployeeField').allowedFunctions).toContain('GetArrayItem');
  expect(getComponentFormulaProfile('NumberField')).toBeNull();
  expect(getComponentFormulaProfile('DepartmentSelectField')).toBeNull();
  expect(parseArgs(['USER()', '--component', 'EmployeeField']).componentName).toBe('EmployeeField');
});

test.each(EMPLOYEE_FUNCTIONS)('official spelling %s is recognized in employee formulas', name => {
  const checked = analyzeFormula(name + '()', { componentName: 'EmployeeField' });
  expect(checked.ok).toBe(true);
  expect(checked.diagnostics).toEqual([]);
});

test('rejects the original IF/ISEMPTY mistake including nested calls', () => {
  const checked = analyzeFormula('IF(ISEMPTY(#{employeeField_manager}),UserBuilder([]),DirectorBuilder(GetArrayItem(#{employeeField_manager},1),1))', { componentName: 'EmployeeField' });
  expect(checked.ok).toBe(false);
  expect(checked.diagnostics.filter(d => d.code === 'function_not_allowed_for_component').map(d => d.functionName)).toEqual(['IF', 'ISEMPTY']);
  expect(analyzeFormula('FutureBuilder()', { componentName: 'EmployeeField' }).ok).toBe(false);
});

test('keeps generic/unprofiled formula behavior, recognizes mixed-case builders', () => {
  expect(analyzeFormula('IF(ISEMPTY(#{textField_a}),"",#{textField_a})').ok).toBe(true);
  expect(analyzeFormula('IF(TRUE(),1,0)', { componentName: 'NumberField' }).ok).toBe(true);
  expect(analyzeFormula('DirectorBuilder(GetArrayItem(#{employeeField_a},1),1)').diagnostics).toEqual([expect.objectContaining({ code: 'schema_missing' })]);
  expect(analyzeFormula('DIRECTORBUILDER("",1)', { componentName: 'EmployeeField' }).ok).toBe(false);
  expect(analyzeFormula('directorbuilder("",1)').ok).toBe(false);
});

test('ignores function-shaped text in literals and field refs', () => {
  expect(analyzeFormula('UserBuilder(["IF(","ISEMPTY("])', { componentName: 'EmployeeField' }).ok).toBe(true);
});

test('schema guard checks both slots, nested fields, not JS or validation formulas', () => {
  const schema = schemaFor('USER()', { validation: [{ formula: 'IF(TRUE(),1,0)' }] });
  expect(collectComponentFormulaDiagnostics(schema)).toEqual([]);
  schema.pages[0].componentsTree[0].children[0].props.complexValue.formula = 'IF(TRUE(),USER(),UserBuilder([]))';
  expect(collectComponentFormulaDiagnostics(schema)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'function_not_allowed_for_component', fieldId: 'employeeField_officer' }),
  ]));
  schema.pages[0].componentsTree[0].children[0].componentName = 'TextField';
  expect(collectComponentFormulaDiagnostics(schema)).toEqual([]);
});

test('save gate rejects invalid person default formulas before any remote call', async () => {
  await expect(saveSchemaAndUpdateConfig(null, 'APP_TEST', 'FORM_TEST', schemaFor('IF(TRUE(),USER(),UserBuilder([]))')))
    .rejects.toMatchObject({ code: 'CREATE_FORM_COMPONENT_FORMULA_INVALID' });
});
