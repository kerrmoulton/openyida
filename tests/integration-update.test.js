'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
jest.mock('../lib/core/yida-client', () => ({ createAuthRef: jest.fn(() => ({ corpId: 'corp' })) }));
jest.mock('../lib/integration/integration-api', () => ({ saveProcess: jest.fn() }));
jest.mock('../lib/integration/integration-baseline', () => ({
  loadBaseline: jest.fn(), readState: jest.fn(), recordBaseline: jest.fn(), writePrivate: jest.fn(),
  location: jest.fn(() => '/private/baseline.json'),
  fail: (reason, details = {}) => { const error = new Error(reason); error.code = 'INTEGRATION_BASELINE_UNSAFE';
    error.details = { remoteWrites: 0, ...details }; throw error; },
}));
const baseline = require('../lib/integration/integration-baseline');
const api = require('../lib/integration/integration-api');
const { run } = require('../lib/integration/integration-update');

describe('integration safe incremental update', () => {
  let dir, file;
  const record = () => ({ nodeIdMap: { message: 'node' }, state: { fingerprint: 'before', binding: { status: 'n' } },
    processJson: { nodes: [{ nodeId: 'node', name: 'old', props: {}, childNodes: [] }] },
    viewJson: { schema: { children: [{ id: 'node', props: { name: 'old' } }] }, globalSetting: { unknown: true } } });
  const state = () => ({ fingerprint: 'before', binding: { status: 'n' } });
  const args = () => ['APP', 'FORM', 'PROC', '--patch', file];
  beforeEach(() => {
    jest.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-safe-update-'));
    file = path.join(dir, 'patch.json');
    fs.writeFileSync(file, JSON.stringify({ nodes: [{ id: 'message', name: 'new' }] }));
    baseline.loadBaseline.mockReturnValue(record());
    baseline.readState.mockResolvedValue(state());
    baseline.recordBaseline.mockResolvedValue({ available: true, flowStatus: 'n' });
    api.saveProcess.mockResolvedValue({ success: true });
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); console.log.mockRestore(); });
  test('preview reads state and never writes', async () => {
    await expect(run([...args(), '--dry-run'])).resolves.toMatchObject({ changed: true, remoteWrites: 0, dryRun: true });
    expect(api.saveProcess).not.toHaveBeenCalled(); expect(baseline.writePrivate).not.toHaveBeenCalled();
  });
  test('missing baseline stops before any remote mutation', async () => {
    baseline.loadBaseline.mockImplementationOnce(() => baseline.fail('baseline missing'));
    await expect(run(args())).rejects.toHaveProperty('code', 'INTEGRATION_BASELINE_UNSAFE');
    expect(api.saveProcess).not.toHaveBeenCalled();
  });
  test.each(['remote', 'expect', 'second read'])('rejects a %s concurrency conflict', async mode => {
    if (mode === 'remote') { baseline.readState.mockResolvedValueOnce({ ...state(), fingerprint: 'changed' }); }
    if (mode === 'second read') { baseline.readState.mockResolvedValueOnce(state()).mockResolvedValueOnce({ ...state(), fingerprint: 'changed' }); }
    await expect(run(mode === 'expect' ? [...args(), '--expect', 'wrong'] : args())).rejects.toHaveProperty('code', 'INTEGRATION_BASELINE_UNSAFE');
    expect(api.saveProcess).not.toHaveBeenCalled();
  });
  test('rejects active flow updates', async () => {
    baseline.readState.mockResolvedValueOnce({ ...state(), binding: { status: 'y' } });
    await expect(run(args())).rejects.toThrow('disable'); expect(api.saveProcess).not.toHaveBeenCalled();
  });
  test.each(['y', undefined])('rejects changed or unknown status during the second read (%s)', async status => {
    baseline.readState.mockResolvedValueOnce(state()).mockResolvedValueOnce({ ...state(), binding: { status } });
    await expect(run(args())).rejects.toThrow('remain disabled');
    expect(api.saveProcess).not.toHaveBeenCalled();
    expect(baseline.writePrivate).toHaveBeenCalledTimes(1);
  });
  test('journals original before one-shot save and verifies before marking success', async () => {
    const result = await run(args());
    expect(result).toMatchObject({ readbackVerified: true, runtimeVerified: false, remoteWrites: 1 });
    expect(api.saveProcess).toHaveBeenCalledTimes(1);
    expect(api.saveProcess.mock.calls[0][1]).toMatchObject({ oneShot: true, isOnline: false });
    expect(baseline.writePrivate.mock.invocationCallOrder[0]).toBeLessThan(api.saveProcess.mock.invocationCallOrder[0]);
    expect(baseline.recordBaseline).toHaveBeenCalledTimes(1);
  });
  test('explicit publish is passed to the native single write and verified by status', async () => {
    baseline.recordBaseline.mockResolvedValueOnce({ available: true, flowStatus: 'y' });
    await expect(run([...args(), '--publish'])).resolves.toMatchObject({ published: true, remoteWrites: 1 });
    expect(api.saveProcess.mock.calls[0][1]).toMatchObject({ isOnline: true, oneShot: true });
  });
  test('unknown write outcome retains evidence and never retries', async () => {
    api.saveProcess.mockRejectedValueOnce(new Error('timeout'));
    await expect(run(args())).rejects.toMatchObject({ details: { remoteWrites: 1, retrySafe: false, journal: expect.any(String) } });
    expect(api.saveProcess).toHaveBeenCalledTimes(1); expect(baseline.recordBaseline).not.toHaveBeenCalled();
  });
  test('readback failure never reports verified or rolls back', async () => {
    baseline.recordBaseline.mockRejectedValueOnce(new Error('readback mismatch'));
    await expect(run(args())).rejects.toMatchObject({ details: { mutationAccepted: true, remoteWrites: 1, retrySafe: false } });
    expect(api.saveProcess).toHaveBeenCalledTimes(1);
  });
  test('unchanged patch is a true zero-write operation', async () => {
    fs.writeFileSync(file, JSON.stringify({ nodes: [{ id: 'message', description: '' }] }));
    const initial = record(); initial.processJson.nodes[0].description = ''; initial.viewJson.schema.children[0].props.description = '';
    baseline.loadBaseline.mockReturnValue(initial);
    await expect(run(args())).resolves.toMatchObject({ changed: false, remoteWrites: 0 });
    expect(api.saveProcess).not.toHaveBeenCalled();
  });
  test('explicit publishing of an unchanged disabled draft performs one verified publish', async () => {
    fs.writeFileSync(file, JSON.stringify({ nodes: [{ id: 'message', description: '' }] }));
    const initial = record(); initial.processJson.nodes[0].description = ''; initial.viewJson.schema.children[0].props.description = '';
    baseline.loadBaseline.mockReturnValue(initial);
    baseline.recordBaseline.mockResolvedValueOnce({ available: true, flowStatus: 'y' });
    await expect(run([...args(), '--publish'])).resolves.toMatchObject({ changed: false,
      remoteWrites: 1, published: true, readbackVerified: true });
    expect(api.saveProcess).toHaveBeenCalledTimes(1);
    expect(api.saveProcess.mock.calls[0][1]).toMatchObject({ isOnline: true, oneShot: true });
  });
});
