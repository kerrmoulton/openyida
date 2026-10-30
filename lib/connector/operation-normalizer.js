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

function findParameter(parameters, paramLocation, name) {
  const list = parameters && Array.isArray(parameters[paramLocation])
    ? parameters[paramLocation]
    : [];
  return list.find(parameter => parameter && parameter.name === name);
}

function normalizeParamNode(node, paramLocation, parameters) {
  if (!node || typeof node !== 'object') {
    return node;
  }

  // Body 的字段树由 JSON 解析器维护；网页保存时不会改写这部分结构。
  if (paramLocation === 'body') {
    return { ...node };
  }

  const parameter = findParameter(parameters, paramLocation, node.name);
  const common = {
    componentName: 'TextField',
    desc: node.desc || node.description || node.name || '',
    name: node.name,
  };

  if (paramLocation === 'header') {
    return {
      componentName: 'TextField',
      defaultValue: node.defaultValue ?? parameter?.value ?? '',
      desc: common.desc,
      name: common.name,
      required: false,
    };
  }

  if (paramLocation === 'query') {
    return {
      ...common,
      queryDefaultValue: node.queryDefaultValue ?? {},
      required: false,
    };
  }

  return {
    ...common,
    required: Boolean(node.required),
  };
}

function normalizeInput(input, parameters) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const paramLocation = inferParamLocation(input);
  if (paramLocation === 'body') {
    return {
      ...input,
      childList: Array.isArray(input.childList)
        ? input.childList.map(child => normalizeParamNode(child, paramLocation, parameters))
        : [],
    };
  }

  return {
    childList: Array.isArray(input.childList)
      ? input.childList.map(child => normalizeParamNode(child, paramLocation, parameters))
      : [],
    ...(input.desc !== undefined ? { desc: input.desc } : {}),
    name: input.name,
    paramType: input.paramType || 'Object',
    required: paramLocation === 'header' ? false : Boolean(input.required),
  };
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
      parameters.header = childList
        .map(child => ({
          name: child.name,
          value: child.defaultValue || '',
        }))
        .filter(entry => String(entry.value || '').trim() !== '');
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

  if (rebuilt.header.length > 0 && (!Array.isArray(normalized.header) || normalized.header.length === 0)) {
    normalized.header = rebuilt.header;
  } else if (normalized.header !== undefined && !Array.isArray(normalized.header)) {
    normalized.header = [];
  }
  normalized.header = (normalized.header || []).filter(entry => (
    entry
    && typeof entry === 'object'
    && String(entry.name || '').trim() !== ''
    && String(entry.value || '').trim() !== ''
  ));

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

  if (parameters && parameters.header === undefined && !rebuilt.header.length) { delete normalized.header; }
  const ordered = {};
  for (const location of ['path', 'query', 'header', 'body']) {
    if (normalized[location] !== undefined) {
      ordered[location] = normalized[location];
    }
  }
  for (const [name, value] of Object.entries(normalized)) {
    if (ordered[name] === undefined) {
      ordered[name] = value;
    }
  }
  return ordered;
}

function normalizeOutput(output) {
  if (!output || typeof output !== 'object') {
    return output;
  }

  const normalized = { ...output };
  if (normalized.defaultValue !== undefined || (Array.isArray(normalized.childList) && normalized.childList.length > 0)) {
    return normalized;
  }

  return {
    defaultValue: normalized.defaultValue ?? '',
    desc: '响应体结构',
    name: normalized.name || 'Response',
    paramType: normalized.paramType || 'Object',
    required: Boolean(normalized.required),
  };
}

const INPUT_ORDER = new Map([
  ['path', 0],
  ['query', 1],
  ['header', 2],
  ['body', 3],
]);

function sortInputs(inputs) {
  return inputs
    .map((input, index) => ({ input, index }))
    .sort((left, right) => {
      const leftRank = INPUT_ORDER.get(inferParamLocation(left.input)) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = INPUT_ORDER.get(inferParamLocation(right.input)) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(item => item.input);
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
  const rawParameters = operation.parameters && typeof operation.parameters === 'object'
    ? operation.parameters
    : {};
  const inputs = sortInputs(Array.isArray(operation.inputs)
    ? operation.inputs.map(input => normalizeInput(input, rawParameters))
    : []);
  const responses = operation.responses || { type: 'object', properties: {} };
  const outputs = Array.isArray(operation.outputs) && operation.outputs.length > 0
    ? operation.outputs.map(normalizeOutput)
    : [normalizeOutput(generateOutputs(responses, operationId))];

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
  const normalized = list.map(normalizeOperation);
  const seen = new Set();
  for (const operation of normalized) {
    if (seen.has(operation.operationId)) {
      const error = new Error(`执行动作 operationId 重复: ${operation.operationId}`);
      error.code = 'CONNECTOR_OPERATION_ID_DUPLICATE';
      throw error;
    }
    seen.add(operation.operationId);
  }
  return normalized;
}

module.exports = {
  deriveOperationId,
  normalizeOperation,
  normalizeOperations,
  slugifyOperationId,
};
