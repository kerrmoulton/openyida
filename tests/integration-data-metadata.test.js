'use strict';

const { buildSpecProcessAndViewJson } = require('../lib/integration/integration-spec-builder');
const { collectRetrieveFormUuids, hydrateDataNodeMetadata, assertDataNodeMetadata } = require('../lib/integration/integration-data-metadata');
const { validateSavedDataView } = require('../lib/integration/integration-save-verifier');

const fields = [{ componentName: 'SelectField', props: {
  fieldId: 'selectField_result', label: { zh_CN: '审批意见', en_US: 'Opinion' },
  dataSource: [{ text: '同意', value: '同意' }, { text: '不同意', value: '不同意' }],
  status: 'HIDDEN',
} }];
const metadata = formType => new Map([['FORM-A', { formType, formName: '申请单', fields }]]);
function build(formType = 'process', extra = {}) {
  return buildSpecProcessAndViewJson({
    appType: 'APP_TEST', formUuid: 'FORM-A', processCode: 'LPROC-TEST',
    formMetadataByUuid: metadata(formType),
    spec: { events: ['activityTask'], approvalActions: ['agree'], approvalNodeIds: ['approval-1'], nodes: [
      { id: 'self', name: '获取本单', type: 'getSelf', ...extra },
      { id: 'update', type: 'dataUpdate', source: 'self', assignments: [
        { column: 'selectField_result', valueType: 'literal', value: '同意' },
      ] },
    ] },
  });
}

test.each([
  ['process', 'process_form', 'pid', '__masterdata_form_inst_id'],
  ['receipt', 'form', 'form_inst_id', '__masterdata_form_inst_id'],
])('compiles %s identity and editable designer metadata together', (type, originalType, id, value) => {
  const built = build(type);
  expect(() => assertDataNodeMetadata(built.processJson, built.viewJson)).not.toThrow();
  const retrieve = built.processJson.nodes[1];
  const source = built.viewJson.schema.children[1].props.getData;
  expect(retrieve.props.originalType).toBe(originalType);
  expect(retrieve.props.condition.rules[0]).toMatchObject({ id, value, opCode: 'Equal', valueType: 'processVar' });
  expect(source).toMatchObject({ originalType, targetItem: { formItem: { formType: type, title: '申请单' } } });
  expect(source.outputs[0]).toMatchObject({ value: 'selectField_result', text: expect.any(String), props: fields[0].props });
  // Hidden fields still need to be available to downstream automation rules.
  expect(fields[0].props.status).toBe('HIDDEN');
  const update = built.viewJson.schema.children[2].props.updateDataRules;
  expect(update.description).toBe('在 [获取本单] 中更新数据');
  expect(built.processJson.nodes[2].props.description).toBe(update.description);
  expect(update.assignments).toEqual([expect.objectContaining({ column: 'selectField_result', value: '同意' })]);
  expect(validateSavedDataView(built.viewJson, { success: true, content: JSON.stringify(built.viewJson) }))
    .toEqual({ dataNodeCount: 2 });
});

test('preserves explicit identity overrides', () => {
  const built = build('process', { queryField: 'custom_id', triggerField: 'customEventId' });
  expect(built.processJson.nodes[1].props.condition.rules[0]).toMatchObject({ id: 'custom_id', value: 'customEventId' });
});

test.each(['outputs', 'targetItem', 'originalType', 'condition'])('rejects save/readback loss of %s', key => {
  const built = build();
  const actual = JSON.parse(JSON.stringify(built.viewJson));
  delete actual.schema.children[1].props.getData[key];
  expect(() => validateSavedDataView(built.viewJson, { success: true, content: actual })).toThrow(/readback mismatch|回读不一致/);
});

test.each(['description', 'sourceId', 'assignments'])('rejects save/readback loss of update %s', key => {
  const built = build();
  const actual = JSON.parse(JSON.stringify(built.viewJson));
  delete actual.schema.children[2].props.updateDataRules[key];
  expect(() => validateSavedDataView(built.viewJson, { success: true, content: actual })).toThrow(/readback mismatch|回读不一致/);
});

test('preflight rejects missing schema and unknown target fields', () => {
  const built = build();
  expect(() => hydrateDataNodeMetadata(built.processJson, built.viewJson, new Map(), { strict: true }))
    .toThrow(/Missing data source metadata|缺少数据来源元数据/);
  expect(() => hydrateDataNodeMetadata(built.processJson, built.viewJson,
    new Map([['FORM-A', { formType: 'process', formName: '申请单', fields: [] }]]), { strict: true }))
    .toThrow(/Missing data source fields|缺少数据来源字段/);
  built.viewJson.schema.children[2].props.updateDataRules.assignments[0].column = 'missing';
  expect(() => hydrateDataNodeMetadata(built.processJson, built.viewJson, metadata('process'), { strict: true }))
    .toThrow(/Unknown update field|更新目标字段不存在/);
});

test('collects nested sources once without treating condition objects as branches', () => {
  expect(collectRetrieveFormUuids({ nodes: [
    { type: 'getSelf' },
    { type: 'route', branches: [{ nodes: [{ type: 'dataRetrieve', formUuid: 'FORM-B', conditions: { rules: [] } }] }] },
    { type: 'dataRetrieve', formUuid: 'FORM-B' },
  ] }, 'FORM-A')).toEqual(['FORM-A', 'FORM-B']);
});
