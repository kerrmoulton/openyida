'use strict';

const { CliError } = require('../core/cli-error');
const { t } = require('../core/i18n');
const { isDeepStrictEqual } = require('util');
const { buildAddDataChildList, buildSubTableAddDataChildList } = require('./integration-view-builder');

function fail(reason, node, extra = {}) {
  throw new CliError(t('integration.batch_invalid'), {
    code: 'INTEGRATION_BATCH_INVALID',
    details: { reason, node: node.id || node.key || node.name || '', remoteWrites: 0, ...extra },
  });
}

function retrieveMode(node) {
  const nativeBatch = /^(getbatchdata|getbatchdatanode)$/i.test(node.type || node.componentName || '');
  const mode = node.retrieveType || (nativeBatch ? 'batch' : 'single');
  if (!['single', 'batch'].includes(mode) || nativeBatch && mode !== 'batch') {
    fail('INVALID_RETRIEVE_TYPE', node);
  }
  return mode;
}

function createMode(node) {
  const mode = node.createType || 'single';
  if (!['single', 'batch'].includes(mode)) { fail('INVALID_CREATE_TYPE', node); }
  return mode;
}

function isSingleFormSource(node, type) {
  return type === 'getSelf'
    || type === 'dataRetrieve' && retrieveMode(node) === 'single' && node.originalType !== 'sub_table'
    || type === 'dataCreate' && createMode(node) === 'single' && (node.insertType || 'form') === 'form';
}

/** Batch sources must be stable upstream row sets, including inside branches. */
function validateBatchNode(node, type, upstream, normalizeType) {
  if (type === 'getSelf' || type === 'dataRetrieve') {
    const mode = retrieveMode(node);
    if (type === 'getSelf' && mode !== 'single') { fail('GET_SELF_MUST_BE_SINGLE', node); }
    if (mode === 'batch' && (!['number', 'string'].includes(typeof node.quantity)
      || !/^\d+$/.test(String(node.quantity)) || !Number.isSafeInteger(Number(node.quantity)) || Number(node.quantity) < 1)) {
      fail('POSITIVE_QUANTITY_REQUIRED', node);
    }
    if (node.filterType && !['all', 'condition'].includes(node.filterType)) { fail('INVALID_FILTER_TYPE', node); }
    if (node.filterType === 'all' && (node.conditions || node.dataConditions || []).length) {
      fail('ALL_FILTER_WITH_CONDITIONS', node);
    }
    if (mode === 'batch' && node.originalType === 'sub_table') {
      const parent = upstream && upstream.get(node.source || node.from);
      if (!parent || !isSingleFormSource(parent, normalizeType(parent.type || parent.componentName))) {
        fail('SINGLE_SOURCE_RECORD_REQUIRED', node);
      }
    }
  }
  if (type !== 'dataCreate') { return; }
  const mode = createMode(node);
  if (mode !== 'batch') {
    if (node.batchSource) { fail('BATCH_SOURCE_ON_SINGLE_CREATE', node); }
    return;
  }
  const source = upstream && upstream.get(node.batchSource);
  if (!source || normalizeType(source.type || source.componentName) !== 'dataRetrieve' || retrieveMode(source) !== 'batch') {
    fail('UPSTREAM_BATCH_SOURCE_REQUIRED', node, { batchSource: node.batchSource || null });
  }
  if (node.insertType && !['form', 'sub_table'].includes(node.insertType)) { fail('INVALID_INSERT_TYPE', node); }
  if (node.insertType === 'sub_table') {
    const parent = upstream.get(node.source || node.from);
    if (!parent || !isSingleFormSource(parent, normalizeType(parent.type || parent.componentName))) {
      fail('SINGLE_TARGET_RECORD_REQUIRED', node);
    }
  }
  // A processVar in a batch assignment is the current row, not a trigger field.
  for (const assignment of node.assignments || []) {
    const valueType = assignment.valueType || 'literal';
    if (valueType === 'processVar') {
      const match = typeof assignment.value === 'string' && assignment.value.match(/^\$\{([^}]+)\}\.([^\s.]+)$/);
      if (!match || match[1] !== node.batchSource) { fail('BATCH_ROW_REFERENCE_REQUIRED', node); }
    }
  }
}

/** Use the platform's current-row batch_ prefix, never serialize the spec alias. */
function batchAssignments(node, assignments, context) {
  if (createMode(node) !== 'batch') { return assignments; }
  const sourceId = context.aliasToNodeId.get(node.batchSource);
  const source = context.aliasToSpecNode.get(node.batchSource);
  const formUuid = source.originalType === 'sub_table'
    ? context.batchParentFormUuid(source)
    : source.formUuid || source.sourceId;
  const fields = batchFields(context.formSchemasByUuid.get(formUuid), source.originalType === 'sub_table' ? source.subSourceId : '');
  const known = new Set(fields.map(field => field.fieldId));
  const token = `\${${sourceId}}`;
  const batchToken = `\${batch_${sourceId}}`;
  return assignments.map(assignment => {
    if (!['column', 'processVar'].includes(assignment.valueType)) { return assignment; }
    const value = assignment.value;
    if (typeof value !== 'string') { fail('BATCH_ROW_REFERENCE_REQUIRED', node); }
    const fieldRefs = [...value.matchAll(/\$\{([^}]+)\}\.([\w-]+)/g)];
    for (const match of fieldRefs) {
      if (match[1] === sourceId && !known.has(match[2])) {
        fail('BATCH_SOURCE_FIELD_NOT_FOUND', node, { fieldId: match[2], formUuid });
      }
    }
    return { ...assignment, value: value.split(token).join(batchToken) };
  });
}

function batchFields(components, subSourceId) {
  if (!Array.isArray(components) || !components.length) {
    fail('SOURCE_SCHEMA_REQUIRED', { id: subSourceId || '' });
  }
  const fields = subSourceId
    ? buildSubTableAddDataChildList(components, subSourceId)
    : buildAddDataChildList(components);
  const nestedIds = new Set();
  const tableIds = new Set(components.filter(node => node.componentName === 'TableField').map(node => node.props && node.props.fieldId));
  function collect(nodes) {
    for (const node of nodes || []) {
      if (node.props && node.props.fieldId) { nestedIds.add(node.props.fieldId); }
      collect(node.children);
    }
  }
  if (!subSourceId) {
    components.filter(node => node.componentName === 'TableField').forEach(node => collect(node.children));
  }
  const result = fields.filter(field => field.componentName !== 'TableField'
    && (subSourceId || !tableIds.has(field.props.parentId) && !nestedIds.has(field.fieldId)));
  if (!result.length) { fail('SOURCE_FIELDS_EMPTY', { id: subSourceId || '' }); }
  return result;
}

function batchSourceId(node, context) {
  return createMode(node) === 'batch' ? context.aliasToNodeId.get(node.batchSource) : null;
}

function batchDesignerSource(node, source, context) {
  const sourceId = batchSourceId(node, context);
  return sourceId ? source.split(`#{${sourceId}//`).join(`#{batch_${sourceId}//`) : source;
}

/** Compare persisted batch controls, including row source and retrieval limit. */
function projectBatchData(root) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const props = node.props || {};
    if (node.componentName === 'GetBatchDataNode') {
      const data = props.getData || {};
      result.push({ id: node.id, componentName: node.componentName, type: props.type,
        dataType: data.type, sourceId: data.sourceId, subSourceId: data.subSourceId || '',
        originalType: data.originalType, quantity: Number(data.quantity), filterType: data.filterType,
        sort: data.sort,
        condition: data.filterType === 'all' ? null : data.condition });
    }
    if (node.componentName === 'AddDataNode' && props.addDataRules && props.addDataRules.type === 'batch') {
      const data = props.addDataRules;
      result.push({ id: node.id, componentName: node.componentName, type: data.type,
        sourceId: data.sourceId, formUuid: data.formUuid, insertType: data.insertType, subFormUuid: data.subFormUuid || '' });
    }
    Object.values(node).forEach(visit);
  }
  visit(root);
  return result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function verifyBatchReadback(detail, expected) {
  if (!expected || !expected.length) { return 'NOT_REQUESTED'; }
  if (!isDeepStrictEqual(projectBatchData(detail), expected)) {
    throw new CliError(t('integration.batch_readback_mismatch'), { code: 'INTEGRATION_READBACK_BATCH_MISMATCH' });
  }
  return 'EXACT';
}

module.exports = { retrieveMode, createMode, validateBatchNode, batchAssignments, batchFields,
  batchSourceId, batchDesignerSource, isSingleFormSource, projectBatchData, verifyBatchReadback };
