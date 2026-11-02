'use strict';

jest.mock('../lib/core/yida-client', () => ({ createYidaClient: jest.fn() }));
const { createYidaClient } = require('../lib/core/yida-client');
const { preflightProcessNodes } = require('../lib/process/services/process-node-preflight');
const { saveProcessById } = require('../lib/process/services/process-service');
const { compileProcessDefinition } = require('../lib/process/services/process-compiler');
const fixture = require('./fixtures/process-native-nodes.json');
const clone = value => JSON.parse(JSON.stringify(value));
const ok = { success: true, content: { connectorId: 'Http_native', actionId: 'operation-1' } };
let client;
function built() {
  return compileProcessDefinition({ nodes: [clone(fixture.connector)] }, {
    appType: 'APP_TEST', formUuid: 'FORM_TEST', processCode: 'TPROC_TEST', baseUrl: 'https://example.invalid',
  });
}
beforeEach(() => {
  client = { get: jest.fn().mockResolvedValue(ok), postFormOnce: jest.fn().mockResolvedValue({ success: true }), postForm: jest.fn() };
  createYidaClient.mockReturnValue(client);
});

test('probes the application designer action and deduplicates repeated nested actions', async () => {
  const b = built(), node = clone(b.viewJson.schema.children.find(n => n.componentName === 'ConnectorNode'));
  node.id = 'second'; b.viewJson.schema.children.push({ componentName: 'ConditionContainer', children: [node] });
  await preflightProcessNodes({}, 'APP_TEST', b.viewJson);
  expect(client.get).toHaveBeenCalledTimes(1);
  expect(client.get).toHaveBeenCalledWith('/alibaba/web/APP_TEST/connector/getAction.json', { connectorId: 'Http_native', actionId: 'operation-1', mode: 5 });
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test.each([
  { success: false, errorCode: '500', errorMsg: 'private platform detail' },
  { success: true, content: null },
  { success: true, content: '{' },
  { success: true, content: { connectorId: 'Http_other', actionId: 'operation-1' } },
  { success: true, content: { connectorId: 'Http_native', actionId: 'wrong' } },
])('blocks unavailable or mismatched designer actions before save: %p', async response => {
  client.get.mockResolvedValue(response); const b = built();
  await expect(saveProcessById({}, 'APP_TEST', 'FORM_TEST', 'TPROC_TEST', 1, 2,
    JSON.stringify(b.processJson), JSON.stringify(b.viewJson), { oneShot: true }))
    .rejects.toMatchObject({ code: 'PROCESS_CONNECTOR_ACTION_UNAVAILABLE', details: { remoteWrites: 0 } });
  expect(client.postFormOnce).not.toHaveBeenCalled(); expect(client.postForm).not.toHaveBeenCalled();
});

test('transport failures fail closed without echoing credentials or retrying a write', async () => {
  client.get.mockRejectedValue(new Error('token=secret')); const b = built();
  await expect(preflightProcessNodes({}, 'APP_TEST', b.viewJson)).rejects.toThrow('Http_native');
  try { await preflightProcessNodes({}, 'APP_TEST', b.viewJson); } catch (error) { expect(JSON.stringify(error) + error.message).not.toContain('secret'); }
  expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('saves exactly once after successful preflight and accepts serialized native content', async () => {
  client.get.mockResolvedValue({ success: true, content: JSON.stringify(ok.content) }); const b = built();
  await saveProcessById({}, 'APP_TEST', 'FORM_TEST', 'TPROC_TEST', 1, 2,
    JSON.stringify(b.processJson), JSON.stringify(b.viewJson), { oneShot: true });
  expect(client.postFormOnce).toHaveBeenCalledTimes(1);
  expect(client.get.mock.invocationCallOrder[0]).toBeLessThan(client.postFormOnce.mock.invocationCallOrder[0]);
});

test('invalid raw script inputs are rejected before any connector probe or write', async () => {
  const b = built(); b.viewJson.schema.children.push({ componentName: 'JavaScriptNode', props: { JavaScript: { inputs: {}, action: { code: 'return 1;' } } } });
  await expect(saveProcessById({}, 'APP_TEST', 'FORM_TEST', 'TPROC_TEST', 1, 2,
    JSON.stringify(b.processJson), JSON.stringify(b.viewJson))).rejects.toMatchObject({ code: 'PROCESS_NODE_CONTRACT_INVALID' });
  expect(client.get).not.toHaveBeenCalled(); expect(client.postFormOnce).not.toHaveBeenCalled(); expect(client.postForm).not.toHaveBeenCalled();
});

test('rejects an extra runtime script hidden from the designer', async () => {
  const b = built(); b.processJson.nodes.push({ nodeId: 'hidden_script', type: 'CodeExecutor', props: { inputs: {} } });
  await expect(saveProcessById({}, 'APP_TEST', 'FORM_TEST', 'TPROC_TEST', 1, 2,
    JSON.stringify(b.processJson), JSON.stringify(b.viewJson))).rejects.toMatchObject({ code: 'PROCESS_NODE_CONTRACT_INVALID' });
  expect(client.get).not.toHaveBeenCalled(); expect(client.postFormOnce).not.toHaveBeenCalled();
});

test('raw save rejects serialized-field array access before network operations', async () => {
  createYidaClient.mockClear();
  const b = built();
  const row = b.viewJson.schema.children.find(n => n.componentName === 'ConnectorNode').props.connectorRules.rules[0].rules[0];
  row.value = row.__source = 'ARRAYGET(#{employeeField_owner},1)';
  b.processJson.nodes.find(n => n.type === 'httpConnector').props.inputs.assignments[0].assignments[0].value = row.value;
  await expect(saveProcessById({}, 'APP_TEST', 'FORM_TEST', 'TPROC_TEST', 1, 2,
    JSON.stringify(b.processJson), JSON.stringify(b.viewJson)))
    .rejects.toMatchObject({ code: 'PROCESS_NODE_FORMULA_INVALID', details: { remoteWrites: 0,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'serialized_array_access', fieldId: 'employeeField_owner' })]) } });
  expect(createYidaClient).not.toHaveBeenCalled();
  expect(client.get).not.toHaveBeenCalled();expect(client.postFormOnce).not.toHaveBeenCalled();
});
