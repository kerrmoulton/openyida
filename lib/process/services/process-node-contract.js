'use strict';

const { CliError } = require('../../core/cli-error');
const { isDeepStrictEqual } = require('util');
const { t } = require('../../core/i18n');
const { analyzeFormula } = require('../../formula/evaluate');
const { prepare } = require('../../formula/syntax');
const { buildConnectorCallAssignments } = require('../../integration/integration-process-builder');

function invalid(path, expected) {
  throw new CliError(t('process_node.invalid', path, expected), {
    code: 'PROCESS_NODE_CONTRACT_INVALID', details: { path, expected, remoteWrites: 0 },
  });
}

// Designer references use // inside the token; the workflow engine uses a
// property after the token. Work from parsed reference spans, never strings.
function nodeFormula(value, path, metadata = {}) {
  const object = value && typeof value === 'object' ? value : { value };
  const source = object.__source ?? metadata.__source ?? object.value;
  if (typeof source !== 'string' || !source.trim()) { invalid(path, 'node-expression'); }
  const checked = analyzeFormula(source, { context: 'automation' });
  if (!checked.ok) {
    throw new CliError(t('process_node.formula_invalid', path), {
      code: 'PROCESS_NODE_FORMULA_INVALID', details: { path, remoteWrites: 0,
        diagnostics: checked.diagnostics.filter(d => d.level === 'error').map(d => ({
          code: d.code, functionName: d.functionName, fieldId: d.fieldId,
          componentName: d.componentName, suggestion: d.suggestion,
        })) },
    });
  }
  let runtime = source;
  for (const ref of [...prepare(source).refs.values()].reverse()) {
    const token = source.slice(ref.index, ref.index + ref.length);
    if (token.startsWith('#{') && token.slice(2, token.indexOf('}')).includes('//')) {
      const [node, ...fields] = ref.path.split('//');
      runtime = runtime.slice(0, ref.index) + '#{' + node + '}.' + fields.join('.') + runtime.slice(ref.index + ref.length);
    }
  }
  return { value: runtime, __source: source, __display: object.__display ?? metadata.__display ?? source };
}

function runtimeAssignments(items, path) {
  if (!Array.isArray(items)) { invalid(path, 'Array'); }
  return items.map((item, index) => {
    const where = path + '[' + index + ']';
    if (!item || typeof item.column !== 'string' || !item.column.trim()) { invalid(where + '.column', 'String'); }
    if (!['literal', 'processVar', 'column', 'Object', 'Array'].includes(item.valueType || 'literal')) { invalid(where + '.valueType', 'literal | processVar | column | Object | Array'); }
    const result = { ...item };
    if (item.valueType === 'column') { result.value = nodeFormula(item.value, where + '.value', item).value; }
    if (item.assignments !== undefined) { result.assignments = runtimeAssignments(item.assignments, where + '.assignments'); }
    return result;
  });
}

function connectorInputs(config = {}, path = 'connectorRules') {
  // `inputs` can be an editor schema array OR a legacy runtime input object.
  // Editor metadata must never be Object.assign'ed into runtime parameters.
  if (config.inputs !== undefined && config.inputs !== null && (typeof config.inputs !== 'object')) { invalid(path + '.inputs', 'Array | Object'); }
  const legacy = !Array.isArray(config.inputs) && config.inputs || {};
  let assignments;
  if (config.assignments !== undefined || legacy.assignments !== undefined) {
    assignments = runtimeAssignments(config.assignments ?? legacy.assignments, path + '.assignments');
  } else {
    const flat = new Map();
    const collect = (entries, parent = '') => {
      if (!Array.isArray(entries)) { invalid(path + '.rules', 'Array'); }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') { invalid(path + '.rules', 'Object'); }
        const location = entry.id || (parent ? parent + '%' : '') + (entry.name || '');
        if (Array.isArray(entry.rules)) {
          for (const rule of entry.rules) {
            if (!rule || typeof rule !== 'object' || Array.isArray(rule)) { invalid(path + '.rules', 'Object'); }
            let column = rule.column;
            if (!column) {
              if (rule.id === location || typeof rule.id === 'string' && rule.id.includes('%')) { column = rule.id; }
              else if (rule.name === entry.name) { column = location; }
              else if (['Query', 'Path', 'Headers', 'Body'].includes(location.split('%')[0])) {
                if (typeof rule.name !== 'string' || !rule.name) { invalid(path + '.rules.name', 'String'); }
                column = location + '%' + rule.name;
              } else { column = rule.name || rule.id; }
            }
            if (typeof column !== 'string' || !column.trim()) { invalid(path + '.rules.column', 'String'); }
            const assignment = { column, valueType: rule.valueType || 'literal', value: rule.value };
            if (assignment.valueType === 'column') { assignment.value = nodeFormula(rule.value, path + '.' + column, rule).value; }
            if (flat.has(column) && JSON.stringify(flat.get(column)) !== JSON.stringify(assignment)) { invalid(path + '.' + column, 'unique assignment'); }
            flat.set(column, assignment);
          }
        } else if (entry.valueType !== undefined) {
          const column = entry.column || location;
          const assignment = { column, valueType: entry.valueType, value: entry.value };
          if (entry.valueType === 'column') { assignment.value = nodeFormula(entry.value, path + '.' + column, entry).value; }
          flat.set(column, assignment);
        }
        if (entry.childList) { collect(entry.childList, location); }
      }
    };
    collect(config.rules || []);
    assignments = buildConnectorCallAssignments([...flat.values()], new Map(), { allowEmptyLiterals: true });
  }
  const inputs = {};
  for (const key of ['url', 'method', 'body', 'connection', 'connectorId', 'actionId', 'connectorMode']) {
    if (legacy[key] !== undefined) { inputs[key] = legacy[key]; }
  }
  Object.assign(inputs, {
    url: config.url ?? inputs.url, method: config.method ?? inputs.method, body: config.body ?? inputs.body,
    connection: config.connectionId ?? config.connection ?? inputs.connection,
    connectorId: config.connectorId ?? inputs.connectorId, actionId: config.actionId ?? inputs.actionId, assignments,
  });
  if (config.openDevSchemaType === 'integrationObject') {
    Object.assign(inputs, { openDevSchemaType: config.openDevSchemaType, connectorOrgId: config.connector?.orgId,
      integrationObject: config.integrationObject, integrationObjectPath: config.integrationObjectPath });
  }
  return Object.fromEntries(Object.entries(inputs).filter(([, value]) => value !== undefined));
}

function codeConfig(config, component, path = component) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) { invalid(path, 'Object'); }
  const scriptType = component === 'JavaScriptNode' ? 'JavaScript' : 'groovy';
  if (config.scriptType !== undefined && String(config.scriptType).toLowerCase() !== scriptType.toLowerCase()) { invalid(path + '.scriptType', scriptType); }
  if (config.inputs !== undefined && !Array.isArray(config.inputs)) { invalid(path + '.inputs', 'Array'); }
  if (config.outputs !== undefined && config.outputs !== null && !Array.isArray(config.outputs)) { invalid(path + '.outputs', 'Array | null'); }
  if (typeof config.action?.code !== 'string' || !config.action.code.trim()) { invalid(path + '.action.code', 'String'); }
  return { ...config, inputs: config.inputs || [], scriptType, action: { exceptionStrategy: '', ...config.action } };
}

function visitNodes(nodes, key, callback, parent = 'nodes') {
  for (const [index, node] of (nodes || []).entries()) {
    callback(node, parent + '[' + index + ']');
    visitNodes(node[key], key, callback, parent + '[' + index + '].' + key);
  }
}

function validateProcessNodes(view, process) {
  if (!Array.isArray(view?.schema?.children)) { invalid('viewJson.schema.children', 'Array'); }
  const runtime = new Map();
  const views = new Map();
  const formulas = [];
  function collectFormulas(assignments, path) {
    for (const item of assignments) {
      if (item.valueType === 'column') { formulas.push({ value: item.value, path }); }
      collectFormulas(item.assignments || [], path);
    }
  }
  if (process) {
    if (!Array.isArray(process.nodes)) { invalid('json.nodes', 'Array'); }
    visitNodes(process.nodes, 'childNodes', (n, path) => {
      if (runtime.has(n.nodeId)) { invalid(path + '.nodeId', 'unique node ID'); }
      runtime.set(n.nodeId, n);
    });
  }
  visitNodes(view.schema.children, 'children', (node, path) => {
    const props = node.props || {}, actual = runtime.get(node.id);
    if (node.id) {
      if (views.has(node.id)) { invalid(path + '.id', 'unique node ID'); }
      views.set(node.id, node);
    }
    if (node.componentName === 'ConnectorNode') {
      if (Number(props.connectorRules?.connector?.mode ?? props.connectorRules?.mode ?? 5) === 5
        && props.connectorRules?.inputs !== undefined && !Array.isArray(props.connectorRules.inputs)) {
        invalid(path + '.connectorRules.inputs', 'native HTTP editor schema Array');
      }
      const expected = connectorInputs(props.connectorRules, path + '.connectorRules');
      collectFormulas(expected.assignments, path + '.connectorRules');
      if (process) {
        runtimeAssignments(actual?.props?.inputs?.assignments, path + '.runtime.assignments');
        for (const key of ['assignments', 'connectorId', 'actionId', 'connection', 'url', 'method', 'body']) {
          if (!isDeepStrictEqual(actual?.props?.inputs?.[key], expected[key])) { invalid(path + '.runtime.' + key, 'matching designer configuration'); }
        }
        if (Object.keys(actual.props.inputs).some(k => /^\d+$/.test(k))) { invalid(path + '.runtime.inputs', 'parameter object without editor schema'); }
      }
    } else if (['GroovyNode', 'JavaScriptNode'].includes(node.componentName)) {
      const key = node.componentName === 'GroovyNode' ? 'groovy' : 'JavaScript';
      const normalized = codeConfig(props[key], node.componentName, path + '.' + key);
      if (process) {
        if (!Array.isArray(actual?.props?.inputs)) { invalid(path + '.runtime.inputs', 'Array'); }
        if (!isDeepStrictEqual(actual.props.inputs, normalized.inputs)
          || actual.props.scriptType !== normalized.scriptType || !isDeepStrictEqual(actual.props.action, normalized.action)) { invalid(path + '.runtime', 'matching native script configuration'); }
      }
    } else if (node.componentName === 'ConditionNode' && props.conditions?.calculate === 'expression') {
      const normalized = nodeFormula(props.conditions.expression, path + '.expression', props.conditions);
      formulas.push({ value: normalized.value, path: path + '.expression' });
      if (process && actual?.props?.expression !== normalized.value) { invalid(path + '.runtime.expression', 'matching designer formula'); }
    }
  });
  for (const [id, node] of runtime) {
    if (['CodeExecutor', 'httpConnector', 'innerConnector', 'thirdConnector', 'faasConnector'].includes(node.type)
      && !views.has(id)) { invalid('json.nodes.' + id, 'matching designer node'); }
  }
  for (const formula of formulas) {
    for (const ref of prepare(formula.value).refs.values()) {
      if (ref.path.includes('//') && !views.has(ref.path.split('//')[0]) && !runtime.has(ref.path.split('//')[0])) {
        invalid(formula.path, 'existing native node ID: ' + ref.path.split('//')[0]);
      }
    }
  }
}

module.exports = { invalid, nodeFormula, connectorInputs, codeConfig, visitNodes, validateProcessNodes };
