'use strict';

const fixture = require('./fixtures/process-native-nodes.json');
const { compileProcessDefinition } = require('../lib/process/services/process-compiler');
const { connectorInputs, nodeFormula, validateProcessNodes } = require('../lib/process/services/process-node-contract');
const { buildConnectorRulesFromInputs } = require('../lib/integration/connector-presets');

const clone = value => JSON.parse(JSON.stringify(value));
function compile(nodes) {
  return compileProcessDefinition({ nodes }, {
    appType: 'APP_TEST', formUuid: 'FORM_TEST', processCode: 'TPROC_TEST', baseUrl: 'https://example.invalid',
    existingBindings: { lookup: 'node_lookup' },
  });
}

test('compiles captured native editor schema into captured runtime groups without numeric metadata keys', () => {
  const source = clone(fixture.connector), before = clone(source);
  const result = compile([source]);
  const node = result.processJson.nodes.find(n => n.type === 'httpConnector');
  expect(node.props.inputs).toEqual(fixture.runtimeConnectorInputs);
  expect(source).toEqual(before);
  expect(() => validateProcessNodes(result.viewJson, result.processJson)).not.toThrow();
});

test('retains nested HTTP locations, defaults and falsy literal values from generated editor rules', () => {
  const inputs = ['Query', 'Path', 'Headers', 'Body'].map(name => ({ name, childList: name === 'Body'
    ? [{ name: 'profile', childList: [{ name: 'enabled' }, { name: 'count' }, { name: 'label' }] }]
    : [{ name: 'value' }] }));
  const rules = buildConnectorRulesFromInputs(inputs, [
    { column: 'Query%value', valueType: 'literal', value: 'filter' },
    { column: 'Path%value', valueType: 'processVar', value: 'recordId' },
    { column: 'Headers%value', valueType: 'literal', value: 'application/json' },
    { column: 'Body%profile%enabled', valueType: 'literal', value: false },
    { column: 'Body%profile%count', valueType: 'literal', value: 0 },
    { column: 'Body%profile%label', valueType: 'literal', value: '' },
  ]);
  const actual = connectorInputs({ inputs, rules });
  expect(actual.assignments.map(a => a.column)).toEqual(['Query', 'Path', 'Headers', 'Body']);
  expect(actual.assignments[3].assignments).toEqual([{ column: 'profile', valueType: 'Object', value: '', assignments: [
    { column: 'enabled', valueType: 'literal', value: false, assignments: [] },
    { column: 'count', valueType: 'literal', value: 0, assignments: [] },
    { column: 'label', valueType: 'literal', value: '', assignments: [] },
  ] }]);
});

test('retains legacy runtime assignment groups without leaking editor schemas', () => {
  const legacy = clone(fixture.runtimeConnectorInputs);
  expect(connectorInputs({ inputs: legacy })).toEqual(legacy);
});

test('keeps a whole raw Body assignment at Body rather than inventing Body.Body', () => {
  const inputs = [{ name: 'Body', paramType: 'String', childList: [] }];
  const rules = buildConnectorRulesFromInputs(inputs, [{ column: 'Body', valueType: 'literal', value: '{"enabled":true}' }]);
  expect(connectorInputs({ inputs, rules }).assignments).toEqual([
    { column: 'Body', valueType: 'literal', value: '{"enabled":true}', assignments: [] },
  ]);
});

test('does not accept a runtime inputs object as the HTTP editor schema at save time', () => {
  const connector = clone(fixture.connector);
  connector.props.connectorRules.inputs = { assignments: fixture.runtimeConnectorInputs.assignments };
  const result = compile([connector]);
  expect(() => validateProcessNodes(result.viewJson, result.processJson)).toThrow(expect.objectContaining({ code: 'PROCESS_NODE_CONTRACT_INVALID' }));
});

test.each([{}, null, '', 0])('rejects the former JavaScript inputs shape (%p)', inputs => {
  const code = clone(fixture.code); code.JavaScript.inputs = inputs;
  expect(() => compile([code])).toThrow(expect.objectContaining({ code: 'PROCESS_NODE_CONTRACT_INVALID' }));
});

test('normalizes optional inputs and legacy script spelling in both editor and runtime', () => {
  const code = clone(fixture.code); delete code.JavaScript.inputs; code.JavaScript.scriptType = 'javascript';
  const built = compile([code]);
  expect(built.processJson.nodes.find(n => n.type === 'CodeExecutor').props).toMatchObject({ inputs: [], scriptType: 'JavaScript' });
  expect(built.viewJson.schema.children.find(n => n.componentName === 'JavaScriptNode').props.JavaScript).toMatchObject({ inputs: [], scriptType: 'JavaScript' });
});

test.each([
  { outputs: {} }, { scriptType: 'groovy' }, { action: {} }, { action: { code: '' } },
])('rejects invalid code node config %p', change => {
  const code = clone(fixture.code); Object.assign(code.JavaScript, change);
  expect(() => compile([code])).toThrow(expect.objectContaining({ code: 'PROCESS_NODE_CONTRACT_INVALID' }));
});

test('normalizes designer references only outside quoted strings', () => {
  expect(nodeFormula('CONCATENATE(#{lookup//result.userid},"#{literal//untouched}")', 'probe').value)
    .toBe('CONCATENATE(#{lookup}.result.userid,"#{literal//untouched}")');
});

test.each(['GetArrayItem(#{employeeField_owner},1)', 'UserBuilder([])', 'IF(TRUE(),1)', 'ARRAYGET('])('rejects unsupported/invalid node formulas: %s', value => {
  expect(() => nodeFormula(value, 'probe')).toThrow(expect.objectContaining({ code: 'PROCESS_NODE_FORMULA_INVALID' }));
});

test('compiles a formula route with separate designer and runtime references instead of silently discarding it', () => {
  const result = compile([clone(fixture.connector), { key: 'route', type: 'route', name: 'Route', conditions: [{ key: 'found', name: 'Found',
    expression: { value: 'EQ(#{node_lookup//errcode},0)', __display: 'EQ(Lookup.errcode,0)' },
  }] }]);
  const route = result.processJson.nodes.find(n => n.type === 'route');
  expect(route.childNodes[0].props).toMatchObject({ calculate: 'expression', expression: 'EQ(#{node_lookup}.errcode,0)' });
  const branch = result.viewJson.schema.children.find(n => n.componentName === 'ConditionContainer').children[0];
  expect(branch.props.conditions).toMatchObject({ __source: 'EQ(#{node_lookup//errcode},0)', __display: 'EQ(Lookup.errcode,0)' });
  expect(() => validateProcessNodes(result.viewJson, result.processJson)).not.toThrow();
});

test('preflight rejects an otherwise valid formula referencing an absent node', () => {
  const result = compile([{ key: 'route', type: 'route', conditions: [{ expression: 'EQ(#{missing//errcode},0)' }] }]);
  expect(() => validateProcessNodes(result.viewJson, result.processJson)).toThrow(expect.objectContaining({ code: 'PROCESS_NODE_CONTRACT_INVALID' }));
});

test('rejects conflicting expression and rule routing', () => {
  expect(() => compile([{ key: 'route', type: 'route', conditions: [{ key: 'found', expression: 'TRUE()', rules: [{}] }] }]))
    .toThrow(expect.objectContaining({ code: 'PROCESS_NODE_CONTRACT_INVALID' }));
});

test.each(['numeric-schema-key', 'ungrouped', 'formula-drift', 'script-object', 'exception-policy', 'url-drift'])('raw-save validation blocks %s even when readback could match it', scenario => {
  const built = compile([clone(fixture.connector), clone(fixture.code)]);
  const query = built.processJson.nodes.find(n => n.type === 'httpConnector');
  if (scenario === 'numeric-schema-key') { query.props.inputs[0] = {}; }
  if (scenario === 'ungrouped') { query.props.inputs.assignments = query.props.inputs.assignments[0].assignments; }
  if (scenario === 'formula-drift') { query.props.inputs.assignments[0].assignments[0].value = 'CONCATENATE(#{textField_other})'; }
  if (scenario === 'script-object') { built.viewJson.schema.children.find(n => n.componentName === 'JavaScriptNode').props.JavaScript.inputs = { assignments: [] }; }
  if (scenario === 'exception-policy') { built.processJson.nodes.find(n => n.type === 'CodeExecutor').props.action.exceptionStrategy = 'CONTINUE'; }
  if (scenario === 'url-drift') { query.props.inputs.url = 'https://other.example.invalid/user/get'; }
  expect(() => validateProcessNodes(built.viewJson, built.processJson)).toThrow(expect.objectContaining({ code: 'PROCESS_NODE_CONTRACT_INVALID' }));
});
