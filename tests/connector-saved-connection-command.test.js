'use strict';

jest.mock('../lib/connector/api', () => ({
  getAuthRef: jest.fn(() => ({})),
  findConnectorById: jest.fn(),
  getConnectorDetail: jest.fn(),
  listConnections: jest.fn(),
  testConnector: jest.fn(),
  invokeConnector: jest.fn(),
}));

const api = require('../lib/connector/api');
const { run } = require('../lib/connector/connector-test');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  api.findConnectorById.mockResolvedValue({ id: 1, connectorName: 'Http_owned' });
  api.getConnectorDetail.mockResolvedValue({
    securitySchemes: { ApiKeyAuth: {} },
    operations: [{ operationId: 'update', method: 'post', url: 'records', inputs: [] }],
  });
  api.listConnections.mockResolvedValue([{ id: 7, connectorName: 'Http_owned' }]);
});

afterEach(() => { jest.restoreAllMocks(); });

test('authenticated tests invoke the owned saved connection and preserve the business result', async () => {
  api.invokeConnector.mockResolvedValue({ success: true, content: { serviceReturnValue: { code: 'BUSINESS_REJECTED' } } });
  const result = await run(['--connector-id', '1', '--action', 'update', '--account-id', '7', '--json']);
  expect(api.invokeConnector).toHaveBeenCalledWith(expect.objectContaining({
    connectorName: 'Http_owned', actionId: 'update', accountId: 7,
  }), expect.any(Object));
  expect(api.testConnector).not.toHaveBeenCalled();
  expect(result).toMatchObject({ invocationCompleted: true, businessResultVerified: false,
    content: { code: 'BUSINESS_REJECTED' } });
});

test('a failed saved-connection invocation rejects without replaying the raw test request', async () => {
  api.invokeConnector.mockResolvedValue({ success: false, errorMsg: 'Rejected' });
  await expect(run(['--connector-id', '1', '--action', 'update', '--account-id', '7']))
    .rejects.toMatchObject({ code: 'CONNECTOR_INVOKE_FAILED' });
  expect(api.testConnector).not.toHaveBeenCalled();
});
