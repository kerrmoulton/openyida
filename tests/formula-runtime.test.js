'use strict';

const { buildPlan, evaluateField, convertValue } = require('../lib/formula/runtime');
const { builtin } = require('../lib/formula/metadata');
const field = (id, componentName = 'NumberField', formula, children) => ({ componentName,
  props: { fieldId: id, ...(formula === undefined ? {} : { valueType: 'formula', formula }) }, children });
const schema = [field('price'), field('qty'), field('amount', 'NumberField', 'ROUND(#{price}*#{qty},2)'),
  field('total', 'NumberField', '#{amount}+SUM(#{lineAmount})'),
  field('lines', 'TableField', undefined, [field('linePrice'), field('lineQty'), field('lineAmount', 'NumberField', '#{linePrice}*#{lineQty}')]),
  field('today', 'DateField', 'TIMESTAMP(TODAY())'), field('person', 'EmployeeField', 'USER()')];
const values = { price: 12.3, qty: 2, lines: [{ linePrice: 5, lineQty: 3 }, { linePrice: 0, lineQty: 2 }] };
const params = { appType: 'APP_TEST', formUuid: 'FORM_TEST', schema, values, fieldId: 'amount', metadata: builtin };
const response = (value, extra = {}) => ({ success: true, content: { calculateComplete: true,
  data: [{ fieldId: 'amount', componentName: 'NumberField', fieldData: { value } }], ...extra } });

describe('native field formula binding', () => {
  test('orders dependent calculations, keeps rows separate and does not mutate input', () => {
    const original = JSON.stringify({ schema, values });
    const plan = buildPlan(schema, values, 'total', undefined, 'APP_TEST', builtin);
    expect(plan.bindings.map(item => item.fieldId)).toEqual(['amount', 'lineAmount', 'total']);
    expect(plan.bindings[1]).toMatchObject({ tableFieldId: 'lines', type: 'GENERAL', priority: 2 });
    expect(plan.data.find(item => item.fieldId === 'lines').fieldData.value[1]).toEqual([
      { fieldId: 'linePrice', componentName: 'NumberField', fieldData: { value: 0 } },
      { fieldId: 'lineQty', componentName: 'NumberField', fieldData: { value: 2 } },
      { fieldId: 'lineAmount', componentName: 'NumberField', fieldData: { value: '' } },
    ]);
    expect(JSON.stringify({ schema, values })).toBe(original);
  });
  test('isolates requested formula and supports empty tables and explicit empty input', () => {
    const plan = buildPlan(schema, { lines: [] }, 'lineAmount', undefined, 'APP_TEST', builtin);
    expect(plan.bindings).toHaveLength(1);
    expect(plan.data).toEqual([{ fieldId: 'lines', componentName: 'TableField', fieldData: { value: [] } }]);
    expect(buildPlan(schema, { price: '', qty: 0 }, 'amount', undefined, 'APP_TEST', builtin).data[0].fieldData.value).toBe('');
  });
  test('discards stale caller-supplied calculated values before recomputing dependencies', () => {
    const plan = buildPlan(schema, { ...values, amount: 999, total: 999,
      lines: [{ linePrice: 5, lineQty: 3, lineAmount: 999 }] }, 'total', undefined, 'APP_TEST', builtin);
    expect(plan.data.find(item => item.fieldId === 'amount').fieldData.value).toBe('');
    expect(plan.data.find(item => item.fieldId === 'total').fieldData.value).toBe('');
    expect(plan.data.find(item => item.fieldId === 'lines').fieldData.value[0][2].fieldData.value).toBe('');
  });
  test.each([
    ['missing data', { price: 1 }], ['unknown data', { ...values, typo: 1 }], ['flat child', { ...values, linePrice: 1 }],
    ['bad row', { ...values, lines: [null] }], ['unknown row field', { ...values, lines: [{ typo: 1 }] }],
  ])('rejects incomplete or ambiguous samples: %s', (_label, data) => {
    expect(() => buildPlan(schema, data, 'total', undefined, 'APP_TEST', builtin)).toThrow();
  });
  test.each(['INSERT("x")', 'IF(TRUE(),1,UPDATE("x"))', 'NEWFUNCTION()', 'EXIST(#{price})', 'EQUAL(#{price},#{qty})'])('rejects unsafe or unmodeled formula %s', formula => {
    expect(() => buildPlan(schema, values, 'amount', formula, 'APP_TEST', builtin)).toThrow();
  });
  test('checks every dependency and rejects cycles before execution', () => {
    const unsafe = [field('a', 'NumberField', 'INSERT("x")'), field('b', 'NumberField', '#{a}+1')];
    expect(() => buildPlan(unsafe, {}, 'b', undefined, 'APP_TEST', builtin)).toThrow();
    const cycle = [field('a', 'NumberField', '#{b}'), field('b', 'NumberField', '#{a}')];
    expect(() => buildPlan(cycle, {}, 'a', undefined, 'APP_TEST', builtin)).toThrow(/a.*b.*a/);
  });
  test('rejects empty overrides and unsupported subproperty binding', () => {
    expect(() => buildPlan(schema, values, 'amount', '', 'APP_TEST', builtin)).toThrow();
    expect(() => buildPlan(schema, values, 'amount', '#{price.x}', 'APP_TEST', builtin)).toThrow();
  });
});

describe('native field runtime evaluation', () => {
  let client;
  beforeEach(() => { client = { postFormOnce: jest.fn().mockResolvedValue(response('24.6')) }; });
  test('uses component data and native formula bindings, exposing raw and converted results', async () => {
    const result = await evaluateField(client, { ...params, expected: 24.6 });
    expect(result).toMatchObject({ success: true, rawValue: '24.6', value: 24.6, assertion: 'passed', saved: false,
      verification: 'field-runtime', runtimeVerified: false, checks: { targetConversion: 'modeled', widgetFormatting: 'not_run' } });
    const [url, payload] = client.postFormOnce.mock.calls[0];
    expect(url).toContain('/query/formFormula/evaluatePlus.json');
    expect(payload._locale_time_zone_offset).toBe(28800000);
    expect(payload).not.toHaveProperty('varMap');
    expect(JSON.parse(payload.bindingComponentFormulaList)[0].formRule).toBe('ROUND(#{price}*#{qty},2)');
  });
  test.each([['0', 0], ['', ''], [null, ''], ['-2.5', -2.5]])('preserves numeric and empty semantics %j', async (raw, expected) => {
    client.postFormOnce.mockResolvedValue(response(raw));
    expect(await evaluateField(client, { ...params, expected })).toMatchObject({ success: true, value: expected });
  });
  test('retains expected JSON types after conversion', async () => {
    expect(await evaluateField(client, { ...params, expected: '24.6' })).toMatchObject({ success: false, assertion: 'failed' });
  });
  test.each(['12oops', 'Infinity', [12, 3]])('reports lossy numeric conversion: %j', async value => {
    client.postFormOnce.mockResolvedValue(response(value));
    expect(await evaluateField(client, params)).toMatchObject({ success: false, diagnostics: [{ code: 'target_conversion_partial' }] });
  });
  test('reports date conversion becoming empty even without an expectation', async () => {
    client.postFormOnce.mockResolvedValue({ success: true, content: { calculateComplete: true,
      data: [{ fieldId: 'today', fieldData: { value: 'Sun Oct 18 00:00:00 CST 2026' } }] } });
    expect(await evaluateField(client, { ...params, fieldId: 'today', formula: 'TODAY()', values: {} })).toMatchObject({
      success: false, value: '', checks: { targetConversion: 'failed' }, diagnostics: [{ code: 'target_conversion_empty' }],
    });
  });
  test('reports native success with no field value as a failed calculation', async () => {
    client.postFormOnce.mockResolvedValue({ success: true, content: { calculateComplete: true,
      data: [{ fieldId: 'today', fieldData: {}, fieldDataUpdated: false }] } });
    expect(await evaluateField(client, { ...params, fieldId: 'today', formula: 'TODAY()', values: {} })).toMatchObject({
      success: false, missingResultValue: true, checks: { platformCalculation: 'no_result' }, diagnostics: [{ code: 'field_result_missing' }],
    });
  });
  test.each([{ success: false, errorMsg: 'rejected' }, response('', { calcErrorMsg: 'formula failed' }),
    response('', { unKnowErrorMsg: 'internal failure' }), { success: true, content: {} }, response('', { data: [] })])('rejects failed and malformed native responses', async data => {
    client.postFormOnce.mockResolvedValue(data);
    await expect(evaluateField(client, params)).rejects.toThrow();
  });
  test('continues only trusted pending formulas using returned component data', async () => {
    const plan = buildPlan(schema, values, 'amount', undefined, 'APP_TEST', builtin);
    client.postFormOnce.mockResolvedValueOnce(response('1', { calculateComplete: false,
      nonEvaluateComponentFormulas: [{ ...plan.bindings[0], label: null }], nextToken: 'shard-2' })).mockResolvedValueOnce(response('24.6'));
    expect(await evaluateField(client, params)).toMatchObject({ success: true, rounds: [{ calculateComplete: false }, { calculateComplete: true }] });
    expect(JSON.parse(client.postFormOnce.mock.calls[1][1].data)[0].fieldData.value).toBe('1');
    expect(client.postFormOnce.mock.calls[1][1].nextToken).toBe('shard-2');
  });
  test('rejects injected continuation expressions and nonprogressing shards', async () => {
    const plan = buildPlan(schema, values, 'amount', undefined, 'APP_TEST', builtin);
    client.postFormOnce.mockResolvedValue(response('', { calculateComplete: false,
      nonEvaluateComponentFormulas: [{ ...plan.bindings[0], formRule: 'INSERT("x")' }] }));
    await expect(evaluateField(client, params)).rejects.toThrow(/unexpected/);
    expect(client.postFormOnce).toHaveBeenCalledTimes(1);
    client.postFormOnce.mockResolvedValue(response('', { calculateComplete: false, nonEvaluateComponentFormulas: plan.bindings }));
    await expect(evaluateField(client, params)).rejects.toThrow(/progress/);
  });
  test.each([NaN, 841, -841, 0.5])('rejects invalid timezone %j before calling the platform', async timezoneOffset => {
    await expect(evaluateField(client, { ...params, timezoneOffset })).rejects.toThrow();
    expect(client.postFormOnce).not.toHaveBeenCalled();
  });
  test('keeps member objects and native single-member normalization', () => {
    const node = field('person', 'EmployeeField'); node.props.valueNormalization = true;
    expect(convertValue([{ value: 'u1' }, { key: 'u2' }], node)).toEqual([{ key: 'u1', value: 'u1' }]);
    expect(convertValue('u1', node)).toEqual([]);
    expect(convertValue(['u1'], node)).toEqual([]);
  });
});
