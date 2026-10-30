'use strict';

const { buildConnectorCallAssignments } = require('../lib/integration/integration-process-builder');
const { buildConnectorRulesFromInputs } = require('../lib/integration/connector-presets');
const { validateSavedConnectorView } = require('../lib/integration/integration-save-verifier');

const formula = 'TEXT(DATE(#{dateField_effective}),"yyyy-MM-dd")';
const assignments = [
  { column: 'Query%recordId', valueType: 'processVar', value: 'textField_record' },
  { column: 'Body%effectiveDate', valueType: 'column', value: formula },
  { column: 'Body%status', valueType: 'literal', value: 'active' },
];

test('HTTP engine receives grouped Query and Body assignments with leaf names', () => {
  const result = buildConnectorCallAssignments(assignments);
  expect(result.map(rule => rule.column)).toEqual(['Query', 'Body']);
  expect(result.every(rule => rule.valueType === 'Object')).toBe(true);
  expect(result[0].assignments[0]).toMatchObject({ column: 'recordId', valueType: 'processVar', value: 'textField_record' });
  expect(result[1].assignments).toEqual([
    expect.objectContaining({ column: 'effectiveDate', value: formula }),
    expect.objectContaining({ column: 'status', value: 'active' }),
  ]);
});

test('matches designer-recorded Object groups, including Headers and nested Body objects', () => {
  expect(buildConnectorCallAssignments([
    { column: 'Query%recordId', valueType: 'processVar', value: 'textField_record' },
    { column: 'Headers%Content-Type', valueType: 'literal', value: 'application/json' },
    { column: 'Body%dates%effectiveDate', valueType: 'column', value: formula },
    { column: 'Body%dates%expiryDate', valueType: 'literal', value: '2030-12-31' },
  ])).toEqual([
    { column: 'Query', valueType: 'Object', value: '', assignments: [
      { column: 'recordId', valueType: 'processVar', value: 'textField_record', assignments: [] },
    ] },
    { column: 'Headers', valueType: 'Object', value: '', assignments: [
      { column: 'Content-Type', valueType: 'literal', value: 'application/json', assignments: [] },
    ] },
    { column: 'Body', valueType: 'Object', value: '', assignments: [
      { column: 'dates', valueType: 'Object', value: '', assignments: [
        { column: 'effectiveDate', valueType: 'column', value: formula, assignments: [] },
        { column: 'expiryDate', valueType: 'literal', value: '2030-12-31', assignments: [] },
      ] },
    ] },
  ]);
});

test('unqualified connector inputs retain the flat assignment contract', () => {
  expect(buildConnectorCallAssignments([{ column: 'subject', value: 'test' }])).toEqual([
    { column: 'subject', valueType: 'literal', value: 'test', assignments: [] },
  ]);
});

test('designer formula has source/display defaults and preserves an explicit display label', () => {
  const inputs = [{ name: 'Body', childList: [{ name: 'effectiveDate', componentName: 'TextField' }] }];
  const rules = buildConnectorRulesFromInputs(inputs, assignments);
  expect(rules[0].rules[0]).toMatchObject({ value: formula, __source: formula, __display: formula });
  const display = 'TEXT(DATE(Effective date),"yyyy-MM-dd")';
  expect(buildConnectorRulesFromInputs(inputs, [{ ...assignments[1], __display: display }])[0].rules[0].__display).toBe(display);
});

test.each(['value', 'valueType', '__source', '__display'])('readback rejects lost %s even when mapping IDs remain intact', field => {
  const rules = buildConnectorRulesFromInputs([{ name: 'Body', childList: [{ name: 'effectiveDate' }] }], assignments);
  const expected = { schema: { children: [{ componentName: 'ConnectorNode', id: 'connector', props: { connectorRules: { rules } } }] } };
  const actual = JSON.parse(JSON.stringify(expected));
  delete actual.schema.children[0].props.connectorRules.rules[0].rules[0][field];
  expect(() => validateSavedConnectorView(expected, { success: true, content: actual })).toThrow(field);
});

test('upstream dotted HTTP paths compile into the same execution groups as percent paths', () => {
  expect(buildConnectorCallAssignments(assignments.map(item => ({ ...item, column: item.column.replace(/%/g, '.') }))))
    .toEqual(buildConnectorCallAssignments(assignments));
});
