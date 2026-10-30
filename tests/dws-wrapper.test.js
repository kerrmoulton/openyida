'use strict';

jest.mock('child_process', () => ({ execSync: jest.fn(), spawn: jest.fn() }));
const { execSync, spawn } = require('child_process');
const { run } = require('../lib/dws/dws-wrapper');

let exitCode;
beforeEach(() => {
  exitCode = process.exitCode;
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  process.exitCode = exitCode;
  jest.restoreAllMocks();
});

test.each(['install', 'setup'])('%s only shows official instructions without launching an installer', async action => {
  await run([action]);
  expect(console.log.mock.calls.flat().join('\n')).toContain('https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/');
  expect(execSync).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(exitCode);
});

test('missing external dws returns installation guidance without a prompt or download', async () => {
  execSync.mockImplementation(() => { throw new Error('not found'); });
  await run(['version']);
  expect(execSync).toHaveBeenCalledTimes(1);
  expect(execSync.mock.calls[0][0]).toMatch(/^(which|where) dws$/);
  expect(spawn).not.toHaveBeenCalled();
  expect(console.log.mock.calls.flat().join('\n')).toContain('dingtalk-workspace-cli/releases');
  expect(process.exitCode).toBe(1);
});

test('installed dws receives original arguments without a shell or an installer', async () => {
  execSync.mockReturnValue('/external/bin/dws');
  spawn.mockReturnValue({ on: jest.fn() });
  const argv = ['aicard', 'lint', '--file', '/tmp/card with spaces.json', '--format', 'json'];
  await run(argv);
  expect(execSync).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledWith('dws', argv, expect.objectContaining({ stdio: 'inherit' }));
  expect(spawn.mock.calls[0][2].shell).not.toBe(true);
});
