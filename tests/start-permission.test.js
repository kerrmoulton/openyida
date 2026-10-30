'use strict';

const querystring = require('querystring');
jest.mock('../lib/core/utils', () => ({
  loadAuthData: jest.fn(() => ({ base_url: 'https://www.aliwork.com', auth_mode: 'token', corp_id: 'corp-test', user_id: 'user-test' })),
  resolveBaseUrl: jest.fn(() => 'https://www.aliwork.com'), httpGet: jest.fn(), httpPost: jest.fn(),
  requestWithAutoLogin: jest.fn((fn, auth) => fn(auth)),
}));
const utils = require('../lib/core/utils');
const { run } = require('../lib/permission/save-permission');
const { run: getPermission } = require('../lib/permission/get-permission');
const list = packages => ({ success: true, content: { formPermit: packages } });
const START = 'FORM_PACKAGE_START';
function fixture(overrides = {}) {
  return { packageUuid: 'pkg-start', packageType: START,
    packageName: { zh_CN: '发起组', en_US: '发起组', type: 'i18n' },
    description: { zh_CN: '发起组', en_US: '发起组', type: 'i18n' },
    roleData: '{"include":[{"roleType":"DEFAULT","roleValue":"ALL"}]}',
    dataPermit: '{"rule":[{"type":"ALL","value":"y"}]}', operatePermit: '{"OPERATE_CREATE":"y"}',
    fieldPermit: '{"fieldRange":"FORM"}', customButtonPermit: '[]', viewData: '{"all":"y","viewUuids":[]}', ...overrides };
}

describe('START submission permission packages', () => {
  beforeEach(() => {
    utils.httpGet.mockReset(); utils.httpPost.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => jest.restoreAllMocks());

  test('creates a submission group with CREATE, not VIEW, and reads back the same package type', async () => {
    utils.httpGet.mockResolvedValueOnce(list([])).mockResolvedValueOnce(list([fixture()]));
    utils.httpPost.mockResolvedValueOnce({ success: true, content: 'pkg-start' });
    const result = await run(['APP_TEST', 'FORM_TEST', '--package-type', START, '--create', '--name', '发起组', '--all-members']);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body.packageType).toBe(START);
    expect(JSON.parse(body.operatePermit)).toEqual({ OPERATE_CREATE: 'y' });
    expect(result).toMatchObject({ packageType: START, verification: { status: 'verified' } });
    expect(utils.httpGet.mock.calls.every(call => call[2].packageType === START)).toBe(true);
  });

  test('updates submission members once and preserves existing fields and operations', async () => {
    const before = fixture();
    const after = fixture({ roleData: '{"include":[{"roleType":"DEFAULT","roleValue":"ALL"},{"roleType":"PERSONS","roleValue":"user-new"}]}' });
    utils.httpGet.mockResolvedValueOnce(list([before])).mockResolvedValueOnce(list([after]));
    utils.httpPost.mockResolvedValueOnce({ success: true });
    expect(await run(['APP_TEST', 'FORM_TEST', '--package-type', START, '--package-uuid', 'pkg-start', '--members', 'user-new']))
      .toMatchObject({ verification: { status: 'verified' } });
    expect(utils.httpPost).toHaveBeenCalledTimes(1);
    const body = querystring.parse(utils.httpPost.mock.calls[0][2]);
    expect(body.operatePermit).toBe(before.operatePermit);
    expect(body.fieldPermit).toBe(before.fieldPermit);
  });

  test.each(['FORM_PACKAGE_VIEW', undefined])('refuses an unproven START package type (%s) without writing', async packageType => {
    utils.httpGet.mockResolvedValueOnce(list([fixture({ packageType })]));
    await expect(run(['APP_TEST', 'FORM_TEST', '--package-type', START, '--package-uuid', 'pkg-start', '--members', 'user-new']))
      .rejects.toMatchObject({ code: 'SAVE_PERMISSION_BEFORE_UNKNOWN' });
    expect(utils.httpPost).not.toHaveBeenCalled();
  });

  test.each([
    ['--action-permission', '{"operations":{"OPERATE_EDIT":true}}'],
    ['--data-permission', '{"dataRange":"SELF"}'],
  ])('does not apply record permissions to a submission group (%s)', async (...args) => {
    await expect(run(['APP_TEST', 'FORM_TEST', '--package-type', START, ...args]))
      .rejects.toMatchObject({ code: 'START_PERMISSION_SCOPE_INVALID' });
    expect(utils.httpPost).not.toHaveBeenCalled();
    expect(utils.httpGet).not.toHaveBeenCalled();
  });

  test('queries START explicitly while retaining VIEW as the default', async () => {
    utils.httpGet.mockResolvedValueOnce(list([fixture()]));
    expect(await getPermission(['APP_TEST', 'FORM_TEST', '--package-type', START])).toMatchObject({ query: { packageType: START } });
    utils.httpGet.mockResolvedValueOnce(list([]));
    expect(await getPermission(['APP_TEST', 'FORM_TEST'])).toMatchObject({ query: { packageType: 'FORM_PACKAGE_VIEW' } });
  });

  test('rejects unsupported product or package names before any request', async () => {
    await expect(getPermission(['APP_TEST', 'FORM_TEST', '--package-type', 'PRO'])).rejects.toMatchObject({ code: 'PERMISSION_PACKAGE_TYPE_INVALID' });
    expect(utils.httpGet).not.toHaveBeenCalled();
  });
});
