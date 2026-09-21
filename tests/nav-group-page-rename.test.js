'use strict';

const querystring = require('querystring');

jest.mock('../lib/core/utils', () => ({
  httpGet: jest.fn(),
  httpPost: jest.fn(),
  requestWithAutoLogin: jest.fn(),
}));

const utils = require('../lib/core/utils');
const {
  buildPageRenamePayloads,
  postPageTitleRename,
} = require('../lib/app/nav-group');

const pageNode = {
  navType: 'PAGE',
  navUuid: 'FORM-PAGE-1',
  formUuid: 'FORM-PAGE-1',
  title: {
    key: 'existingKey',
    zh_CN: '旧名称',
    en_US: 'Existing English name',
    pureEn_US: 'Original name',
    ja_JP: '元の名前',
  },
};

describe('page navigation rename', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utils.requestWithAutoLogin.mockImplementation(async (operation) => {
      return operation({ baseUrl: 'https://example.test' });
    });
  });

  test('buildPageRenamePayloads preserves unspecified translations', () => {
    const payloads = buildPageRenamePayloads(pageNode, '新名称');

    expect(payloads.i18n.i18nKey).toBe('existingKey');
    expect(JSON.parse(payloads.i18n.i18nText)).toEqual({
      zh_CN: '新名称',
      en_US: 'Existing English name',
      pureEn_US: 'Original name',
      ja_JP: '元の名前',
    });
    expect(JSON.parse(payloads.formTitle.title)).toEqual({
      key: 'existingKey',
      en_US: 'Existing English name',
      zh_CN: '新名称',
      type: 'i18n',
    });
  });

  test('postPageTitleRename saves i18n before updating the form title', async () => {
    utils.httpPost
      .mockResolvedValueOnce({ success: true, content: 'savedKey' })
      .mockResolvedValueOnce({ success: true, content: true });

    await postPageTitleRename('APP_TEST', pageNode, '新名称', { en: 'New title' }, {});

    expect(utils.httpPost).toHaveBeenCalledTimes(2);
    expect(utils.httpPost.mock.calls[0][1]).toContain('/APP_TEST/query/appI18n/createOrUpdateI18nItem.json');
    expect(querystring.parse(utils.httpPost.mock.calls[0][2])).toMatchObject({
      i18nKey: 'existingKey',
    });
    expect(utils.httpPost.mock.calls[1][1]).toContain('/dingtalk/web/APP_TEST/query/formdesign/updateFormTitle.json');
    const formPayload = querystring.parse(utils.httpPost.mock.calls[1][2]);
    expect(formPayload.formUuid).toBe('FORM-PAGE-1');
    expect(JSON.parse(formPayload.title)).toEqual({
      key: 'savedKey',
      en_US: 'New title',
      zh_CN: '新名称',
      type: 'i18n',
    });
  });
});
