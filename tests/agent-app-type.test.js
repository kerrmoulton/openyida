'use strict';
const { isAgentAppType } = require('../lib/app/agent-app-type');

test.each(['cloud', 'local', 'web_local', 'qwenwork', ' WEB_LOCAL ', 'future_channel', 'unknown'])('accepts server AI type %s', value => {
  expect(isAgentAppType(value)).toBe(true);
});
test.each(['none', ' NONE ', '', '  ', null, undefined, false, 1, {}, ['cloud']])('rejects absent or non-AI type %p', value => {
  expect(isAgentAppType(value)).toBe(false);
});
