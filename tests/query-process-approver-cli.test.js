'use strict';

const mockSession = { baseUrl: 'https://www.aliwork.com', corpId: 'corp', userId: 'ordinary-member' };
const mockGet = jest.fn();
jest.mock('../lib/core/yida-client', () => ({
  createAuthRef: jest.fn(() => mockSession),
  isAuthRefReady: jest.fn(() => true),
  createYidaClient: jest.fn(() => ({ get: mockGet })),
}));
const { run } = require('../lib/core/query-data');
const { createAuthRef } = require('../lib/core/yida-client');

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async endpoint => endpoint.endsWith('/getInstances.json')
    ? { success: true, result: { data: [{ processInstanceId: 'a' }], totalCount: 1 } }
    : { success: true, content: [{ type: 'TODO', operator: 'approver-id' }] });
});

test('CLI counts with the existing login without an admin, schema or impersonation request', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await run(['query', 'process', 'APP_A', 'FORM-A', '--current-approver', 'approver-id', '--count']);
    expect(JSON.parse(log.mock.calls[0][0]).result).toMatchObject({ count: 1, scope: 'current_user_visible' });
    expect(mockGet.mock.calls.map(([p]) => p)).toEqual([
      '/dingtalk/web/APP_A/v1/process/getInstances.json', '/dingtalk/web/APP_A/v1/process/getOperationRecords.json',
    ]);
    const params = mockGet.mock.calls[0][1](mockSession);
    expect(params).toMatchObject({ formUuid: 'FORM-A', instanceStatus: 'RUNNING', currentPage: '1', pageSize: '100' });
    expect(params).not.toHaveProperty('userId');
    expect(params).not.toHaveProperty('currentApprover');
  } finally {log.mockRestore();}
});

test.each([
  ['query', 'process', 'APP_A', 'FORM-A', '--count'],
  ['query', 'process', 'APP_A', 'FORM-A', '--current-approver'],
  ['query', 'form', 'APP_A', 'FORM-A', '--current-approver', 'approver-id'],
])('invalid count usage stops before login', async (...args) => {
  await expect(run(args)).rejects.toMatchObject({ code: 'DATA_INVALID_ARGUMENTS' });
  expect(createAuthRef).not.toHaveBeenCalled();
  expect(mockGet).not.toHaveBeenCalled();
});

test('unfiltered process queries retain their existing one-page behavior', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await run(['query', 'process', 'APP_A', 'FORM-A', '--page', '3']);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][1](mockSession)).toMatchObject({ currentPage: '3', pageSize: '10' });
  } finally {log.mockRestore();}
});
