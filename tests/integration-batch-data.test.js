'use strict';

const { buildSpecProcessAndViewJson, validateIntegrationSpec, collectBatchSourceFormUuids } = require('../lib/integration/integration-spec-builder');
const { projectBatchData, verifyBatchReadback } = require('../lib/integration/integration-batch-data');
const { batchFixture } = require('./helpers/integration-batch-fixture');

function build(fixture) {
  return buildSpecProcessAndViewJson({ ...fixture, appType: 'APP-TEST', formUuid: 'FORM-QUOTE', processCode: 'LPROC-TEST' });
}

describe('batch retrieval and creation platform contract', () => {
  test('copies source rows into the subtable of a newly created single record', () => {
    const fixture = batchFixture();
    const result = build(fixture);
    const ids = result.nodeIdMap;
    const runtime = result.processJson.nodes;
    const view = result.viewJson.schema.children;
    expect(runtime.find(node => node.nodeId === ids.lines).props).toMatchObject({
      type: 'batch', originalType: 'sub_table', sourceId: ids.self, subSourceId: 'tableField_quoteLines',
      quantity: '100', filterType: 'all', condition: null,
    });
    const batchView = view.find(node => node.id === ids.lines);
    expect(batchView).toMatchObject({ componentName: 'GetBatchDataNode', props: { type: 'batch',
      getData: { type: 'batch', quantity: 100, filterType: 'all', condition: null } } });
    expect(batchView.props.getData.outputs.map(field => field.value)).toEqual(['textField_product', 'numberField_quantity']);
    expect(batchView.props.getData.outputs[0].props.parentId).toBe('tableField_quoteLines');
    const copy = runtime.find(node => node.nodeId === ids.copy);
    // The native field picker uses ${batch_<nodeId>}.field for the current row.
    expect(copy.props).toMatchObject({ type: 'batch', sourceId: ids.lines,
      formUuid: ids.order, insertType: 'sub_table', subFormUuid: 'tableField_orderLines' });
    expect(copy.props.assignments.map(item => item.value)).toEqual([
      `\${batch_${ids.lines}}.textField_product`, `\${batch_${ids.lines}}.numberField_quantity`,
    ]);
    const copyView = view.find(node => node.id === ids.copy).props.addDataRules;
    expect(copyView).toMatchObject({ type: 'batch', sourceId: ids.lines, formUuid: ids.order });
    expect(copyView.rules.rules.map(item => item.value)).toEqual(copy.props.assignments.map(item => item.value));
    expect(copyView.targetItem.formItem.formType).toBe('receipt');
    expect(collectBatchSourceFormUuids(fixture.spec, 'FORM-QUOTE')).toEqual(['FORM-QUOTE']);
  });

  test('supports batch main-form query and main-form creation without changing default single nodes', () => {
    const fixture = batchFixture();
    fixture.spec.nodes = [
      { id: 'rows', type: 'GetBatchDataNode', formUuid: 'FORM-QUOTE', filterType: 'all', quantity: 200 },
      { id: 'copies', type: 'dataCreate', createType: 'batch', formUuid: 'FORM-ORDER', batchSource: 'rows',
        assignments: [{ column: 'textField_title', valueType: 'processVar', value: '${rows}.textField_quoteNo' }] },
    ];
    const result = build(fixture);
    expect(result.viewJson.schema.children[1].componentName).toBe('GetBatchDataNode');
    expect(result.viewJson.schema.children[1].props.getData.outputs.map(field => field.value)).toEqual(['textField_quoteNo']);
    expect(result.processJson.nodes[2].props).toMatchObject({ type: 'batch', formUuid: 'FORM-ORDER', sourceId: result.nodeIdMap.rows });
  });

  test('preserves batch row references in formulas and designer source metadata', () => {
    const fixture = batchFixture();
    fixture.spec.nodes[3].assignments[1] = { column: 'numberField_orderQuantity', valueType: 'column',
      value: '${lines}.numberField_quantity * 2', __source: '#{lines//numberField_quantity} * 2', __display: '数量 * 2' };
    const result = build(fixture);
    const rule = result.viewJson.schema.children.find(node => node.id === result.nodeIdMap.copy).props.addDataRules.rules.rules[1];
    expect(rule.value).toBe(`\${batch_${result.nodeIdMap.lines}}.numberField_quantity * 2`);
    expect(rule.__source).toBe(`#{batch_${result.nodeIdMap.lines}//numberField_quantity} * 2`);
  });

  test('preserves conditions and the requested limit when querying matching subtable rows', () => {
    const fixture = batchFixture();
    Object.assign(fixture.spec.nodes[1], { filterType: 'condition', quantity: 50,
      conditions: [{ bFieldId: 'textField_product', bFieldName: '产品', aFieldId: 'textField_selectedProduct',
        valueType: 'processVar', opCode: 'Equal', componentType: 'TextField' }] });
    const result = build(fixture);
    const query = result.processJson.nodes.find(node => node.nodeId === result.nodeIdMap.lines);
    expect(query.props).toMatchObject({ type: 'batch', filterType: 'condition', quantity: '50',
      condition: { rules: [expect.objectContaining({ id: 'textField_product', value: 'textField_selectedProduct', opCode: 'Equal' })] } });
    expect(result.viewJson.schema.children.find(node => node.id === result.nodeIdMap.lines).props.getData.condition)
      .toMatchObject({ condition: query.props.condition.condition,
        rules: query.props.condition.rules.map(({ id, value, opCode, valueType }) => ({ id, value, opCode, valueType })) });
  });

  test.each([undefined, 0, -1, 1.5, 'all', true, null])('rejects invalid or implicit batch quantity %s', quantity => {
    const fixture = batchFixture();
    fixture.spec.nodes[1].quantity = quantity;
    expect(() => validateIntegrationSpec(fixture.spec)).toThrow(expect.objectContaining({
      code: 'INTEGRATION_BATCH_INVALID', details: expect.objectContaining({ reason: 'POSITIVE_QUANTITY_REQUIRED', remoteWrites: 0 }),
    }));
  });

  test.each(['self', 'unknown', 'order', 'copy', undefined])('rejects a non-upstream row set %s', batchSource => {
    const fixture = batchFixture();
    fixture.spec.nodes[3].batchSource = batchSource;
    expect(() => validateIntegrationSpec(fixture.spec)).toThrow(expect.objectContaining({ code: 'INTEGRATION_BATCH_INVALID' }));
  });

  test('rejects a source hidden inside another branch', () => {
    const fixture = batchFixture();
    const source = fixture.spec.nodes.splice(1, 1)[0];
    fixture.spec.nodes.splice(1, 0, { type: 'route', branches: [{ default: true, nodes: [source] }] });
    expect(() => validateIntegrationSpec(fixture.spec)).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason: 'UPSTREAM_BATCH_SOURCE_REQUIRED' }),
    }));
  });

  test('refuses a multi-record target and references outside the source subtable', () => {
    const fixture = batchFixture();
    fixture.spec.nodes[3].source = 'lines';
    expect(() => validateIntegrationSpec(fixture.spec)).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason: 'SINGLE_TARGET_RECORD_REQUIRED' }),
    }));
    fixture.spec.nodes[3].source = 'order';
    fixture.spec.nodes[3].assignments[0].value = '${lines}.textField_quoteNo';
    expect(() => build(fixture)).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason: 'BATCH_SOURCE_FIELD_NOT_FOUND' }),
    }));
  });

  test('refuses missing source schema, unknown target columns and bare trigger fields', () => {
    const missing = batchFixture(); missing.formSchemasByUuid.delete('FORM-QUOTE');
    expect(() => build(missing)).toThrow(expect.objectContaining({ code: 'INTEGRATION_BATCH_INVALID' }));
    const wrongTarget = batchFixture(); wrongTarget.spec.nodes[3].assignments[0].column = 'textField_title';
    expect(() => build(wrongTarget)).toThrow();
    const bare = batchFixture(); bare.spec.nodes[3].assignments[0].value = 'textField_product';
    expect(() => validateIntegrationSpec(bare.spec)).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason: 'BATCH_ROW_REFERENCE_REQUIRED' }),
    }));
  });

  test.each(['quantity', 'sourceId', 'type'])('fails readback when batch %s is lost or altered', property => {
    const result = build(batchFixture());
    const expected = projectBatchData(result.viewJson);
    const changed = JSON.parse(JSON.stringify(result.viewJson));
    if (property === 'quantity') { changed.schema.children[2].props.getData.quantity = 1; }
    if (property === 'sourceId') { changed.schema.children[4].props.addDataRules.sourceId = 'wrong'; }
    if (property === 'type') { changed.schema.children[4].props.addDataRules.type = 'single'; }
    expect(() => verifyBatchReadback(changed, expected)).toThrow(expect.objectContaining({ code: 'INTEGRATION_READBACK_BATCH_MISMATCH' }));
    expect(verifyBatchReadback(result.viewJson, expected)).toBe('EXACT');
  });
});
