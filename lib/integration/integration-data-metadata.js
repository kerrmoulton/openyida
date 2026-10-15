'use strict';

// Designer metadata is separate from executable assignments. Keep both sides in
// sync; an HTTP-successful save of an incomplete view is not acceptance.
const { parseYidaI18n } = require('../core/yida-i18n');
const { t } = require('../core/i18n');
const clone = value => JSON.parse(JSON.stringify(value));

function walk(nodes, visit, childKey) {
  for (const node of nodes || []) {
    visit(node);
    walk(node[childKey], visit, childKey);
  }
}

function collectRetrieveFormUuids(spec, triggerFormUuid) {
  const result = new Set();
  function visit(nodes) {
    for (const node of nodes || []) {
      const type = String(node.type || node.componentName || '').toLowerCase();
      if (['getself', 'get-self', 'getdata', 'dataretrieve', 'dataretrievenode'].includes(type)) {
        result.add(node.formUuid || node.sourceId || triggerFormUuid);
      }
      const branches = node.branches || node.conditions || [];
      for (const branch of Array.isArray(branches) ? branches : []) {
        visit(branch.nodes || branch.childNodes || branch.children);
      }
    }
  }
  visit(spec.nodes || spec.flow || spec.steps);
  return [...result];
}

function buildRetrieveOutputs(fields) {
  return fields.filter(field => field.props?.fieldId && /Field$/.test(field.componentName))
    .map(field => ({
      value: field.props.fieldId,
      text: parseYidaI18n(field.props.label, field.props.fieldId, { parseJson: false }),
      componentName: field.componentName,
      props: clone(field.props),
      supportSort: !/Select|Employee|Department|Attachment|Table/.test(field.componentName),
      children: [],
    }));
}

function hydrateDataNodeMetadata(processJson, viewJson, metadataByUuid, { strict = false } = {}) {
  const execution = new Map();
  const views = new Map();
  walk(processJson.nodes, node => execution.set(node.nodeId, node), 'childNodes');
  walk(viewJson.schema.children, node => views.set(node.id, node), 'children');
  for (const node of views.values()) {
    if (node.componentName !== 'GetSingleDataNode') { continue; }
    const data = node.props.getData;
    const metadata = metadataByUuid.get(data.sourceId);
    if (!metadata) {
      if (strict) { throw new Error(t('integration.data_metadata_missing', data.sourceId)); }
      continue;
    }
    if (!['receipt', 'process'].includes(metadata.formType) || !metadata.formName) {
      throw new Error(t('integration.data_metadata_invalid', data.sourceId));
    }
    const outputs = buildRetrieveOutputs(metadata.fields || []);
    if (strict && !outputs.length) { throw new Error(t('integration.data_fields_missing', data.sourceId)); }
    const originalType = metadata.formType === 'process' ? 'process_form' : 'form';
    data.originalType = originalType;
    data.targetItem = {
      appType: data.appType,
      appName: metadata.appName || '',
      formItem: {
        formType: metadata.formType, advanceProc: 'n', formUuid: data.sourceId,
        title: metadata.formName, fields: null, hasTableField: null,
      },
    };
    data.outputs = outputs;
    if (metadata.rulesFilter) { data.rulesFilter = clone(metadata.rulesFilter); }
    execution.get(node.id).props.originalType = originalType;
    const description = `从 [${metadata.formName}] 中获取单条数据`;
    node.props.description = description;
    execution.get(node.id).description = description;
  }
  for (const node of views.values()) {
    if (node.componentName !== 'UpdateDataNode') { continue; }
    const rules = node.props.updateDataRules;
    const source = views.get(rules.sourceId);
    if (strict && rules.type === 'node') {
      if (!source?.props.getData) { throw new Error(t('integration.data_update_source_invalid', rules.sourceId)); }
      const known = new Set(source.props.getData.outputs.map(field => field.value));
      for (const assignment of rules.assignments || []) {
        if (!known.has(assignment.column)) { throw new Error(t('integration.data_update_field_unknown', assignment.column)); }
      }
    }
    if (source) {
      const description = `在 [${source.props.name}] 中更新数据`;
      rules.description = description;
      node.props.description = description;
      execution.get(node.id).props.description = description;
      execution.get(node.id).description = description;
    }
  }
  return { processJson, viewJson };
}

// Guard raw API callers too, without reconstructing or overwriting their view.
// Other source/node kinds are deliberately left to their own contracts.
function assertDataNodeMetadata(processJson, viewJson) {
  const execution = new Map();
  const views = new Map();
  walk(processJson?.nodes, node => execution.set(node.nodeId, node), 'childNodes');
  walk(viewJson?.schema?.children, node => views.set(node.id, node), 'children');
  for (const node of views.values()) {
    if (node.componentName !== 'GetSingleDataNode') { continue; }
    const data = node.props?.getData;
    if (!data?.originalType) { throw new Error(t('integration.data_metadata_missing', node.id)); }
    if (!['form', 'process_form'].includes(data.originalType)) { continue; }
    const expectedType = data.originalType === 'process_form' ? 'process' : 'receipt';
    if (data.targetItem?.formItem?.formType !== expectedType
      || !data.targetItem.formItem.title
      || data.targetItem.formItem.formUuid !== data.sourceId
      || execution.get(node.id)?.props?.originalType !== data.originalType) {
      throw new Error(t('integration.data_metadata_invalid', node.id));
    }
    if (!data.outputs?.length || data.outputs.some(field => !field.value || !field.text || !field.componentName || !field.props)) {
      throw new Error(t('integration.data_fields_missing', node.id));
    }
  }
  for (const node of views.values()) {
    if (node.componentName !== 'UpdateDataNode') { continue; }
    const rules = node.props?.updateDataRules;
    const source = views.get(rules?.sourceId)?.props?.getData;
    if (rules?.type !== 'node' || !source || !['form', 'process_form'].includes(source.originalType)) { continue; }
    if (!rules.description?.trim()) { throw new Error(t('integration.data_metadata_missing', `${node.id}.description`)); }
    const known = new Set((source.outputs || []).map(field => field.value));
    for (const assignment of rules.assignments || []) {
      if (!known.has(assignment.column)) { throw new Error(t('integration.data_update_field_unknown', assignment.column)); }
    }
  }
}

module.exports = { collectRetrieveFormUuids, buildRetrieveOutputs, hydrateDataNodeMetadata, assertDataNodeMetadata };
