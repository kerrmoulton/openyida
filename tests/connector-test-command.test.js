'use strict';

const {
  buildOperationUrl,
  buildTestParams,
  normalizeTestResponse,
  redactResponseHeaders,
} = require('../lib/connector/connector-test');

describe('connector test command', () => {
  test('builds the same absolute operation URL used by the designer', () => {
    expect(buildOperationUrl(
      { scheme: 'https', host: 'api.example.com', baseUrl: '/service/' },
      { url: '/v1/users' }
    )).toBe('https://api.example.com/service/v1/users');
  });

  test('places structured parameters in their explicit request locations', () => {
    expect(buildTestParams({ parameters: {} }, JSON.stringify({
      query: { pageNo: 1 },
      path: { id: 'A/B' },
      header: { 'X-Tenant': 'demo' },
      body: { name: 'Ada' },
    }))).toEqual({
      query: { pageNo: 1 },
      path: { id: 'A/B' },
      header: { 'X-Tenant': 'demo' },
      body: { name: 'Ada' },
    });
    expect(buildOperationUrl(
      { scheme: 'https', host: 'api.example.com', baseUrl: '/' },
      { url: 'users/{id}' },
      { id: 'A/B' }
    )).toBe('https://api.example.com/users/A%2FB');
  });

  test('normalizes the current testOperation response envelope', () => {
    expect(normalizeTestResponse({
      success: true,
      errorCode: '',
      content: {
        statusLine: 'HTTP/1.1 200 ',
        responseHeaders: [{ _1: 'Content-Type', _2: 'application/json' }],
        content: '{"code":"200"}',
      },
    })).toEqual({
      ok: true,
      statusLine: 'HTTP/1.1 200 ',
      statusCode: undefined,
      headers: [{ _1: 'Content-Type', _2: 'application/json' }],
      body: '{"code":"200"}',
      executeTime: undefined,
    });
  });

  test('does not report a platform error as a successful action test', () => {
    expect(normalizeTestResponse({
      success: true,
      errorCode: 404,
      errorMsg: 'No handler found',
      content: {},
    })).toEqual({ ok: false, error: 'No handler found', details: {} });
  });

  test('redacts credential-bearing tuple response headers', () => {
    expect(redactResponseHeaders([
      { _1: 'Content-Type', _2: 'application/json' },
      { _1: 'Set-Cookie', _2: 'session=secret' },
    ])).toEqual([
      { _1: 'Content-Type', _2: 'application/json' },
      { _1: 'Set-Cookie', _2: '***' },
    ]);
  });
});
