'use strict';

const { getConnectorDetail, findConnectorById } = require('../connector/api');
const { normalizeOperation } = require('../connector/operation-normalizer');

const GROUP_DESCRIPTIONS = {
  Path: '路径变量',
  Query: '查询参数',
  Headers: '请求头',
  Body: '请求体',
};

function parseOperations(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return [];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error('连接器 operations 不是数组');
  }
  return parsed;
}

function buildConnectorActionUrl(connector, operation) {
  const scheme = connector.scheme || 'https';
  const host = String(connector.host || '').replace(/^\/+|\/+$/g, '');
  const baseUrl = String(connector.baseUrl || '').replace(/^\/+|\/+$/g, '');
  const operationUrl = String(operation.url || '').replace(/^\/+/, '');
  const path = [baseUrl, operationUrl].filter(Boolean).join('/');
  return `${scheme}://${host}/${path}`;
}

function normalizeEditorSchemaItem(item, options = {}) {
  const source = item && typeof item === 'object' ? item : {};
  const name = source.name || '';
  const children = Array.isArray(source.childList)
    ? source.childList.map(child => normalizeEditorSchemaItem(child))
    : null;
  const isGroup = options.isGroup === true;
  const defaultDescription = isGroup
    ? (GROUP_DESCRIPTIONS[name] || source.desc || name)
    : (source.desc || source.description || name);

  return {
    childList: children && children.length > 0 ? children : null,
    componentName: source.componentName || (isGroup ? 'TextField' : 'TextField'),
    componentOption: source.componentOption || '',
    componentProps: source.componentProps ?? null,
    convert: source.convert || '',
    defaultValue: source.defaultValue ?? '',
    desc: defaultDescription,
    display: source.display ?? true,
    itemType: source.itemType || '',
    label: source.label ?? name,
    name,
    order: source.order ?? null,
    paramType: source.paramType || '',
    queryDefaultValue: source.queryDefaultValue ?? null,
    required: Boolean(source.required),
    successCondition: source.successCondition || '',
    successFlag: source.successFlag ?? null,
  };
}

function normalizeEditorInputs(inputs) {
  return (Array.isArray(inputs) ? inputs : []).map(input => {
    const normalized = normalizeEditorSchemaItem(input, { isGroup: true });
    if (normalized.name === 'Body' && normalized.defaultValue !== '') {
      normalized.required = true;
    }
    return normalized;
  });
}

function normalizeEditorOutputs(outputs) {
  return (Array.isArray(outputs) ? outputs : []).map(output => {
    const normalized = normalizeEditorSchemaItem(output, { isGroup: true });
    normalized.desc = output.desc || output.description || '响应体结构';
    normalized.display = output.display ?? null;
    normalized.componentName = output.componentName || '';
    normalized.label = output.label ?? '';
    return normalized;
  });
}

function parseSecuritySchemes(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getBodyDefault(operation) {
  const bodyInput = (operation.inputs || []).find(input => input && input.name === 'Body');
  return bodyInput && bodyInput.defaultValue !== undefined
    ? bodyInput.defaultValue
    : operation.parameters && operation.parameters.body
      ? operation.parameters.body.default || ''
      : '';
}

function addContentTypeDefault(assignments, operation) {
  const result = Array.isArray(assignments) ? assignments.map(item => ({ ...item })) : [];
  const method = String(operation.method || '').toLowerCase();
  if (!getBodyDefault(operation) && !['post', 'put', 'patch'].includes(method)) {
    return result;
  }
  const contentTypeColumn = 'Headers%Content-Type';
  if (result.some(item => item && String(item.column || '').replace(/\./g, '%') === contentTypeColumn)) {
    return result;
  }
  const headers = (operation.inputs || []).find(input => input && input.name === 'Headers');
  const contentType = headers && Array.isArray(headers.childList)
    ? headers.childList.find(input => input && input.name.toLowerCase() === 'content-type')
    : null;
  if (!contentType || contentType.defaultValue === undefined || contentType.defaultValue === '') {
    return result;
  }
  return [{
    column: contentTypeColumn,
    valueType: 'literal',
    value: contentType.defaultValue,
    valueLabel: contentType.label || contentType.name,
  }, ...result];
}

function collectInputPaths(inputs) {
  const result = new Set();
  function visit(item, prefix) {
    if (!item || !item.name) {
      return;
    }
    const path = prefix ? `${prefix}%${item.name}` : item.name;
    result.add(path);
    for (const child of item.childList || []) {
      visit(child, path);
    }
  }
  for (const input of inputs || []) {
    visit(input, '');
  }
  return result;
}

function validateConnectorAssignments(assignments, inputs, actionId) {
  const paths = collectInputPaths(inputs);
  const missing = (assignments || [])
    .map(item => item && item.column)
    .filter(column => column && !paths.has(column.replace(/\./g, '%')) &&
      ![...paths].some(path => path.split('%').pop() === column));
  if (missing.length > 0) {
    throw new Error(`连接器动作 ${actionId} 不包含入参: ${missing.join(', ')}`);
  }
}

async function resolveConnectorDetail(authRef, connectorId) {
  if (String(connectorId || '').startsWith('Http_')) {
    return getConnectorDetail(connectorId, authRef);
  }
  const connector = await findConnectorById(connectorId, authRef);
  if (!connector || !connector.connectorName) {
    throw new Error(`未找到连接器: ${connectorId}`);
  }
  return getConnectorDetail(connector.connectorName, authRef);
}

async function hydrateHttpConnectorNode(node, authRef, options = {}) {
  if (!node || !String(node.connectorId || '').startsWith('Http_')) {
    return node;
  }
  const detailCache = options.detailCache;
  let detailPromise = detailCache && detailCache.get(node.connectorId);
  if (!detailPromise) {
    detailPromise = resolveConnectorDetail(authRef, node.connectorId);
    if (detailCache) {
      detailCache.set(node.connectorId, detailPromise);
    }
  }
  const detail = await detailPromise;
  const operations = parseOperations(detail.operations);
  const operationIndex = operations.findIndex(item => item && item.operationId === node.actionId);
  if (operationIndex === -1) {
    throw new Error(`连接器 ${detail.displayName || node.connectorId} 不包含动作: ${node.actionId}`);
  }
  const operation = normalizeOperation(operations[operationIndex], operationIndex);
  const assignments = addContentTypeDefault(
    node.assignments || node.connectorAssignments || [],
    operation
  );
  validateConnectorAssignments(assignments, operation.inputs, node.actionId);
  const securitySchemes = parseSecuritySchemes(detail.securitySchemes);

  return {
    ...node,
    schemaVerificationLevel: 'PLATFORM_READ_ONLY_DISCOVERY',
    connectorId: detail.connectorName || node.connectorId,
    connectorName: detail.connectorName || node.connectorId,
    connectorDisplayName: detail.displayName || node.connectorDisplayName || node.connectorName || node.name,
    connectorMode: 5,
    connectorIcon: detail.iconUrl || node.connectorIcon || node.icon || '',
    connectorDescription: detail.connectorDesc || '',
    connectorConfig: { connectionLess: Object.keys(securitySchemes).length === 0 },
    connectorOrgId: null,
    connectorPriority: 333,
    actionDescription: operation.description || operation.summary || '',
    openDevSchemaType: operation.openDevSchemaType || '',
    inputs: normalizeEditorInputs(operation.inputs),
    outputs: normalizeEditorOutputs(operation.outputs),
    url: buildConnectorActionUrl(detail, operation),
    method: operation.method,
    body: getBodyDefault(operation),
    assignments,
    connectorAssignments: assignments,
  };
}

async function hydrateSpecConnectors(spec, authRef) {
  const detailCache = new Map();
  async function visit(nodes) {
    const result = [];
    for (const node of nodes || []) {
      let hydrated = node;
      if (node && String(node.type || '').toLowerCase() === 'connector') {
        hydrated = await hydrateHttpConnectorNode(node, authRef, { detailCache });
      }
      if (hydrated && Array.isArray(hydrated.branches)) {
        const branches = [];
        for (const branch of hydrated.branches) {
          branches.push({ ...branch, nodes: await visit(branch.nodes || []) });
        }
        hydrated = { ...hydrated, branches };
      }
      result.push(hydrated);
    }
    return result;
  }

  return { ...spec, nodes: await visit(spec && spec.nodes) };
}

module.exports = {
  addContentTypeDefault,
  buildConnectorActionUrl,
  collectInputPaths,
  hydrateHttpConnectorNode,
  hydrateSpecConnectors,
  normalizeEditorInputs,
  normalizeEditorOutputs,
  parseOperations,
  validateConnectorAssignments,
};
