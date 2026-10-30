'use strict';

const { analyzeFormula, parseArgs, run: runCheck } = require('../lib/formula/evaluate');
const { collectFields, bindNumericValues } = require('../lib/formula/syntax');
const { applyFieldFormula, validateSchemaFormulas, formulaFields } = require('../lib/formula/config');
const { builtin, normalize } = require('../lib/formula/metadata');
const createForm = require('../lib/app/create-form')._private;
const field = (id, type, props = {}) => ({ componentName: type, props: { fieldId: id, ...props } });
const codes = result => result.diagnostics.map(item => item.code);

describe('formula syntax and signatures', () => {
  test('binds numeric sample values safely, including zero and negative values', () => {
    expect(bindNumericValues('ROUND(#{a}*#{b},2)', { a: -12.345, b: 0 })).toBe('ROUND((-12.345)*(0),2)');
    expect(bindNumericValues('CONCATENATE("#{a}",#{b})', { a: 1, b: 'text' })).toBe('CONCATENATE("#{a}",#{b})');
  });
  test.each(['IF(,)', 'ROUND(1,2,3,4)', 'ROUND("abc",2)', 'SUM()', 'globalThis.exit()', '(1,2)', 'x=>x', '1;2', '[,1]'])('rejects invalid input %s', formula => {
    expect(analyzeFormula(formula).ok).toBe(false);
  });
  test.each(['RIGHT("abc",2)', 'USER()', 'GETUSERNAME()', 'ROUND(12.345,2)', 'SUM(1,2,3)', 'IF(TRUE(),1,2)'])('accepts %s', formula => {
    expect(analyzeFormula(formula).ok).toBe(true);
  });
  test('keeps literal references inside strings and checks actual field types', () => {
    const fields = collectFields([field('numberField_amount', 'NumberField'), field('employeeField_person', 'EmployeeField')]);
    expect(analyzeFormula('ROUND(#{numberField_amount},2)', { fields }).ok).toBe(true);
    expect(codes(analyzeFormula('ROUND(#{employeeField_person},2)', { fields }))).toContain('argument_type');
    expect(codes(analyzeFormula('ROUND(#{numberField_missing},2)', { fields }))).toContain('field_missing');
    expect(analyzeFormula('"#{not_a_field}"', { fields }).fieldRefs).toEqual([]);
  });
  test('marks unverified information rather than claiming platform execution', () => {
    const result = analyzeFormula('NEWFUNCTION(#{numberField_amount})');
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(expect.arrayContaining(['function_unknown', 'schema_missing']));
    expect(result.checks.platform).toBe('not_run');
    expect(result.checks.runtime).toBe('not_run');
  });
  test.each([['round(1,2)', 'ROUND'], ['Round(1,2)', 'ROUND'], ['userbuilder("u")', 'UserBuilder'], ['USERBUILDER("u")', 'UserBuilder'], ['deptbuilder()', 'DeptBuilder']])('rejects case changes and suggests the exact name: %s', (formula, suggestion) => {
    const result = analyzeFormula(formula);
    expect(result.ok).toBe(false);
    expect(result.checks.signatures).toBe('failed');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ level: 'error', code: 'function_case', suggestion }));
    expect(result.formula).toBe(formula);
  });
  test('only validates formula calls, preserving identical names inside text', () => {
    expect(analyzeFormula('CONCATENATE("round(1,2)", "MYROUND()")').ok).toBe(true);
    expect(analyzeFormula('IF(TRUE(),round(1,2),0)').ok).toBe(false);
    expect(analyzeFormula('ROUND(1,2)', { contract: 'javascript' }).verification).toBe('not_supported');
  });
  test.each(['Round(1,2)', 'USERBUILDER("u")', 'MYROUND(1,2)'])('strict CLI check rejects formula names without rewriting them: %s', async formula => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runCheck([formula, '--strict', '--json'])).rejects.toMatchObject({ code: 'CLI_FORMULA_INVALID' });
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ ok: false, formula, checks: { signatures: 'failed' } });
    } finally { log.mockRestore(); }
  });
  test.each(['SUMIF(1,2)', 'MYROUND(1,2)', 'constructor()', 'toString()'])('rejects names outside the selected catalog: %s', formula => {
    const result = analyzeFormula(formula);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ level: 'error', code: 'function_unknown' }));
  });
  test('accepts exact mixed-case names and uses the supplied catalog as the function list', () => {
    expect(analyzeFormula('UserBuilder("user-id")').ok).toBe(true);
    const metadata = { ...builtin, functions: { ROUND: builtin.functions.ROUND } };
    expect(analyzeFormula('ROUND(1,2)', { metadata }).ok).toBe(true);
    expect(analyzeFormula('SUM(1,2)', { metadata }).ok).toBe(false);
    expect(analyzeFormula('ROUND(1,2)', { metadata: { ...metadata, functions: { NEWROUND: builtin.functions.ROUND } } }).ok).toBe(false);
  });
  test('checks usage location and target type', () => {
    expect(codes(analyzeFormula('INSERT("x")'))).toContain('function_context');
    expect(analyzeFormula('INSERT("x")', { context: 'business' }).ok).toBe(true);
    expect(codes(analyzeFormula('USER()', { targetType: 'NumberField' }))).toContain('target_type');
    expect(codes(analyzeFormula('IF(TRUE(),[1],[2])', { targetType: 'NumberField' }))).toContain('target_type');
    expect(analyzeFormula('ROUND(${lookup}.numberField_amount,2)', { context: 'automation' }).ok).toBe(true);
    expect(analyzeFormula('ROUND(#{lookup}.numberField_amount,2)', { context: 'automation' }).ok).toBe(true);
    expect(codes(analyzeFormula('${lookup}.numberField_amount'))).toContain('reference_context');
  });
  test('does not present broad metadata types as proof of numeric or date assignment', () => {
    const mixed = analyzeFormula('IF(TRUE(),1,"not a number")', { targetType: 'NumberField' });
    expect(mixed.checks.types).toBe('unknown');
    expect(codes(mixed)).toContain('numeric_result_text');
    const date = analyzeFormula('TODAY()', { targetType: 'DateField' });
    expect(codes(date)).toContain('date_timestamp');
    expect(date.checks.types).toBe('unknown');
  });
  test('accepts explicitly mixed optional types and retains same-type checks', () => {
    expect(analyzeFormula('SEARCH("a","banana",2)').ok).toBe(true);
    expect(analyzeFormula('SEARCH("a","banana","2")').ok).toBe(false);
    expect(codes(analyzeFormula('EQ(1,"1")'))).toContain('same_type');
  });
  test('metadata snapshots update signatures without granting test execution', () => {
    const catalog = normalize({ expressionMapping: { ROUND: { inputs: { requiredParams: [{ baseType: ['number'] }] }, outputs: { baseType: ['number'] } }, NEWFUNCTION: {} }, componentMapping: {} });
    expect(analyzeFormula('ROUND(1,2)', { metadata: catalog }).ok).toBe(false);
    expect(catalog.functions.NEWFUNCTION.effect).toBe('unknown');
    expect(builtin.functions.INSERT.effect).toBe('write');
  });
  test.each([['--schema', '--strict'], ['--context', 'bad'], ['--schema']])('rejects invalid arguments %j', (...args) => {
    if (args[0] === '--context') { expect(() => analyzeFormula('1', { context: args[1] })).toThrow(); }
    else { expect(() => parseArgs(args)).toThrow(); }
  });
});

describe('field formula persistence', () => {
  test('create and update preserve formula and unrelated field properties', () => {
    const schema = createForm.buildFormSchema('公式测试', [{ type: 'NumberField', label: '金额', formula: 'ROUND(12.345,2)', precision: 2, required: true }], 'FORM_TEST', 'corp', 'APP_TEST');
    const [id] = formulaFields(schema).keys();
    const before = collectFields(schema);
    expect(before.has(id)).toBe(true);
    const found = [];
    const visit = node => { if (!node || typeof node !== 'object') { return; } if (node.props?.fieldId === id) { found.push(node); } Object.values(node).forEach(value => { if (typeof value === 'object') { visit(value); } }); };
    visit(schema);
    expect(found[0].props.precision).toBe(2);
    const oldProps = JSON.parse(JSON.stringify(found[0].props));
    createForm.applyChangesToSchema(schema, [{ action: 'update', fieldId: id, changes: { formula: 'ROUND(18.765,2)' } }]);
    expect(formulaFields(schema).get(id).formula).toBe('ROUND(18.765,2)');
    expect(found[0].props).toEqual({ ...oldProps, valueType: 'formula', formula: 'ROUND(18.765,2)', complexValue: { ...oldProps.complexValue, complexType: 'formula', formula: 'ROUND(18.765,2)' } });
  });
  test('nested formula and explicit reset are supported', () => {
    const props = { label: '金额', custom: true, complexValue: { value: 'keep' } };
    applyFieldFormula(props, { complexValue: { formula: '1+2' } }, 'NumberField');
    expect(props.complexValue).toEqual({ value: 'keep', complexType: 'formula', formula: '1+2' });
    applyFieldFormula(props, { formula: '', valueType: 'custom' }, 'NumberField');
    expect(props).toMatchObject({ custom: true, formula: '', valueType: 'custom', complexValue: { complexType: 'custom', formula: '' } });
  });
  test.each([{ formula: '' }, { formula: '1', complexValue: { formula: '2' } }, { formula: '1', valueType: 'custom' }])('rejects inconsistent or empty formula configuration %j', input => {
    expect(() => applyFieldFormula({}, input, 'NumberField')).toThrow();
  });
  test('rejects conflicting formulas when restoring manual input without mutating existing props', () => {
    const props = { valueType: 'formula', formula: '1', complexValue: { complexType: 'formula', formula: '1' } };
    const before = JSON.parse(JSON.stringify(props));
    expect(() => applyFieldFormula(props, { valueType: 'custom', formula: '', complexValue: { formula: '2' } }, 'NumberField')).toThrow();
    expect(props).toEqual(before);
  });
  test('keeps incomplete static knowledge separate from persistence and checks cycles', () => {
    const formulaField = (id, formula) => field(id, 'NumberField', { valueType: 'formula', formula });
    expect(() => validateSchemaFormulas([formulaField('numberField_a', '#{customField_unknown.amount}+1')])).not.toThrow();
    expect(() => applyFieldFormula({}, { formula: 'NEWFUNCTION(#{customField_unknown.amount})' }, 'NumberField')).not.toThrow();
    expect(() => validateSchemaFormulas([formulaField('numberField_a', '#{numberField_a}+1')])).toThrow(/circular|循环/);
    expect(() => validateSchemaFormulas([formulaField('numberField_a', '#{numberField_b}+1'), formulaField('numberField_b', '#{numberField_a}+1')])).toThrow(/circular|循环/);
    expect(() => createForm.validateFormFieldDefinitions([{ type: 'NumberField', label: '金额', formula: '#{customField_unknown.amount}+1' }])).not.toThrow();
  });
});
