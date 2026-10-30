'use strict';

jest.mock('../lib/core/utils', () => ({
  httpGet: jest.fn(), httpPost: jest.fn(),
  requestWithAutoLogin: jest.fn((request, auth) => request(auth)),
}));
jest.mock('../lib/core/yida-client', () => ({
  createAuthRef: () => ({ baseUrl: 'https://example.test' }), isAuthRefReady: () => true,
}));

const { httpGet, httpPost } = require('../lib/core/utils');
const { run, ROOT_NAV_UUID } = require('../lib/app/nav-group');
const title = (name) => ({ zh_CN: name, en_US: name, type: 'i18n' });
const group = (name, fields = {}) => ({
  id: 10, navUuid: 'NAV-NEW', navType: 'NAV', parentNavUuid: ROOT_NAV_UUID,
  title: title(name), gmtModified: 123, listOrder: 7, hidden: 'n', mobileHidden: 'y',
  ...fields,
});
const reply = (content) => ({ success: true, content });

beforeEach(() => {
  jest.clearAllMocks();
  httpGet.mockReset();
  httpPost.mockReset();
  httpPost.mockResolvedValue({ success: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each([
  ['客户管理', 'name-card'], ['财务中心', 'dingdingka'],
  ['项目协作', 'Project'], ['经营看板', 'dashboard'],
])('create chooses the business icon for %s and verifies persistence', async (name, icon) => {
  const created = group(name);
  httpGet.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply([created]))
    .mockResolvedValueOnce(reply([{ ...created, icon }]));
  await run(['create', 'APP_TEST', name]);
  const payload = Object.fromEntries(new URLSearchParams(httpPost.mock.calls[1][2]));
  expect(payload).toMatchObject({
    navUuid: 'NAV-NEW', icon, title: JSON.stringify(title(name)),
    formUuid: 'NAV-SYSTEM-FROM-ME-UUID', gmtModified: '123',
    listOrder: '7', hidden: 'n', mobileHidden: 'y', parentNavUuid: ROOT_NAV_UUID,
  });
  expect(httpPost.mock.calls[1][1]).toContain('updateFormNavigation.json?_api=Nav.update');
  expect(JSON.parse(console.log.mock.calls[0][0])).toMatchObject({
    success: true, group: { icon, navUuid: 'NAV-NEW' }, iconSource: 'auto', readbackVerified: true,
  });
});

test('explicit icon is normalized and targets only the newly created child under the requested parent', async () => {
  const parent = group('业务', { navUuid: 'NAV-PARENT' });
  const old = group('客户', { navUuid: 'NAV-OLD', gmtCreate: 999999 });
  const other = group('客户', { navUuid: 'NAV-OTHER', parentNavUuid: 'NAV-ELSE' });
  const created = group('客户', { parentNavUuid: parent.navUuid, formUuid: 'existing-form' });
  httpGet.mockResolvedValueOnce(reply([parent, old]))
    .mockResolvedValueOnce(reply([parent, old, other, created]))
    .mockResolvedValueOnce(reply([parent, old, { ...created, icon: 'Project' }]));
  await run(['create', 'APP_TEST', '客户', '--parent', 'NAV-PARENT', '--icon', 'project']);
  expect(new URLSearchParams(httpPost.mock.calls[1][2]).get('navUuid')).toBe('NAV-NEW');
  expect(new URLSearchParams(httpPost.mock.calls[1][2]).get('formUuid')).toBe('existing-form');
  expect(JSON.parse(console.log.mock.calls[0][0]).iconSource).toBe('explicit');
});

test('invalid icons fail before reading or creating resources', async () => {
  await expect(run(['create', 'APP_TEST', '客户', '--icon', 'xian-user%%blue']))
    .rejects.toMatchObject({ code: 'NAV_GROUP_ICON_INVALID' });
  expect(httpGet).not.toHaveBeenCalled();
  expect(httpPost).not.toHaveBeenCalled();
});

test.each(['missing', 'ambiguous', 'update', 'readback', 'readback-error', 'save'])('reports %s failure without retrying creation or modifying another group', async (failure) => {
  const created = group('客户');
  const matches = failure === 'missing' ? [] : failure === 'ambiguous'
    ? [created, { ...created, navUuid: 'NAV-SECOND' }] : [created];
  httpGet.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply(matches));
  if (failure === 'readback-error') {httpGet.mockRejectedValueOnce(new Error('offline'));}
  else {httpGet.mockResolvedValueOnce(reply([created]));}
  if (failure === 'save') {httpPost.mockRejectedValueOnce(new Error('timeout'));}
  if (failure === 'update') {
    httpPost.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error('update failed'));
  }
  await expect(run(['create', 'APP_TEST', '客户'])).rejects.toMatchObject({
    code: 'NAV_GROUP_CREATE_INCOMPLETE', details: {
      retrySafe: false, readbackVerified: false, nextStep: 'openyida nav-group list APP_TEST --flat',
    },
  });
  expect(httpPost.mock.calls.filter((call) => call[1].includes('/saveFormNavigation.json'))).toHaveLength(1);
  if (['missing', 'ambiguous', 'save'].includes(failure)) {expect(httpPost).toHaveBeenCalledTimes(1);}
  expect(console.log).not.toHaveBeenCalled();
});

test('list exposes existing group icons without writing or changing them', async () => {
  httpGet.mockResolvedValueOnce(reply([group('客户', { icon: 'folder' })]));
  await run(['list', 'APP_TEST']);
  expect(JSON.parse(console.log.mock.calls[0][0]).tree[0].icon).toBe('folder');
  expect(httpPost).not.toHaveBeenCalled();
});
