'use strict';

jest.mock('../lib/connector/api', () => ({
  getConnectorDetail: jest.fn(),
  findConnectorById: jest.fn(),
}));

const { getConnectorDetail } = require('../lib/connector/api');
const {
  hydrateHttpConnectorNode,
  hydrateSpecConnectors,
} = require('../lib/integration/integration-connector-resolver');
const { buildSpecProcessAndViewJson } = require('../lib/integration/integration-spec-builder');

function connectorDetail() {
  return {
    connectorName: 'Http_test',
    displayName: 'Test HTTP connector',
    connectorDesc: 'Connector description',
    iconUrl: 'icon%%#FFA200',
    scheme: 'https',
    host: 'example.test:8091',
    baseUrl: '/service/',
    securitySchemes: '{}',
    operations: JSON.stringify([{
      operationId: 'reconcile',
      summary: 'Reconcile',
      description: 'Reconcile one attempt',
      method: 'post',
      url: 'api/attempts/{attemptId}/reconcile',
      parameters: {
        path: [{ name: 'attemptId', required: true }],
        header: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'X-Api-Key' },
        ],
        body: { default: '{"operator":"AUTOMATION"}' },
      },
      inputs: [
        {
          name: 'Path',
          paramType: 'Object',
          required: true,
          childList: [{ name: 'attemptId', required: true, componentName: 'TextField' }],
        },
        {
          name: 'Headers',
          paramType: 'Object',
          required: false,
          childList: [
            { name: 'Content-Type', required: false, componentName: 'TextField', defaultValue: 'application/json' },
            { name: 'X-Api-Key', required: false, componentName: 'TextField' },
          ],
        },
        {
          name: 'Body',
          paramType: 'Object',
          required: false,
          defaultValue: '{"operator":"AUTOMATION"}',
          childList: [{ name: 'operator', paramType: 'String', required: true }],
        },
      ],
      outputs: [{ name: 'Response', paramType: 'Object', required: false, defaultValue: '' }],
    }]),
  };
}

describe('integration connector resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConnectorDetail.mockResolvedValue(connectorDetail());
  });

  test('hydrates an HTTP connector from its current action definition', async () => {
    const hydrated = await hydrateHttpConnectorNode({
      type: 'connector',
      name: 'Complete reconciliation',
      connectorId: 'Http_test',
      actionId: 'reconcile',
      assignments: [
        { column: 'Path%attemptId', valueType: 'processVar', value: 'textField_attempt' },
        { column: 'Headers%X-Api-Key', valueType: 'literal', value: 'secret' },
        { column: 'Body%operator', valueType: 'literal', value: 'AUTOMATION' },
      ],
    }, {});

    expect(hydrated).toMatchObject({
      connectorId: 'Http_test',
      connectorName: 'Http_test',
      connectorDisplayName: 'Test HTTP connector',
      connectorMode: 5,
      connectorConfig: { connectionLess: true },
      connectorOrgId: null,
      connectorPriority: 333,
      url: 'https://example.test:8091/service/api/attempts/{attemptId}/reconcile',
      method: 'post',
      body: '{"operator":"AUTOMATION"}',
    });
    expect(hydrated.inputs.find(item => item.name === 'Body')).toMatchObject({
      required: true,
      display: true,
      label: 'Body',
    });
    expect(hydrated.outputs).toHaveLength(1);
    expect(hydrated.assignments.map(item => item.column)).toEqual([
      'Headers%Content-Type',
      'Path%attemptId',
      'Headers%X-Api-Key',
      'Body%operator',
    ]);
  });

  test('produces populated process and designer connector nodes', async () => {
    const spec = await hydrateSpecConnectors({
      events: ['insert'],
      nodes: [
        {
          id: 'first',
          type: 'connector',
          name: 'First',
          connectorId: 'Http_test',
          actionId: 'reconcile',
          assignments: [
            { column: 'Path%attemptId', valueType: 'processVar', value: 'textField_attempt' },
            { column: 'Headers%X-Api-Key', valueType: 'literal', value: 'secret' },
            { column: 'Body%operator', valueType: 'literal', value: 'AUTOMATION' },
          ],
        },
        {
          id: 'second',
          type: 'connector',
          name: 'Second',
          connectorId: 'Http_test',
          actionId: 'reconcile',
          assignments: [
            { column: 'Path%attemptId', valueType: 'processVar', value: 'textField_attempt' },
          ],
        },
      ],
    }, {});
    expect(getConnectorDetail).toHaveBeenCalledTimes(1);

    const built = buildSpecProcessAndViewJson({
      spec,
      processCode: 'LPROC-TEST',
      appType: 'APP-TEST',
      formUuid: 'FORM-TEST',
      flowName: 'Test flow',
    });
    const processNode = built.processJson.nodes.find(node => node.nodeId === built.nodeIdMap.first);
    const viewNode = built.viewJson.schema.children.find(node => node.id === built.nodeIdMap.first);

    expect(processNode.props.inputs).toMatchObject({
      url: 'https://example.test:8091/service/api/attempts/{attemptId}/reconcile',
      method: 'post',
      body: '{"operator":"AUTOMATION"}',
    });
    expect(viewNode.props.connectorRules.outputs).toHaveLength(1);
    expect(viewNode.props.connectorRules.connector).toMatchObject({
      config: { connectionLess: true },
      connectorId: 'Http_test',
      mode: 5,
      name: 'Test HTTP connector',
      orgId: null,
      prioirty: 333,
    });
    const assignedPaths = viewNode.props.connectorRules.rules
      .flatMap(group => group.rules.map(rule => rule.id));
    expect(assignedPaths).toEqual([
      'Path%attemptId',
      'Headers%Content-Type',
      'Headers%X-Api-Key',
      'Body%operator',
    ]);
  });

  test('rejects assignments absent from the current connector action', async () => {
    await expect(hydrateHttpConnectorNode({
      type: 'connector',
      connectorId: 'Http_test',
      actionId: 'reconcile',
      assignments: [{ column: 'Path%missing', valueType: 'literal', value: 'x' }],
    }, {})).rejects.toThrow(/Path%missing/);
  });
});
