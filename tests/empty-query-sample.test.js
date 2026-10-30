'use strict';

const { buildEmptyConditions, buildCountConditions, countFilledRangeEndpoints } = require('../lib/samples/yida-data-management/empty-query');
const { buildCommandManifest } = require('../lib/core/command-manifest');

describe('empty-query sample', () => {
  const range = { fieldId: 'cascadeDateField_period', componentName: 'CascadeDateField' };
  test('range modes express separate endpoints, preserving partial ranges', () => {
    expect(buildEmptyConditions(range, 'empty')).toEqual([
      { key: 'cascadeDateField_period.start', componentName: 'DateField', type: 'DOUBLE', operator: 'is', value: '' },
      { key: 'cascadeDateField_period.end', componentName: 'DateField', type: 'DOUBLE', operator: 'is', value: '' },
    ]);
    expect(buildEmptyConditions(range, 'complete').map(c => c.operator)).toEqual(['is_not', 'is_not']);
    expect(buildEmptyConditions(range, 'start-only').map(c => c.operator)).toEqual(['is_not', 'is']);
    expect(buildEmptyConditions(range, 'end-only').map(c => c.operator)).toEqual(['is', 'is_not']);
    expect(buildEmptyConditions(range, 'end-filled')).toEqual([
      { key: 'cascadeDateField_period.end', componentName: 'DateField', type: 'DOUBLE', operator: 'is_not', value: '' },
    ]);
    expect(() => buildEmptyConditions(range, 'filled')).toThrow('explicit date range mode');
  });

  test('child dates preserve their parent constraint', () => {
    expect(buildEmptyConditions({ fieldId: 'dateField_child', componentName: 'DateField', parentId: 'tableField_items' }, 'empty')).toEqual([
      { key: 'dateField_child', componentName: 'DateField', type: 'DOUBLE', operator: 'is', value: '', parentId: 'tableField_items' },
    ]);
  });

  test.each([
    [undefined, 0], [null, 0], [[], 0], [['', ''], 0], [[0, 0], 2],
    [[null, 1791907200000], 1], [[1791820800000, ''], 1], [['0', '0'], 2],
  ])('counts business presence for %p as %p', (value, expected) => {
    expect(countFilledRangeEndpoints(value)).toBe(expected);
  });

  test('requires verified fields and modes', () => {
    expect(() => buildEmptyConditions({}, 'empty')).toThrow('fieldId');
    expect(() => buildEmptyConditions({ fieldId: 'tableField_rows', componentName: 'TableField' }, 'empty')).toThrow('synchronized count field');
    expect(() => buildEmptyConditions({ fieldId: 'checkboxField_choices', componentName: 'CheckboxField' }, 'filled')).toThrow('synchronized count field');
    expect(() => buildEmptyConditions({ fieldId: 'addressField_address', componentName: 'AddressField' }, 'empty')).toThrow('Verify this component');
    expect(() => buildEmptyConditions({ fieldId: 'numberField_count', componentName: 'NumberField' }, 'complete')).toThrow('empty or filled');
  });

  test('business count filters compare zero, including partially filled ranges', () => {
    const field = { fieldId: 'numberField_count', componentName: 'NumberField' };
    expect(buildCountConditions(field, 'empty')).toEqual([
      { key: 'numberField_count', componentName: 'NumberField', type: 'DOUBLE', operator: 'eq', value: 0 },
    ]);
    expect(buildCountConditions(field, 'filled')[0]).toMatchObject({ operator: 'gt', value: 0 });
    expect(() => buildCountConditions(range, 'empty')).toThrow('NumberField');
    expect(() => buildCountConditions(field, 'complete')).toThrow('empty or filled');
  });

  test('manifest advertises an executable empty-query example and the matching sample entry', () => {
    const manifest = buildCommandManifest();
    const data = manifest.commands.find(command => command.id === 'data');
    const sample = manifest.commands.find(command => command.id === 'sample');
    const example = data.examples.find(command => command.includes('--search-json'));
    const searchJson = example.match(/--search-json '([^']+)'/)[1];
    expect(JSON.parse(searchJson)).toEqual(buildEmptyConditions({ fieldId: 'dateField_due', componentName: 'DateField' }, 'empty'));
    for (const locale of ['zh', 'en']) {
      const note = require('../lib/core/locales/' + locale).help.data_notes;
      expect(note).toContain('is/is_not');
      expect(note).toContain('""');
      expect(note).toContain('parentId');
    }
    expect(data.notes.join(' ')).toContain('parentId aliases');
    expect(data.notes.join(' ')).toContain('rangeAlias.start/.end');
    expect(sample.notes.join(' ')).toContain('sample yida-data-management empty-query');
    expect(sample.notes.join(' ')).toContain('no query, schema change or count maintenance');
  });
});
