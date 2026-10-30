'use strict';

const vm = require('vm');
const { buildZeroValueAfterFetch, isZeroValueAfterFetch } = require('../lib/report/zero-values');
const { buildAfterFetch } = require('../lib/report/field-utils');
const { buildChartNode } = require('../lib/report/chart-builder');
const { validateChartConfigDetailed } = require('../lib/report/validation');
const { summarizeReportSchema } = require('../lib/report/inspect');

const chart = { type: 'bar', cubeCode: 'FORM_1',
  xField: { fieldCode: 'department', dataType: 'STRING' },
  yField: [{ fieldCode: 'reception', dataType: 'NUMBER' }, { fieldCode: 'hygiene', dataType: 'NUMBER' }] };
const hideAll = { hideZeroCategories: true, hideZeroLegends: true };

function metadata() {
  return [{ alias: 'department', category: 'xField' },
    { alias: 'reception', category: 'yField' }, { alias: 'hygiene', category: 'yField' },
    { alias: 'stock', category: 'yField' }];
}

describe('native report zero-value presentation', () => {
  test.each(['source', 'compiled'])('native %s executes after aggregation and drives legend roles', key => {
    const hook = JSON.parse(JSON.stringify(buildZeroValueAfterFetch(hideAll)));
    const transform = vm.runInNewContext('(' + hook[key] + ')');
    const rows = [{ department: '空', reception: null, hygiene: null, stock: null },
      { department: '零', reception: 0, hygiene: '0.00', stock: 0 },
      { department: '混合', reception: 0, hygiene: 1, stock: 0 },
      { department: '非零', reception: 2, hygiene: -3, stock: 0 }];
    const original = JSON.parse(JSON.stringify(rows));
    const meta = metadata();
    const info = { meta };
    const result = transform(rows, info);
    expect(result).toEqual([
      { department: '混合', reception: null, hygiene: 1, stock: null },
      { department: '非零', reception: 2, hygiene: -3, stock: null },
    ]);
    expect(info.meta).toBe(meta);
    // Native dataStatePool uses this same metadata to expand wide rows into series.
    expect(meta.filter(item => item.category === 'yField').map(item => item.alias)).toEqual(['reception', 'hygiene']);
    expect(rows).toEqual(original);
    expect(result[0]).not.toBe(rows[2]);
  });

  test('later results restore previously all-zero indicators and categories', () => {
    const transform = vm.runInNewContext('(' + buildZeroValueAfterFetch(hideAll).compiled + ')');
    const emptyMeta = metadata();
    expect(transform([{ department: '一部', reception: 0, hygiene: 0, stock: 0 }], { meta: emptyMeta })).toEqual([]);
    expect(emptyMeta.map(item => item.alias)).toEqual(['department']);
    const nextMeta = metadata();
    expect(transform([{ department: '一部', reception: 1, hygiene: 0, stock: 0 }], { meta: nextMeta })).toEqual([
      { department: '一部', reception: 1, hygiene: null, stock: null },
    ]);
    expect(nextMeta.map(item => item.alias)).toEqual(['department', 'reception']);
  });

  test('retains negative and tiny values, zero dimensions and group identity', () => {
    const transform = vm.runInNewContext('(' + buildZeroValueAfterFetch(hideAll).source + ')');
    const meta = [{ alias: 'category', category: 'xField' }, { alias: 'group', category: 'groupField' },
      { alias: 'value', category: 'yField' }];
    expect(transform([{ category: 0, group: 'A', value: -1 }, { category: 1, group: 'B', value: 0 },
      { category: 2, group: 'C', value: 0.00001 }], { meta })).toEqual([
      { category: 0, group: 'A', value: -1 }, { category: 2, group: 'C', value: 0.00001 },
    ]);
  });

  test('recognizes empty and numeric zero only; malformed metadata fails without data loss', () => {
    const transform = vm.runInNewContext('(' + buildZeroValueAfterFetch(hideAll).source + ')');
    const rows = [null, 0, -0, '0', ' 0.0 ', '', ' ', undefined, 1, -1, '2', false, 'unknown']
      .map(value => ({ value }));
    expect(transform(rows, { meta: [{ alias: 'value', category: 'yField' }] }).map(row => row.value))
      .toEqual([1, -1, '2', false, 'unknown']);
    expect(transform(rows, {})).toBe(rows);
    expect(transform(rows, { meta: [] })).toBe(rows);
    expect(transform(null, { meta: [] })).toBeNull();
  });

  test('default and explicit false preserve existing Schema; true is inspectable native code', () => {
    for (const config of [chart, { ...chart, hideZeroValues: false }]) {
      expect(buildChartNode(config, 'tenant').node.props.afterFetch).toEqual(buildAfterFetch());
    }
    const node = buildChartNode({ ...chart, hideZeroValues: true }, 'tenant').node;
    expect(node.props.afterFetch.type).toBe('js');
    expect(isZeroValueAfterFetch(node.props.afterFetch)).toBe(true);
    expect(node.props.dataSetModelMap.chartData.yField).toHaveLength(2);
    const summary = summarizeReportSchema({ gmtModified: 1, pages: [{ componentsTree: [node] }] });
    expect(summary.components[0].hideZeroValues).toBe(true);
  });

  test.each([[false, false], [true, false], [false, true], [true, true]])(
    'category hiding=%s and legend hiding=%s remain independent', (hideZeroCategories, hideZeroLegends) => {
      const hook = buildZeroValueAfterFetch({ hideZeroCategories, hideZeroLegends });
      const transform = vm.runInNewContext('(' + hook.compiled + ')');
      const meta = metadata();
      const rows = [{ department: '一部', reception: 0, hygiene: 0, stock: 0 },
        { department: '二部', reception: null, hygiene: 0, stock: null },
        { department: '三部', reception: 0, hygiene: 1, stock: 0 }];
      const result = transform(rows, { meta });
      expect(result.map(row => row.department)).toEqual(hideZeroCategories ? ['三部'] : ['一部', '二部', '三部']);
      expect(result.every(row => row.reception === null && row.stock === null)).toBe(true);
      expect(meta.filter(item => item.category === 'yField').map(item => item.alias))
        .toEqual(hideZeroLegends ? ['hygiene'] : ['reception', 'hygiene', 'stock']);
      expect(isZeroValueAfterFetch(hook)).toBe(true);
      const node = buildChartNode({ ...chart, hideZeroValues: true, hideZeroCategories, hideZeroLegends }, 'tenant').node;
      const summary = summarizeReportSchema({ gmtModified: 1, pages: [{ componentsTree: [node] }] });
      expect(summary.components[0]).toMatchObject({ hideZeroValues: true, hideZeroCategories, hideZeroLegends });
    });

  test('hideZeroValues alone keeps categories and legends, including an entirely zero result', () => {
    const transform = vm.runInNewContext('(' + buildZeroValueAfterFetch().compiled + ')');
    const meta = metadata();
    const result = transform([{ department: '一部', reception: 0, hygiene: 0, stock: 0 }], { meta });
    expect(result).toEqual([{ department: '一部', reception: null, hygiene: null, stock: null }]);
    expect(meta).toEqual(metadata());
  });

  test.each(['hideZeroCategories', 'hideZeroLegends'])('validates explicit %s without silently enabling other behavior', key => {
    expect(validateChartConfigDetailed({ ...chart, hideZeroValues: true, [key]: 'false' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REPORT_ZERO_VALUES_INVALID' })]));
    expect(validateChartConfigDetailed({ ...chart, [key]: true }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REPORT_ZERO_VALUES_INVALID' })]));
  });

  test.each([null, 'true', 1, {}])('rejects nonboolean opt-in %p', value => {
    expect(validateChartConfigDetailed({ ...chart, hideZeroValues: value }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REPORT_ZERO_VALUES_INVALID' })]));
    expect(() => buildChartNode({ ...chart, hideZeroValues: value }, 'tenant')).toThrow();
  });

  test.each(['line', 'pie', 'combo', 'table', 'indicator', 'pivot'])('rejects unaudited type %s', type => {
    expect(validateChartConfigDetailed({ ...chart, type, hideZeroValues: true }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REPORT_ZERO_VALUES_UNSUPPORTED' })]));
  });
});
