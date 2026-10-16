'use strict';

// Evidence: native EmployeeField default-value formula editor, 2026-10-16.
// Includes collapsed categories. This is NOT a registry for validation formulas,
// process expressions, integrations, or every component type.
const EMPLOYEE_FUNCTIONS = Object.freeze([
  'DirectorBuilder', 'EMPLOYEE', 'ESIGNUSER', 'USER', 'UserBuilder',
  'DIFFERENCESET', 'INTERSECTIONSET', 'SUBSET', 'UNIONSET',
  'GetArrayItem', 'GetObjectField',
]);

function getComponentFormulaProfile(componentName) {
  if (componentName !== 'EmployeeField') {
    return null;
  }
  return {
    componentName,
    context: 'defaultValue',
    verifiedOn: '2026-10-16',
    evidence: 'native-designer-function-menu',
    allowedFunctions: [...EMPLOYEE_FUNCTIONS],
  };
}

module.exports = { EMPLOYEE_FUNCTIONS, getComponentFormulaProfile };
