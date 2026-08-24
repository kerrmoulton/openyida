'use strict';

const querystring = require('querystring');

jest.mock('../lib/core/utils', () => ({
  loadAuthData: jest.fn(),
  triggerLogin: jest.fn(),
  resolveBaseUrl: jest.fn(() => 'https://www.aliwork.com'),
  httpGet: jest.fn(),
  httpPost: jest.fn(),
  requestWithAutoLogin: jest.fn(),
}));

jest.mock('../lib/core/i18n', () => ({
  t: jest.fn((key, ...args) => args.length ? `${key}: ${args.join(', ')}` : key),
}));

const utils = require('../lib/core/utils');
const { run, buildDataPermit, validateMatrix } = require('../lib/permission/save-permission');

const mockAuthData = {
  base_url: 'https://www.aliwork.com',
  auth_mode: 'token',
  auth_source: 'token',
  corp_id: 'corp-1',
  user_id: 'user-1',
};

describe('save-permission command', () => {
  let mockLog;
  let mockError;
  let mockStderrWrite;

  beforeEach(() => {
    jest.clearAllMocks();
    utils.loadAuthData.mockReturnValue(mockAuthData);
    utils.requestWithAutoLogin.mockImplementation((requestFn, authRef) => requestFn(authRef));
    mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockStderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    mockLog.mockRestore();
    mockError.mockRestore();
    mockStderrWrite.mockRestore();
  });

  test('updates field permissions without requiring data or action permissions', async () => {
    utils.httpGet
      .mockResolvedValueOnce({
        success: true,
        content: {
          formPermit: [
            {
              packageUuid: 'pkg-1',
              packageName: { zh_CN: '默认组' },
              roleMembers: [{ roleType: 'DEFAULT' }],
              dataPermit: '{"rule":[{"type":"ALL","value":"y"}]}',
              operatePermit: '{"OPERATE_VIEW":"y"}',
              fieldPermit: '{"fieldRange":"FORM"}',
            },
          ],
        },
      });
    utils.httpPost.mockResolvedValueOnce({ success: true });

    await run([
      'APP-1',
      'FORM-1',
      '--field-permission',
      '{"role":"DEFAULT","fieldRange":"CUSTOM","fields":{"textField_a":"READONLY"}}',
    ]);

    expect(utils.httpGet).toHaveBeenCalledTimes(1);
    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body).toMatchObject({
      formUuid: 'FORM-1',
      packageUuid: 'pkg-1',
      fieldPermit: '{"fieldRange":"CUSTOM","fields":{"textField_a":"READONLY"}}',
    });
    const output = JSON.parse(mockLog.mock.calls[0][0]);
    expect(output).toMatchObject({
      success: true,
      summary: {
        fieldPermission: '字段权限已更新',
      },
      message: '权限配置已保存',
    });
  });

  test('creates a permission group with custom fieldPermit payload', async () => {
    utils.httpPost.mockResolvedValueOnce({
      success: true,
      content: 'pkg-new',
    });

    await run([
      'APP-1',
      'FORM-1',
      '--create',
      '--name',
      '只读字段组',
      '--field-permission',
      '{"fieldRange":"CUSTOM","fields":{"textField_a":"READONLY"}}',
    ]);

    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body.packageUuid).toBeUndefined();
    expect(body).toMatchObject({
      formUuid: 'FORM-1',
      fieldPermit: '{"fieldRange":"CUSTOM","fields":{"textField_a":"READONLY"}}',
    });
    const output = JSON.parse(mockLog.mock.calls[0][0]);
    expect(output).toMatchObject({
      success: true,
      packageUuid: 'pkg-new',
      summary: {
        name: '只读字段组',
        fieldPermission: '自定义 fieldPermit',
      },
      message: '权限组已新增',
    });
  });

  test('creates an all-members group when --all-members is provided', async () => {
    utils.httpPost.mockResolvedValueOnce({
      success: true,
      content: 'pkg-all',
    });

    await run([
      'APP-1',
      'FORM-1',
      '--create',
      '--name',
      '全部人员看全部数据',
      '--all-members',
      '--data-permission',
      '{"dataRange":"ALL"}',
    ]);

    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body.packageUuid).toBeUndefined();
    expect(body).toMatchObject({
      formUuid: 'FORM-1',
      dataPermit: '{"rule":[{"type":"ALL","value":"y"}]}',
      operatePermit: '{"OPERATE_VIEW":"y"}',
      fieldPermit: '{"fieldRange":"FORM"}',
    });
    expect(JSON.parse(body.roleData)).toEqual({
      include: [{ roleType: 'DEFAULT', roleValue: 'ALL' }],
    });
    const output = JSON.parse(mockLog.mock.calls[0][0]);
    expect(output).toMatchObject({
      success: true,
      packageUuid: 'pkg-all',
      summary: {
        name: '全部人员看全部数据',
        dataPermission: '数据范围: ALL',
      },
      message: '权限组已新增',
    });
  });

  test('updates existing package to all-members when --all-members is provided', async () => {
    utils.httpGet
      .mockResolvedValueOnce({
        success: true,
        content: {
          formPermit: [
            {
              packageUuid: 'pkg-1',
              packageName: { zh_CN: '默认组' },
              roleMembers: [{ roleType: 'DEFAULT' }],
              roleData: '{"include":[{"roleType":"DEFAULT","roleValue":"ALL"}]}',
              dataPermit: '{"rule":[{"type":"SELF","value":"y"}]}',
              operatePermit: '{"OPERATE_VIEW":"y"}',
              fieldPermit: '{"fieldRange":"FORM"}',
            },
          ],
        },
      });
    utils.httpPost.mockResolvedValueOnce({ success: true });

    await run([
      'APP-1',
      'FORM-1',
      '--all-members',
      '--data-permission',
      '{"dataRange":"ALL"}',
    ]);

    expect(utils.httpGet).toHaveBeenCalledTimes(1);
    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body).toMatchObject({
      formUuid: 'FORM-1',
      packageUuid: 'pkg-1',
      dataPermit: '{"rule":[{"type":"ALL","value":"y"}]}',
    });
    expect(JSON.parse(body.roleData)).toEqual({
      include: [{ roleType: 'DEFAULT', roleValue: 'ALL' }],
    });
    const output = JSON.parse(mockLog.mock.calls[0][0]);
    expect(output).toMatchObject({
      success: true,
      summary: {
        dataPermission: '数据范围: ALL',
      },
      message: '权限配置已保存',
    });
  });

  test('creates a manager+persons group when --members is provided', async () => {
    utils.httpPost.mockResolvedValueOnce({
      success: true,
      content: 'pkg-persons',
    });

    await run([
      'APP-1',
      'FORM-1',
      '--create',
      '--name',
      '指定人员组',
      '--members',
      'user1,user2',
    ]);

    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(JSON.parse(body.roleData)).toEqual({
      include: [
        { roleType: 'MANAGER', roleValue: 'appMainAdminRole,corpAdminRole' },
        { roleType: 'PERSONS', roleValue: 'user1,user2' },
      ],
    });
    const output = JSON.parse(mockLog.mock.calls[0][0]);
    expect(output).toMatchObject({
      success: true,
      packageUuid: 'pkg-persons',
      summary: {
        name: '指定人员组',
        members: '成员: user1, user2',
      },
      message: '权限组已新增',
    });
  });

  test('creates a permission group with complex data-permit rules', async () => {
    utils.httpPost.mockResolvedValueOnce({
      success: true,
      content: 'pkg-complex',
    });

    const complexDataPermission = {
      rule: [
        { type: 'ORIGINATOR', value: 'y' },
        { type: 'ORIGINATOR_DEPARTMENT', value: 'y' },
        { type: 'CUSTOM_DEPARTMENT', value: 'y' },
      ],
      customDepartmentData: {
        departmentIds: ['637215248'],
        drillDown: 'n',
      },
    };

    await run([
      'APP-1',
      'FORM-1',
      '--create',
      '--name',
      '复杂数据权限组',
      '--all-members',
      '--data-permission',
      JSON.stringify(complexDataPermission),
      '--action-permission',
      '{"operations":{"OPERATE_VIEW":true,"OPERATE_EDIT":true}}',
    ]);

    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body.packageUuid).toBeUndefined();
    expect(JSON.parse(body.dataPermit)).toEqual(complexDataPermission);
    expect(JSON.parse(body.roleData)).toEqual({
      include: [{ roleType: 'DEFAULT', roleValue: 'ALL' }],
    });
    const output = JSON.parse(mockLog.mock.calls[0][0]);
    expect(output).toMatchObject({
      success: true,
      packageUuid: 'pkg-complex',
      summary: {
        name: '复杂数据权限组',
        dataPermission: '数据范围: 自定义规则（3 条）',
      },
      message: '权限组已新增',
    });
  });

  test('creates a permission group with matrix member', async () => {
    utils.httpPost.mockResolvedValueOnce({
      success: true,
      content: 'pkg-matrix',
    });

    await run([
      'APP-1',
      'FORM-1',
      '--create',
      '--name',
      '使用权限矩阵的权限组',
      '--matrix',
      '{"matrixId":"MATRIX-XNCVJYB60YW7L0HPY9HE","columnId":"column_1767839664612"}',
      '--data-permission',
      '{"rule":[{"type":"ORIGINATOR","value":"y"},{"type":"MATRIX","value":"y"}]}',
      '--action-permission',
      '{"operations":{"OPERATE_VIEW":true,"OPERATE_EDIT":true}}',
    ]);

    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body.packageUuid).toBeUndefined();
    expect(JSON.parse(body.dataPermit)).toEqual({
      rule: [
        { type: 'ORIGINATOR', value: 'y' },
        { type: 'MATRIX', value: 'y' },
      ],
    });
    expect(JSON.parse(body.roleData)).toEqual({
      include: [{
        roleType: 'MATRIX',
        roleValue: [{ matrixId: 'MATRIX-XNCVJYB60YW7L0HPY9HE', columnId: 'column_1767839664612' }],
      }],
    });
    const output = JSON.parse(mockLog.mock.calls[0][0]);
    expect(output).toMatchObject({
      success: true,
      packageUuid: 'pkg-matrix',
      summary: {
        name: '使用权限矩阵的权限组',
        members: '权限矩阵: MATRIX-XNCVJYB60YW7L0HPY9HE / column_1767839664612',
      },
      message: '权限组已新增',
    });
  });

  test('updates existing matrix package when --matrix is provided', async () => {
    utils.httpGet
      .mockResolvedValueOnce({
        success: true,
        content: {
          formPermit: [
            {
              packageUuid: 'pkg-matrix-old',
              packageName: { zh_CN: '旧矩阵组' },
              roleMembers: [{ roleType: 'MATRIX' }],
              roleData: JSON.stringify({
                include: [{ roleType: 'MATRIX', roleValue: [{ matrixId: 'OLD', columnId: 'OLD' }] }],
              }),
            },
          ],
        },
      });
    utils.httpPost.mockResolvedValueOnce({ success: true });

    await run([
      'APP-1',
      'FORM-1',
      '--matrix',
      '{"matrixId":"MATRIX-XNCVJYB60YW7L0HPY9HE","columnId":"column_1767839664612"}',
      '--data-permission',
      '{"rule":[{"type":"ORIGINATOR","value":"y"},{"type":"MATRIX","value":"y"}]}',
    ]);

    expect(utils.httpGet).toHaveBeenCalledTimes(1);
    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body.packageUuid).toBe('pkg-matrix-old');
    expect(JSON.parse(body.roleData)).toEqual({
      include: [{
        roleType: 'MATRIX',
        roleValue: [{ matrixId: 'MATRIX-XNCVJYB60YW7L0HPY9HE', columnId: 'column_1767839664612' }],
      }],
    });
    expect(JSON.parse(body.dataPermit)).toEqual({
      rule: [
        { type: 'ORIGINATOR', value: 'y' },
        { type: 'MATRIX', value: 'y' },
      ],
    });
  });

  test('rejects mixing --matrix with --members or --all-members', async () => {
    let error;
    try {
      await run([
        'APP-1',
        'FORM-1',
        '--create',
        '--name',
        '冲突组',
        '--matrix',
        '{"matrixId":"MATRIX-1","columnId":"col-1"}',
        '--members',
        'user1',
      ]);
    } catch (err) {
      error = err;
    }

    expect(error).toBeTruthy();
    expect(error.isCliError).toBe(true);
    expect(error.code).toBe('SAVE_PERMISSION_INVALID_ARGUMENTS');
    expect(utils.httpGet).not.toHaveBeenCalled();
    expect(utils.httpPost).not.toHaveBeenCalled();
  });

  test('invalid JSON rejects with CliError instead of exiting', async () => {
    let error;
    try {
      await run(['APP-1', 'FORM-1', '--field-permission', 'not-json']);
    } catch (err) {
      error = err;
    }

    expect(error).toBeTruthy();
    expect(error.isCliError).toBe(true);
    expect(error.code).toBe('SAVE_PERMISSION_INVALID_ARGUMENTS');
    expect(utils.httpGet).not.toHaveBeenCalled();
    expect(utils.httpPost).not.toHaveBeenCalled();
  });
});

describe('buildDataPermit', () => {
  test('maps simple dataRange to single rule', () => {
    expect(JSON.parse(buildDataPermit({ dataRange: 'ALL' }))).toEqual({
      rule: [{ type: 'ALL', value: 'y' }],
    });
    expect(JSON.parse(buildDataPermit({ dataRange: 'SELF' }))).toEqual({
      rule: [{ type: 'ORIGINATOR', value: 'y' }],
    });
  });

  test('defaults to ALL when dataPermission is empty', () => {
    expect(JSON.parse(buildDataPermit(null))).toEqual({
      rule: [{ type: 'ALL', value: 'y' }],
    });
  });

  test('passes through complex permission payload with rule array', () => {
    const complex = {
      rule: [
        { type: 'ORIGINATOR', value: 'y' },
        { type: 'ORIGINATOR_DEPARTMENT', value: 'y' },
      ],
      customDepartmentData: {
        departmentIds: ['637215248'],
        drillDown: 'n',
      },
      formulaData: {
        condition: 'OR',
        rules: [],
      },
    };
    expect(JSON.parse(buildDataPermit(complex))).toEqual(complex);
  });
});

describe('validateMatrix', () => {
  test('accepts valid matrix object', () => {
    expect(() => validateMatrix({ matrixId: 'MATRIX-1', columnId: 'col-1' })).not.toThrow();
  });

  test('rejects missing matrixId', () => {
    expect(() => validateMatrix({ columnId: 'col-1' })).toThrow('matrixId');
  });

  test('rejects missing columnId', () => {
    expect(() => validateMatrix({ matrixId: 'MATRIX-1' })).toThrow('columnId');
  });
});
