'use strict';

const mockPostForm = jest.fn();
jest.mock('../lib/core/yida-client', () => ({
  createYidaClient: () => ({ postForm: mockPostForm }),
  createAuthRef: jest.fn(),
}));

const { invokeConnector } = require('../lib/connector/api');

test('uses the same saved-connection invocation contract as a Yida page', async () => {
  mockPostForm.mockResolvedValue({ success: true });
  await invokeConnector({
    connectorName: 'Http_example',
    actionId: 'operation-34',
    accountId: '14472',
    query: { pageIndex: 1 },
    header: { 'Content-Type': 'application/json' },
    body: { tableName: 'example' },
  }, {});

  const [url, form] = mockPostForm.mock.calls[0];
  expect(url).toBe('/query/publicService/invokeService.json');
  expect(JSON.parse(form.serviceInfo)).toEqual({
    connectorInfo: {
      connectorId: 'Http_example',
      actionId: 'operation-34',
      type: 'httpConnector',
      connection: 14472,
    },
  });
  expect(JSON.parse(form.inputs)).toEqual({
    Query: { pageIndex: 1 },
    Headers: { 'Content-Type': 'application/json' },
    Body: { tableName: 'example' },
  });
});
