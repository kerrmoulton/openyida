'use strict';

const { generateOutputs } = require('./response-parser');

function slugifyOperationId(value, fallback) {
  const slug = String(value || '')
    .trim()
    .replace(/^\//, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug || fallback;
}

function deriveOperationId(operation, index) {
  const explicitId = String(operation.operationId || '').trim();
  if (explicitId) {
    return explicitId;
  }

  const fallback = `operation_${index + 1}`;
  const candidates = [operation.url, operation.path, operation.id, operation.name, operation.summary];
  for (const candidate of candidates) {
    const operationId = slugifyOperationId(candidate, '');
    if (operationId) {
      return operationId;
    }
  }

  return fallback;
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/^\/+/, '');
}

function inferParamLocation(input) {
  if (input.paramLocation) {
    return input.paramLocation;
  }

  const name = String(input.name || '').toLowerCase();
  if (name === 'headers' || name === 'header') {
    return 'header';
  }
  if (name === 'query' || name === 'queries') {
    return 'query';
  }
  if (name === 'path' || name === 'paths') {
    return 'path';
  }
  if (name === 'body') {
    return 'body';
  }

  return null;
}

function inferParamType(node) {
  if (node.paramType) {
    return node.paramType;
  }

  const componentName = String(node.componentName || '').toLowerCase();
  if (componentName.includes('number') || componentName.includes('rate')) {
    return 'Number';
  }
  if (componentName.includes('boolean') || componentName.includes('checkbox') || componentName.includes('switch')) {
    return 'Boolean';
  }

  return 'String';
}

function normalizeParamNode(node, paramLocation, operationId) {
  if (!node || typeof node !== 'object') {
    return node;
  }

  const normalized = { ...node };
  normalized.paramType = inferParamType(normalized);
  if (!normalized._key && normalized.name) {
    normalized._key = `${operationId}%${normalized.name}`;
  }
  delete normalized.componentName;
  if (paramLocation && !normalized.paramLocation) {
    normalized.paramLocation = paramLocation;
  }
  if (normalized.__level === undefined) {
    normalized.__level = 0;
  }
  if (normalized.hidden === undefined) {
    normalized.hidden = false;
  }
  if (!Array.isArray(normalized.children)) {
    normalized.children = [];
  }
  if (!Array.isArray(normalized.childList)) {
    normalized.childList = [];
  }
  normalized.children = normalized.children.map(child => normalizeParamNode(child, paramLocation, operationId));
  normalized.childList = normalized.childList.map(child => normalizeParamNode(child, paramLocation, operationId));
  return normalized;
}

function normalizeInput(input, operationId) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const paramLocation = inferParamLocation(input);
  const normalized = { ...input };
  if (paramLocation && !normalized.paramLocation) {
    normalized.paramLocation = paramLocation;
  }
  if (!Array.isArray(normalized.childList)) {
    normalized.childList = [];
  }
  normalized.childList = normalized.childList.map(child => normalizeParamNode(child, paramLocation, operationId));
  return normalized;
}

function buildParametersFromInputs(inputs) {
  const parameters = { header: [] };

  for (const input of inputs) {
    if (!input || typeof input !== 'object') {
      continue;
    }

    const location = inferParamLocation(input);
    const childList = Array.isArray(input.childList) ? input.childList : [];

    if (location === 'header') {
      parameters.header = childList.map(child => ({
        name: child.name,
        value: child.defaultValue ?? '',
      }));
    } else if (location === 'query') {
      parameters.query = childList.map(child => ({
        name: child.name,
        value: child.defaultValue ?? '',
      }));
    } else if (location === 'path') {
      parameters.path = childList.map(child => ({
        name: child.name,
        value: child.defaultValue ?? '',
      }));
    } else if (location === 'body' && input.defaultValue !== undefined) {
      parameters.body = { default: input.defaultValue };
    }
  }

  return parameters;
}

function normalizeParameters(parameters, inputs) {
  const rebuilt = buildParametersFromInputs(inputs);
  const normalized = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? { ...parameters }
    : {};

  if (!Array.isArray(normalized.header) || (normalized.header.length === 0 && rebuilt.header.length > 0)) {
    normalized.header = rebuilt.header;
  }

  for (const location of ['query', 'path']) {
    const rebuiltList = rebuilt[location] || [];
    if (rebuiltList.length > 0 && (!Array.isArray(normalized[location]) || normalized[location].length === 0)) {
      normalized[location] = rebuiltList;
    } else if (normalized[location] !== undefined && !Array.isArray(normalized[location])) {
      normalized[location] = [];
    }
  }

  if (normalized.body === undefined && rebuilt.body !== undefined) {
    normalized.body = rebuilt.body;
  }

  return normalized;
}

function normalizeOutput(output) {
  if (!output || typeof output !== 'object') {
    return output;
  }

  const normalized = { ...output };
  if (!Array.isArray(normalized.childList)) {
    normalized.childList = [];
  }
  return normalized;
}

function normalizeOperation(operation, index) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error(`第 ${index + 1} 个执行动作必须是对象`);
  }

  const operationId = deriveOperationId(operation, index);
  const rawUrl = operation.url !== undefined && operation.url !== null ? operation.url : operation.path;
  const hasUrl = rawUrl !== undefined && rawUrl !== null && String(rawUrl).trim() !== '';
  const url = normalizeUrl(rawUrl);

  if (!hasUrl) {
    throw new Error(`第 ${index + 1} 个执行动作缺少 url/path`);
  }

  const summary = operation.summary || operation.name || operationId;
  const description = operation.description || operation.desc || summary;
  const method = String(operation.method || 'get').toLowerCase();
  const inputs = Array.isArray(operation.inputs)
    ? operation.inputs.map(input => normalizeInput(input, operationId))
    : [];
  const responses = operation.responses || { type: 'object', properties: {} };
  const outputs = Array.isArray(operation.outputs) && operation.outputs.length > 0
    ? operation.outputs.map(normalizeOutput)
    : [generateOutputs(responses, operationId)];

  return {
    ...operation,
    id: operation.id || `operation-${operationId}`,
    operationId,
    summary,
    description,
    url,
    method,
    inputs,
    parameters: normalizeParameters(operation.parameters, inputs),
    responses,
    outputs,
    origin: operation.origin !== undefined ? operation.origin : true,
  };
}

function normalizeOperations(operations) {
  const list = Array.isArray(operations) ? operations : [operations];
  return list.map(normalizeOperation);
}

module.exports = {
  normalizeOperation,
  normalizeOperations,
};
