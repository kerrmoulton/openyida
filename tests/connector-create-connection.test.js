'use strict';

const { buildSecurityValue, getCreatedConnectionId } = require('../lib/connector/connector-create-connection');

describe('connector authentication account payload', () => {
  test('uses the API key parameter name declared by the connector', () => {
    const value = buildSecurityValue(
      { apiKey: 'test-value' },
      'ApiKeyAuth',
      { ApiKeyAuth: { name: 'X-Performance-Api-Key', location: 'header' } }
    );
    expect(JSON.parse(value)).toEqual({ 'X-Performance-Api-Key': 'test-value' });
  });

  test('rejects an API key account without a named authentication parameter', () => {
    expect(() => buildSecurityValue({ apiKey: 'test-value' }, 'ApiKeyAuth', {}))
      .toThrow('连接器缺少 API 密钥参数名称');
  });

  test('reports the account ID returned as a number by the platform', () => {
    expect(getCreatedConnectionId(30317)).toBe(30317);
  });
});
