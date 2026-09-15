'use strict';

const { validateSavedConnectorView } = require('../lib/integration/integration-save-verifier');

function viewNode(overrides = {}) {
  return {
    componentName: 'ConnectorNode',
    id: 'node-1',
    title: 'Connector action',
    props: {
      connectorRules: {
        connectorId: 'Http_test',
        actionId: 'action',
        url: 'https://example.test/api/{id}',
        method: 'post',
        body: '{"ok":true}',
        inputs: [{ name: 'Path' }],
        outputs: [{ name: 'Response' }],
        rules: [{ id: 'Path', rules: [{ id: 'Path%id' }] }],
        ...overrides,
      },
    },
  };
}

function viewJson(node = viewNode()) {
  return { schema: { children: [node] }, globalSetting: {} };
}

describe('integration save verifier', () => {
  test('accepts a raw getProcess response with matching connector fields', () => {
    const expected = viewJson();
    expect(validateSavedConnectorView(expected, {
      success: true,
      content: JSON.stringify(expected),
    })).toEqual({ connectorCount: 1 });
  });

  test('detects the previously silent empty connector payload', () => {
    const expected = viewJson();
    const actual = viewJson(viewNode({ url: '', method: '', body: '', outputs: [], rules: [] }));
    expect(() => validateSavedConnectorView(expected, {
      success: true,
      content: JSON.stringify(actual),
    })).toThrow(/url.*method.*body.*outputs.*入参映射/);
  });
});
