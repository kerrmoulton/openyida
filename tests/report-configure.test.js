'use strict';

jest.mock('../lib/core/yida-client', () => ({ createAuthRef: jest.fn(), isAuthRefReady: jest.fn() }));
jest.mock('../lib/report/http', () => ({ getReportSchema: jest.fn(), saveReportSchema: jest.fn() }));
jest.mock('../lib/report/runtime-probe', () => ({ probeReportSchema: jest.fn() }));

const { createAuthRef, isAuthRefReady } = require('../lib/core/yida-client');
const { getReportSchema, saveReportSchema } = require('../lib/report/http');
const { probeReportSchema } = require('../lib/report/runtime-probe');
const { run, parseArgs, findChart } = require('../lib/report/configure');
const { buildAfterFetch } = require('../lib/report/field-utils');
const { buildZeroValueAfterFetch, isZeroValueAfterFetch } = require('../lib/report/zero-values');
const { prepareReportSchemaForSave } = require('../lib/report/contract');

const auth = { baseUrl: 'https://demo.aliwork.com' };
const argv = ['APP_1', 'REPORT_1', 'cid_1', '--hide-zero-values', 'true', '--json'];
function fixture() {
  return { id: 'REPORT_1', gmtModified: 42, config: { prdId: '123' },
    pages: [{ componentsTree: [{ componentName: 'Page', children: [{
      componentName: 'YoushuGroupedBarChart', id: 'node_1', props: {
        cid: 'cid_1', afterFetch: buildAfterFetch(), enabledCache: true,
        settings: { legend: { visible: true } },
        dataSetModelMap: { chartData: { yField: [{ fieldKey: 'm1' }, { fieldKey: 'm2' }],
          dataViewQueryModel: { cubeCode: 'FORM_1' } } },
      },
    }, { componentName: 'YoushuTable', props: { cid: 'cid_other', title: '保留其他组件' } }] }] }],
  };
}

describe('report configure revision-safe zero-value option', () => {
  let log;
  let current;
  beforeEach(() => {
    jest.resetAllMocks();
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    current = fixture();
    createAuthRef.mockReturnValue(auth);
    isAuthRefReady.mockReturnValue(true);
    getReportSchema.mockImplementation(async () => ({ success: true, content: current }));
    saveReportSchema.mockImplementation(async (ref, app, report, schema) => {
      current = JSON.parse(JSON.stringify({ ...schema, gmtModified: 43 }));
      return { success: true };
    });
    probeReportSchema.mockResolvedValue({ runtimeQueryVerified: true, probes: [] });
  });
  afterEach(() => log.mockRestore());

  test.each([
    [], ['APP_1', 'REPORT_1', 'cid_1'], [...argv, '--hide-zero-values', 'true'],
    ['APP_1', 'REPORT_1', 'cid_1', '--hide-zero-values', '1'], [...argv, '--unknown'], [...argv, '-x'],
  ].map(args => [args]))('requires explicit literal boolean and strict arguments: %p', async args => {
    await expect(run(args)).rejects.toMatchObject({ code: 'REPORT_CONFIGURE_INVALID_ARGUMENTS' });
    expect(getReportSchema).not.toHaveBeenCalled();
    expect(saveReportSchema).not.toHaveBeenCalled();
  });

  test('dry-run reads one exact target without saving or querying', async () => {
    const original = JSON.stringify(current);
    const result = await run([...argv, '--dry-run']);
    expect(result).toMatchObject({ changed: true, dryRun: true, mutationPerformed: false, hideZeroValues: true });
    expect(JSON.stringify(current)).toBe(original);
    expect(saveReportSchema).not.toHaveBeenCalled();
    expect(probeReportSchema).not.toHaveBeenCalled();
  });

  test('enables one chart, preserves siblings/bindings/cache and verifies the saved hook and data query', async () => {
    const before = prepareReportSchemaForSave(current, { serverRevision: 42 });
    const result = await run(argv);
    const saved = saveReportSchema.mock.calls[0][3];
    const node = findChart(saved, 'cid_1');
    expect(isZeroValueAfterFetch(node.props.afterFetch)).toBe(true);
    const expected = JSON.parse(JSON.stringify(before));
    findChart(expected, 'cid_1').props.afterFetch = buildZeroValueAfterFetch();
    expect(saved).toEqual(expected);
    expect(saveReportSchema).toHaveBeenCalledWith(auth, 'APP_1', 'REPORT_1', saved, 42);
    expect(saveReportSchema).toHaveBeenCalledTimes(1);
    expect(getReportSchema).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ revision: 43, readbackVerified: true, runtimeQueryVerified: true,
      mutationPerformed: true, verificationLevel: 'strict-schema-content' });
    const probeSchema = probeReportSchema.mock.calls[0][3];
    expect(probeSchema.pages[0].componentsTree).toEqual([findChart(current, 'cid_1')]);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual(result);
  });

  test('disable restores identity hook and leaves field bindings available', async () => {
    findChart(current, 'cid_1').props.afterFetch = buildZeroValueAfterFetch();
    await run(['APP_1', 'REPORT_1', 'cid_1', '--hide-zero-values', 'false']);
    expect(findChart(current, 'cid_1').props.afterFetch).toEqual(buildAfterFetch());
    expect(findChart(current, 'cid_1').props.dataSetModelMap.chartData.yField).toHaveLength(2);
  });

  test('configures category and legend scope separately, preserves omitted options and resets on disable', async () => {
    const first = await run([...argv, '--hide-zero-categories', 'true', '--hide-zero-legends', 'true']);
    expect(first).toMatchObject({ hideZeroCategories: true, hideZeroLegends: true });
    const second = await run([...argv, '--hide-zero-categories', 'false']);
    expect(second).toMatchObject({ changed: true, hideZeroCategories: false, hideZeroLegends: true });
    expect(saveReportSchema).toHaveBeenCalledTimes(2);
    const third = await run(argv);
    expect(third).toMatchObject({ changed: false, hideZeroCategories: false, hideZeroLegends: true });
    expect(saveReportSchema).toHaveBeenCalledTimes(2);
    const off = await run(['APP_1', 'REPORT_1', 'cid_1', '--hide-zero-values', 'false']);
    expect(off).toMatchObject({ hideZeroValues: false, hideZeroCategories: false, hideZeroLegends: false });
  });

  test.each([
    ['--hide-zero-categories', 'yes'], ['--hide-zero-legends', '1'],
    ['--hide-zero-categories', 'false', '--hide-zero-categories', 'true'],
  ])('rejects invalid scope flags before reading or writing: %p', (...flags) => {
    expect(() => parseArgs([...argv, ...flags])).toThrow();
    expect(getReportSchema).not.toHaveBeenCalled();
  });

  test('scope flags cannot enable hiding when the main switch is disabled', () => {
    expect(() => parseArgs(['APP_1', 'REPORT_1', 'cid_1', '--hide-zero-values', 'false', '--hide-zero-legends', 'true'])).toThrow();
  });

  test.each([true, false])('same state %s is idempotent', async enabled => {
    findChart(current, 'cid_1').props.afterFetch = enabled ? buildZeroValueAfterFetch() : buildAfterFetch();
    const result = await run(['APP_1', 'REPORT_1', 'cid_1', '--hide-zero-values', String(enabled)]);
    expect(result).toMatchObject({ changed: false, mutationPerformed: false });
    expect(saveReportSchema).not.toHaveBeenCalled();
    expect(probeReportSchema).not.toHaveBeenCalled();
  });

  test.each([true, false])('custom hooks cannot be overwritten when setting %s', async enabled => {
    findChart(current, 'cid_1').props.afterFetch = { type: 'js', source: 'function custom(data) {return data.slice(1);}' };
    await expect(run(['APP_1', 'REPORT_1', 'cid_1', '--hide-zero-values', String(enabled)]))
      .rejects.toMatchObject({ code: 'REPORT_ZERO_VALUES_CUSTOM_HOOK' });
    expect(saveReportSchema).not.toHaveBeenCalled();
  });

  test('action references remain custom even if source looks like the default hook', async () => {
    findChart(current, 'cid_1').props.afterFetch = { ...buildAfterFetch(), id: 'custom_action' };
    await expect(run(argv)).rejects.toMatchObject({ code: 'REPORT_ZERO_VALUES_CUSTOM_HOOK' });
    expect(saveReportSchema).not.toHaveBeenCalled();
  });

  test('resolves the same top-level cid returned by inspect', () => {
    const node = findChart(current, 'cid_1');
    delete node.props.cid;
    node.cid = 'top_level_cid';
    expect(findChart(current, 'top_level_cid')).toBe(node);
  });

  test.each(['missing', 'duplicate', 'unsupported', 'unbound', 'identity', 'revision', 'login', 'expired'])(
    'rejects %s before saving', async mode => {
      const node = findChart(current, 'cid_1');
      if (mode === 'missing') {node.props.cid = 'other';}
      if (mode === 'duplicate') {current.pages.push(current.pages[0]);}
      if (mode === 'unsupported') {node.componentName = 'YoushuLineChart';}
      if (mode === 'unbound') {node.props.dataSetModelMap.chartData.yField = [];}
      if (mode === 'identity') {current.id = 'REPORT_OTHER';}
      if (mode === 'revision') {delete current.gmtModified;}
      if (mode === 'login') {isAuthRefReady.mockReturnValue(false);}
      if (mode === 'expired') {getReportSchema.mockResolvedValue({ success: true, __needLogin: true });}
      await expect(run(argv)).rejects.toThrow();
      expect(saveReportSchema).not.toHaveBeenCalled();
    });

  test.each([new Error('timeout'), { success: false, errorCode: '500' }, { __needLogin: true }])(
    'uncertain saves and revision conflicts are never replayed: %p', async failure => {
      if (failure instanceof Error) {saveReportSchema.mockRejectedValue(failure);}
      else {saveReportSchema.mockResolvedValue(failure);}
      await expect(run(argv)).rejects.toMatchObject({ code: 'REPORT_CONFIGURE_SAVE_FAILED',
        details: { retrySafe: false, sideEffectState: 'unknown', readbackAllowed: true } });
      expect(saveReportSchema).toHaveBeenCalledTimes(1);
      expect(getReportSchema).toHaveBeenCalledTimes(1);
    });

  test.each(['lost-hook', 'changed-sibling', 'identity'])('strict readback rejects %s with partial result', async mode => {
    getReportSchema.mockImplementation(async () => {
      const copy = JSON.parse(JSON.stringify(current));
      if (getReportSchema.mock.calls.length === 2) {
        if (mode === 'lost-hook') {findChart(copy, 'cid_1').props.afterFetch = buildAfterFetch();}
        if (mode === 'changed-sibling') {copy.pages[0].componentsTree[0].children[1].props.title = 'unexpected';}
        if (mode === 'identity') {copy.id = 'REPORT_OTHER';}
      }
      return { success: true, content: copy };
    });
    await expect(run(argv)).rejects.toMatchObject({ code: 'REPORT_CONFIGURE_READBACK_FAILED',
      details: { mutationPerformed: true, retrySafe: false } });
    expect(saveReportSchema).toHaveBeenCalledTimes(1);
    expect(probeReportSchema).not.toHaveBeenCalled();
  });

  test.each([false, 'throw'])('query failure %p keeps successful save evidence', async failure => {
    if (failure === 'throw') {probeReportSchema.mockRejectedValue(new Error('timeout'));}
    else {probeReportSchema.mockResolvedValue({ runtimeQueryVerified: false });}
    await expect(run(argv)).rejects.toMatchObject({ code: 'REPORT_CONFIGURE_QUERY_FAILED',
      details: { mutationPerformed: true, readbackVerified: true, retrySafe: false } });
    expect(saveReportSchema).toHaveBeenCalledTimes(1);
  });

  test('argument parser accepts explicit opt-out', () => {
    expect(parseArgs(['APP_1', 'REPORT_1', 'cid_1', '--hide-zero-values', 'false']))
      .toMatchObject({ enabled: false, dryRun: false });
  });
});
