'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
jest.mock('../lib/core/yida-client', () => ({ createAuthRef: jest.fn(() => ({})), createYidaClient: jest.fn() }));
jest.mock('../lib/integration/integration-api', () => ({ getFormSchema: jest.fn() }));
const { createYidaClient } = require('../lib/core/yida-client');
const { getFormSchema } = require('../lib/integration/integration-api');
const { builtin } = require('../lib/formula/metadata');
const { run } = require('../lib/formula/commands');
const metadata = { success: true, content: { expressionMapping: Object.fromEntries(Object.entries(builtin.functions).map(([name, fn]) => [name, {
  inputs: { requiredParams: fn.required.map(baseType => ({ baseType })), notRequiredParams: fn.optional.map(baseType => ({ baseType })), notRequiredCount: fn.variadic ? 'N' : fn.optional.length, needSameType: fn.sameType }, outputs: { baseType: fn.result }, desc: fn.description,
}])), componentMapping: Object.fromEntries(Object.entries(builtin.components).map(([name, type]) => [name, { type }])) } };

describe('formula platform commands', () => {
  let directory, dataFile, get, postFormOnce, log;
  beforeEach(() => {
    getFormSchema.mockClear();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-formula-'));
    dataFile = path.join(directory, 'data.json');
    fs.writeFileSync(dataFile, JSON.stringify({ numberField_amount: 12.345 }));
    get = jest.fn().mockResolvedValue(metadata);
    postFormOnce = jest.fn().mockResolvedValue({ success: true, content: '12.35' });
    createYidaClient.mockReturnValue({ get, postFormOnce });
    getFormSchema.mockResolvedValue([{ componentName: 'NumberField', props: { fieldId: 'numberField_amount', formula: 'ROUND(1,2)', valueType: 'formula', complexValue: { complexType: 'formula', formula: 'ROUND(1,2)' } } }]);
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { log.mockRestore(); fs.rmSync(directory, { recursive: true, force: true }); });

  test('queries current signatures and exports a new snapshot without overwriting files', async () => {
    const output = path.join(directory, 'metadata.json');
    const result = await run('functions', ['APP_TEST', '--name', 'ROUND', '--output', output, '--json']);
    expect(result.functions[0]).toMatchObject({ name: 'ROUND', required: [['number'], ['number']], contextAvailable: true });
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual(metadata);
    await expect(run('functions', ['APP_TEST', '--output', output])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test('inspects configured formulas without execution', async () => {
    expect(await run('inspect', ['APP_TEST', 'FORM_TEST', '--field', 'numberField_amount'])).toMatchObject({ runtimeVerified: false, fields: [{ fieldId: 'numberField_amount', formula: 'ROUND(1,2)' }] });
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test('sends field data once and preserves the platform result type', async () => {
    const result = await run('test', ['APP_TEST', 'FORM_TEST', 'ROUND(#{numberField_amount},2)', '--data-file', dataFile, '--expect', '"12.35"']);
    expect(result).toMatchObject({ success: true, value: '12.35', valueType: 'string', saved: false, verification: 'expression-endpoint', binding: 'platform', runtimeVerified: false });
    expect(postFormOnce).toHaveBeenCalledTimes(1);
    expect(postFormOnce).toHaveBeenCalledWith(expect.stringContaining('/query/expression/evaluate.json'), { expression: 'ROUND(#{numberField_amount},2)', varMap: '{"numberField_amount":12.345}', formUuid: 'FORM_TEST' });
  });
  test.each([0, false, '', null])('preserves primitive platform result %j', async value => {
    postFormOnce.mockResolvedValue({ success: true, content: value });
    expect(await run('test', ['APP_TEST', 'FORM_TEST', '1', '--data-file', dataFile, '--expect', JSON.stringify(value)])).toMatchObject({ success: true, value });
  });
  test('fails strict expected type comparison', async () => {
    await expect(run('test', ['APP_TEST', 'FORM_TEST', 'ROUND(1,2)', '--data-file', dataFile, '--expect', '12.35'])).rejects.toThrow();
    expect(postFormOnce).toHaveBeenCalledTimes(1);
  });
  test.each(['INSERT("x")', 'IF(TRUE(),1,UPDATE("x"))', 'NEWFUNCTION()', 'round(1,2)', 'USERBUILDER("u")', 'ROUND(1,2,3,4)', 'ROUND(#{numberField_missing},2)'])('blocks unsafe or invalid test before evaluation: %s', async formula => {
    await expect(run('test', ['APP_TEST', 'FORM_TEST', formula, '--data-file', dataFile])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test('queries exact component mappings without reading or evaluating a form', async () => {
    const result = await run('types', ['APP_TEST', '--component', 'NumberField', '--json']);
    expect(result).toMatchObject({ success: true, runtimeVerified: false,
      components: [{ componentName: 'NumberField', valueTypes: builtin.components.NumberField }] });
    expect(result.source.kind).toBe('platform-metadata');
    expect(getFormSchema).not.toHaveBeenCalled();
    expect(postFormOnce).not.toHaveBeenCalled();
    await expect(run('types', ['APP_TEST', '--component', 'numberfield'])).rejects.toThrow();
  });
  test('lists metadata component types and rejects unrelated options', async () => {
    const result = await run('types', ['APP_TEST']);
    expect(result.components).toHaveLength(Object.keys(builtin.components).length);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('DateField —'));
    await expect(run('types', ['APP_TEST', '--field', 'x'])).rejects.toThrow();
  });
  test('requires referenced data and parses the expectation before any evaluation', async () => {
    fs.writeFileSync(dataFile, '{}');
    await expect(run('test', ['APP_TEST', 'FORM_TEST', 'ROUND(#{numberField_amount},2)', '--data-file', dataFile])).rejects.toThrow(/numberField_amount/);
    await expect(run('test', ['APP_TEST', 'FORM_TEST', '1', '--data-file', dataFile, '--expect', 'invalid'])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test('blocks unknown function even when platform metadata lists it', async () => {
    get.mockResolvedValue({ success: true, content: { ...metadata.content, expressionMapping: { ...metadata.content.expressionMapping, NEWFUNCTION: {} } } });
    await expect(run('test', ['APP_TEST', 'FORM_TEST', 'NEWFUNCTION()', '--data-file', dataFile])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test('handles platform errors and rejects irrelevant flags', async () => {
    postFormOnce.mockResolvedValue({ success: false, errorMsg: 'backend rejected' });
    await expect(run('test', ['APP_TEST', 'FORM_TEST', '1', '--data-file', dataFile])).rejects.toThrow(/backend rejected/);
    await expect(run('inspect', ['APP_TEST', 'FORM_TEST', '--expect', '1'])).rejects.toThrow();
  });
  test('tests a saved formula with native field binding and explicit timezone', async () => {
    postFormOnce.mockResolvedValue({ success: true, content: { calculateComplete: true,
      data: [{ fieldId: 'numberField_amount', fieldData: { value: '12.35' } }] } });
    expect(await run('test', ['APP_TEST', 'FORM_TEST', '--field', 'numberField_amount', '--data-file', dataFile,
      '--timezone-offset', '0', '--expect', '12.35'])).toMatchObject({ success: true, value: 12.35, timezoneOffset: 0 });
    expect(postFormOnce.mock.calls[0][1]._locale_time_zone_offset).toBe(0);
  });
  test('runs repeatable field cases and retains failures by name', async () => {
    fs.writeFileSync(dataFile, JSON.stringify([
      { name: 'positive', data: {}, expect: 12.35 }, { name: 'zero', data: {}, expect: 0 },
    ]));
    postFormOnce.mockResolvedValueOnce({ success: true, content: { calculateComplete: true,
      data: [{ fieldId: 'numberField_amount', fieldData: { value: '12.35' } }] } })
      .mockResolvedValueOnce({ success: false, errorMsg: 'calculation failed' });
    await expect(run('test', ['APP_TEST', 'FORM_TEST', '--field', 'numberField_amount', '--cases', dataFile])).rejects.toThrow();
    const result = JSON.parse(log.mock.calls[0][0]);
    expect(result.summary).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(result.results[1]).toMatchObject({ name: 'zero', success: false });
  });
  test('validates every case before executing any formula', async () => {
    fs.writeFileSync(dataFile, JSON.stringify([{ name: 'valid', data: {}, expect: 1 }, { name: 'bad', data: { typo: 1 }, expect: 1 }]));
    await expect(run('test', ['APP_TEST', 'FORM_TEST', '--field', 'numberField_amount', '--cases', dataFile])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
    fs.writeFileSync(dataFile, JSON.stringify([{ name: 'without-expect', data: {} }]));
    await expect(run('test', ['APP_TEST', 'FORM_TEST', '--field', 'numberField_amount', '--cases', dataFile])).rejects.toThrow();
  });

  test.each(['form', 'validation', 'automation', 'business'])('queries exact formula names in context %s and keeps a complete exported snapshot', async selectedContext => {
    const output = path.join(directory, 'snapshot.json');
    const result = await run('functions', ['APP_TEST', '--name', 'ROUND', '--context', selectedContext, '--output', output, '--json']);
    expect(result).toMatchObject({ context: selectedContext, consumerAvailabilityVerified: false, functions: [{ name: 'ROUND' }] });
    expect(Object.keys(JSON.parse(fs.readFileSync(output, 'utf8')).content.expressionMapping).length).toBeGreaterThan(1);
    await expect(run('functions', ['APP_TEST', '--name', 'round'])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test('numeric-literals is an explicit endpoint probe and does not change stored formulas or raw data', async () => {
    const expression = 'ROUND(#{numberField_amount},2)';
    const result = await run('test', ['APP_TEST', 'FORM_TEST', expression, '--data-file', dataFile, '--binding', 'numeric-literals', '--context', 'validation', '--json']);
    expect(result).toMatchObject({ verification: 'expression-endpoint', runtimeVerified: false, binding: 'numeric-literals', context: 'validation', expression: 'ROUND((12.345),2)' });
    expect(postFormOnce.mock.calls[0][1].varMap).toBe('{"numberField_amount":12.345}');
    expect(await getFormSchema.mock.results[0].value).toMatchObject([{ props: { formula: 'ROUND(1,2)' } }]);
  });
  test('candidate field formula, data file and default timezone use the native field endpoint without saving', async () => {
    postFormOnce.mockResolvedValue({ success: true, content: { calculateComplete: true,
      data: [{ fieldId: 'numberField_amount', fieldData: { value: '0' } }] } });
    const result = await run('test', ['APP_TEST', 'FORM_TEST', 'ROUND(0,2)', '--field', 'numberField_amount', '--data-file', dataFile, '--expect', '0', '--json']);
    expect(result).toMatchObject({ success: true, value: 0, timezoneOffset: 480, saved: false, verification: 'field-runtime' });
    expect(postFormOnce).toHaveBeenCalledTimes(1);
    expect(postFormOnce.mock.calls[0][0]).toContain('/query/formFormula/evaluatePlus.json');
    expect(JSON.parse(postFormOnce.mock.calls[0][1].bindingComponentFormulaList)[0].formRule).toBe('ROUND(0,2)');
    expect(await getFormSchema.mock.results[0].value).toMatchObject([{ props: { formula: 'ROUND(1,2)' } }]);
  });
  test.each([
    ['--field', 'numberField_amount', '--binding', 'platform'],
    ['--field', 'numberField_amount', '--context', 'validation'],
    ['--timezone-offset', '480'], ['--binding', 'unknown'], ['--context', 'automation'],
    ['--field', 'numberField_amount', '--timezone-offset', '841'],
    ['--field', 'numberField_amount', '--timezone-offset', '0.5'],
    ['--field', 'tree-id-instead-of-field-id'], ['--unknown'], ['--json', '--json'],
  ])('rejects invalid test options before evaluation: %j', async (...flags) => {
    await expect(run('test', ['APP_TEST', 'FORM_TEST', 'ROUND(1,2)', '--data-file', dataFile, ...flags])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test.each([
    [], Array.from({ length: 101 }, (_, index) => ({ name: 'case-' + index, data: {}, expect: 0 })),
    [{ name: 'same', data: {}, expect: 0 }, { name: 'same', data: {}, expect: 0 }],
    [{ name: ' ', data: {}, expect: 0 }], [{ name: 'extra', data: {}, expect: 0, unknown: true }],
  ].map(cases => [cases]))('rejects malformed case batches before evaluating any sample: %#', async cases => {
    fs.writeFileSync(dataFile, JSON.stringify(cases));
    await expect(run('test', ['APP_TEST', 'FORM_TEST', '--field', 'numberField_amount', '--cases', dataFile])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test.each([
    [], ['--data-file', 'unused.json'], ['--expect', '0'],
  ])('enforces case mode requirements and mutually exclusive input options: %j', async (...flags) => {
    fs.writeFileSync(dataFile, JSON.stringify([{ name: 'one', data: {}, expect: 0 }]));
    const fieldArgs = flags.length ? ['--field', 'numberField_amount'] : [];
    await expect(run('test', ['APP_TEST', 'FORM_TEST', 'ROUND(1,2)', '--cases', dataFile, ...fieldArgs, ...flags])).rejects.toThrow();
    expect(postFormOnce).not.toHaveBeenCalled();
  });
  test('accepts 100 field cases, retaining JSON types, names and verification boundaries', async () => {
    const cases = Array.from({ length: 100 }, (_, index) => ({ name: 'case-' + index, data: {}, expect: 0 }));
    fs.writeFileSync(dataFile, JSON.stringify(cases));
    postFormOnce.mockResolvedValue({ success: true, content: { calculateComplete: true,
      data: [{ fieldId: 'numberField_amount', fieldData: { value: '0' } }] } });
    const result = await run('test', ['APP_TEST', 'FORM_TEST', '--field', 'numberField_amount', '--cases', dataFile, '--json']);
    expect(result).toMatchObject({ success: true, verification: 'field-runtime-cases', saved: false, runtimeVerified: false, summary: { total: 100, passed: 100, failed: 0 } });
    expect(result.results.map(item => item.name)).toEqual(cases.map(item => item.name));
    expect(postFormOnce).toHaveBeenCalledTimes(100);
  });
});
