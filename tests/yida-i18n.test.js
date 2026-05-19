'use strict';

const {
  buildYidaI18n,
  buildYidaTitleI18n,
  normalizeYidaLocale,
  resolveContentLocale,
} = require('../lib/core/yida-i18n');

describe('Yida resource i18n helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('normalizes common content locale aliases', () => {
    expect(normalizeYidaLocale('ja')).toBe('ja_JP');
    expect(normalizeYidaLocale('ja_JP')).toBe('ja_JP');
    expect(normalizeYidaLocale('en-US')).toBe('en_US');
    expect(normalizeYidaLocale('zh_CN.UTF-8')).toBe('zh_CN');
  });

  test('defaults overseas environments to English content locale', () => {
    delete process.env.OPENYIDA_CONTENT_LOCALE;
    delete process.env.YIDA_CONTENT_LOCALE;
    delete process.env.OPENYIDA_APP_LOCALE;
    delete process.env.OPENYIDA_LANG;
    delete process.env.LANG;
    delete process.env.LC_ALL;

    expect(resolveContentLocale({ baseUrl: 'https://www.yidaapps.com' })).toBe('en_US');
    expect(resolveContentLocale({ baseUrl: 'https://www.aliwork.com' })).toBe('zh_CN');
  });

  test('honors explicit Japanese locale over environment defaults', () => {
    process.env.OPENYIDA_LANG = 'zh';

    expect(resolveContentLocale({
      locale: 'ja_JP',
      baseUrl: 'https://www.aliwork.com',
    })).toBe('ja_JP');
  });

  test('builds multilingual YiDA i18n objects with Japanese filled', () => {
    expect(buildYidaI18n('提交', {
      en_US: 'Submit',
      ja_JP: '送信',
    })).toEqual({
      type: 'i18n',
      zh_CN: '提交',
      en_US: 'Submit',
      ja_JP: '送信',
    });
  });

  test('builds form/page title objects without null Japanese locale', () => {
    expect(buildYidaTitleI18n('経費申請', {
      en_US: 'Expense Request',
      ja_JP: '経費申請',
    })).toMatchObject({
      type: 'i18n',
      zh_CN: '経費申請',
      en_US: 'Expense Request',
      pureEn_US: 'Expense Request',
      ja_JP: '経費申請',
      envLocale: null,
      key: null,
    });
  });
});
