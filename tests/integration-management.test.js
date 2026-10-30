'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../lib/core/yida-client', () => ({ createAuthRef: () => ({}),
  createYidaClient: () => ({ get: mockGet, postFormOnce: mockPost }) }));
const { run } = require('../lib/integration/integration-manage');
const ok = content => ({ success: true, content });
const flow = (overrides = {}) => ({ processCode: 'PROC', formUuid: 'FORM', name: 'old', status: 'n', eventType: 1, ...overrides });
describe('automation management contract', () => {
  let dir;
  beforeEach(() => {
    jest.clearAllMocks(); mockGet.mockReset(); mockPost.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-management-'));
  });
  afterEach(() => { console.log.mockRestore(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('copy uses returned identity, honors requested name and keeps new flow disabled', async () => {
    mockGet.mockResolvedValueOnce(ok({ data: [flow()] }))
      .mockResolvedValueOnce(ok({ data: [flow({ processCode: 'NEW', name: 'old_COPY' })] }))
      .mockResolvedValueOnce(ok({ data: [flow({ processCode: 'NEW', name: 'requested' })] }));
    mockPost.mockResolvedValueOnce(ok({ processCode: 'NEW', status: 'n' })).mockResolvedValueOnce(ok(null));
    const result = await run('copy', ['APP', 'FORM', 'PROC', '--name', 'requested']);
    expect(result).toMatchObject({ readbackVerified: true, content: { processCode: 'NEW', name: 'requested' } });
    expect(mockPost.mock.calls[1][1]).toMatchObject({ processCode: 'NEW', name: 'requested' });
    expect(mockPost.mock.calls.filter(([url]) => url.includes('copyflow'))).toHaveLength(1);
  });
  test.each([['FORM_OTHER', 'n', '--confirm'], ['FORM', 'y', '--confirm'], ['FORM', 'n', '--json']])(
    'delete refuses wrong ownership, active flow or missing confirmation %#', async (formUuid, status, flag) => {
      mockGet.mockResolvedValueOnce(ok({ data: [flow({ formUuid, status })] }));
      await expect(run('delete', ['APP', 'FORM', 'PROC', flag])).rejects.toThrow();
      expect(mockPost).not.toHaveBeenCalled();
    });
  test('delete verifies exact absence after a single accepted write', async () => {
    mockGet.mockResolvedValueOnce(ok({ data: [flow()] })).mockResolvedValueOnce(ok({ data: [] }));
    mockPost.mockResolvedValueOnce(ok(null));
    await expect(run('delete', ['APP', 'FORM', 'PROC', '--confirm'])).resolves.toMatchObject({ readbackVerified: true });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
  test('monitor preview checks ownership and capacity without saving', async () => {
    const file = path.join(dir, 'monitor.json');
    fs.writeFileSync(file, JSON.stringify({ processCodes: ['PROC'], intervalTime: 3600, receiverIds: ['USER'], status: 'n' }));
    mockGet.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok({ flowLimit: 50 }))
      .mockResolvedValueOnce(ok({ data: [flow()] })).mockResolvedValueOnce(ok(true));
    await expect(run('monitor', ['APP', '--file', file, '--dry-run'])).resolves.toMatchObject({ dryRun: true, remoteWrites: 0 });
    expect(mockPost).not.toHaveBeenCalled();
  });
  test('documented disabled and enabled monitor files both pass read-only preflight', async () => {
    const guide = fs.readFileSync(require('path').join(__dirname,
      '../yida-skills/skills/yida-integration/references/operations.md'), 'utf8');
    const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]))
      .filter(example => example.processCodes).map(example => JSON.parse(JSON.stringify(example)
        .replace(/<真实processCode>/g, 'PROC').replace(/<真实userId>/g, 'USER')
        .replace(/<查询返回的真实监听uuid>/g, 'MONITOR')));
    expect(examples).toHaveLength(2);
    for (const [index, config] of examples.entries()) {
      const file = require('path').join(dir, `documented-monitor-${index}.json`);
      fs.writeFileSync(file, JSON.stringify(config));
      mockGet.mockResolvedValueOnce(ok(config.uuid ? [{ uuid: config.uuid }] : []))
        .mockResolvedValueOnce(ok({ flowLimit: 10 })).mockResolvedValueOnce(ok({ data: [flow()] }))
        .mockResolvedValueOnce(ok(true));
      await expect(run('monitor', ['APP', '--file', file, '--dry-run'])).resolves.toMatchObject({
        remoteWrites: 0, after: config,
      });
    }
    expect(mockPost).not.toHaveBeenCalled();
  });
  test('monitor validates exact readback and never equates save acknowledgment with success', async () => {
    const file = path.join(dir, 'monitor.json');
    fs.writeFileSync(file, JSON.stringify({ processCodes: ['PROC'], intervalTime: 3600, receiverIds: ['USER'], status: 'n' }));
    mockGet.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok({ flowLimit: 50 }))
      .mockResolvedValueOnce(ok({ data: [flow()] })).mockResolvedValueOnce(ok(true)).mockResolvedValueOnce(ok([]));
    mockPost.mockResolvedValueOnce(ok(true));
    await expect(run('monitor', ['APP', '--file', file])).rejects.toMatchObject({ details: { mutationAccepted: true, retrySafe: false } });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
