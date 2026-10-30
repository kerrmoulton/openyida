'use strict';

jest.mock('../lib/auth/token-store', () => ({
  ...jest.requireActual('../lib/auth/token-store'), loadTokenSession: jest.fn(),
}));
jest.mock('../lib/auth/token-auth', () => ({ tokenRefresh: jest.fn(), getAccessToken: jest.fn() }));

const { loadTokenSession } = require('../lib/auth/token-store');
const { tokenRefresh, getAccessToken } = require('../lib/auth/token-auth');
const { createAuthRef } = require('../lib/core/yida-client');
const { requestNonIdempotentWithAuthPreflight, resolveBearerAuthHeaders } = require('../lib/core/utils');

const managedEnv = {
  OPENYIDA_MANAGED_RUN: '1',
  OPENYIDA_AGENT_APP_TYPE: 'APP_BOUND',
  OPENYIDA_AGENT_CORP_ID: 'bound-corp',
  OPENYIDA_AGENT_USER_ID: 'bound-user',
  OPENYIDA_AGENT_RUN_ID: 'run-test',
  OPENYIDA_AGENT_ATTEMPT_ID: 'attempt-test',
  OPENYIDA_AGENT_BASE_URL: 'https://bound.example.test',
  OPENYIDA_AGENT_TASK_GRANT: 'test-task-grant-not-a-real-credential',
};

let originalEnv;
beforeEach(() => {
  originalEnv = process.env;
  process.env = { ...originalEnv, ...managedEnv };
  jest.clearAllMocks();
});
afterEach(() => { process.env = originalEnv; });

function expectNoPersonalAuth() {
  expect(loadTokenSession).not.toHaveBeenCalled();
  expect(tokenRefresh).not.toHaveBeenCalled();
  expect(getAccessToken).not.toHaveBeenCalled();
}

test.each([
  ['different identity', { access_token: 'personal-token', corp_id: 'other-corp', user_id: 'other-user', base_url: 'https://personal.example.test' }],
  ['same identity, different origin', { access_token: 'personal-token', corp_id: 'bound-corp', user_id: 'bound-user', base_url: 'https://personal.example.test' }],
  ['no personal session', null],
])('managed creation ignores %s and retains task identity, origin and authorization', async (_, session) => {
  loadTokenSession.mockReturnValue(session);
  const auth = createAuthRef();
  const before = JSON.parse(JSON.stringify(auth));
  const preflight = jest.fn(async ref => {
    expect(ref).toEqual(before);
    return { success: true };
  });
  const create = jest.fn(async ref => ({ success: true, origin: ref.baseUrl,
    authorization: (await resolveBearerAuthHeaders()).headers }));

  const result = await requestNonIdempotentWithAuthPreflight(create, preflight, auth);

  expect(preflight).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  expect(auth).toEqual(before);
  expect(result).toEqual({ success: true, origin: managedEnv.OPENYIDA_AGENT_BASE_URL,
    authorization: {
      Authorization: `Bearer ${managedEnv.OPENYIDA_AGENT_TASK_GRANT}`,
      'X-OpenYida-Local-Run-Id': managedEnv.OPENYIDA_AGENT_RUN_ID,
      'X-OpenYida-Local-Attempt-Id': managedEnv.OPENYIDA_AGENT_ATTEMPT_ID,
      'X-OpenYida-Local-App-Type': managedEnv.OPENYIDA_AGENT_APP_TYPE,
    } });
  expectNoPersonalAuth();
});

test('an expired task grant stops before creation without personal login or refresh', async () => {
  const preflight = jest.fn().mockResolvedValue({ __needLogin: true });
  const create = jest.fn();
  const result = await requestNonIdempotentWithAuthPreflight(create, preflight, createAuthRef());
  expect(result).toMatchObject({ success: false, errorCode: 'TOKEN_AUTH_REQUIRED' });
  expect(preflight).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
  expectNoPersonalAuth();
});

test.each(['__needLogin', '__csrfExpired'])('a %s creation result remains unknown and is never replayed', async marker => {
  const preflight = jest.fn().mockResolvedValue({ success: true });
  const create = jest.fn().mockResolvedValue({ [marker]: true });
  const result = await requestNonIdempotentWithAuthPreflight(create, preflight, createAuthRef());
  expect(result).toMatchObject({ success: false, errorCode: 'NON_IDEMPOTENT_RESULT_UNKNOWN', [marker]: true });
  expect(preflight).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  expectNoPersonalAuth();
});

test('a probe outage does not replace the managed context or replay creation', async () => {
  const auth = createAuthRef();
  const before = JSON.parse(JSON.stringify(auth));
  const preflight = jest.fn().mockRejectedValue(new Error('probe unavailable'));
  const create = jest.fn().mockResolvedValue({ success: true });
  await expect(requestNonIdempotentWithAuthPreflight(create, preflight, auth)).resolves.toEqual({ success: true });
  expect(auth).toEqual(before);
  expect(preflight).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  expectNoPersonalAuth();
});

test.each(['OPENYIDA_AGENT_TASK_GRANT', 'OPENYIDA_AGENT_BASE_URL'])('invalid managed context (%s missing) cannot be swallowed by the probe catch', async key => {
  const auth = createAuthRef();
  delete process.env[key];
  const preflight = jest.fn();
  const create = jest.fn();
  await expect(requestNonIdempotentWithAuthPreflight(create, preflight, auth))
    .rejects.toMatchObject({ code: 'MANAGED_CONTEXT_INVALID' });
  expect(preflight).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expectNoPersonalAuth();
});
