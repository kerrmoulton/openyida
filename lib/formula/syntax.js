'use strict';

const esprima = require('esprima');
const { t } = require('../core/i18n');
const { builtin, context: validateContext } = require('./metadata');

function collectFields(schema) {
  const fields = new Map();
  function visit(node, table = '') {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) { node.forEach(item => visit(item, table)); return; }
    const id = node.props?.fieldId || node.fieldId;
    const component = node.componentName || node.componentType || node.type;
    if (id && (component || !fields.has(id))) { fields.set(id, { component, table }); }
    const nextTable = component === 'TableField' ? id : table;
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'props') { visit(value, nextTable); }
    }
  }
  visit(schema);
  return fields;
}

// Replace references only outside strings; a quoted "#{field}" stays a string.
function prepare(source) {
  let code = '', quote = '', escaped = false;
  const refs = new Map();
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (quote) {
      code += char; i++;
      if (escaped) { escaped = false; } else if (char === '\\') { escaped = true; } else if (char === quote) { quote = ''; }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; code += char; i++; continue; }
    const match = source.slice(i).match(/^[#$]\{([^}]+)\}(?:\.([A-Za-z0-9_.]+))?/);
    if (match) {
      const name = '__oy_ref_' + refs.size;
      const path = match[2] ? match[1] + '//' + match[2] : match[1];
      refs.set(name, { path, fieldId: path.split('//').pop(), index: i, length: match[0].length, nodeReference: match[0].startsWith('$') || !!match[2] });
      code += name; i += match[0].length;
    } else { code += char; i++; }
  }
  return { code, refs };
}

function checkSyntax(source, options = {}) {
  const metadata = options.metadata || builtin;
  const context = validateContext(options.context);
  const fields = options.fields;
  const diagnostics = [], functions = new Set();
  const { code, refs } = prepare(source);
  const add = (level, key, args = [], details = {}) => diagnostics.push({ level, code: key,
    message: t('formula_v2.' + key, ...args), ...details });
  const compatible = (actual, expected) => !actual.length || !expected.length || actual.some(type => expected.includes(type));
  let tree;
  try {
    tree = esprima.parseScript(code, { range: true });
    if (tree.body.length !== 1 || tree.body[0].type !== 'ExpressionStatement') { throw new Error('expression'); }
  } catch (error) {
    add('error', 'syntax_invalid', [error.description || error.message]);
    return { diagnostics, functions: [], resultTypes: [], syntax: 'failed', refs: [...refs.values()] };
  }
  function infer(node) {
    if (!node) { add('error', 'syntax_invalid', ['empty argument']); return []; }
    if (node.type === 'Literal') {
      if (node.value === null || node.regex) { add('error', 'syntax_invalid', ['literal']); return []; }
      return [typeof node.value];
    }
    if (node.type === 'Identifier') {
      const ref = refs.get(node.name);
      if (!ref) { add('error', 'bare_identifier', [node.name]); return []; }
      if (context !== 'automation' && (ref.path.includes('//') || ref.nodeReference)) { add('error', 'reference_context', [ref.path]); return []; }
      // Custom components expose subfields as componentFieldId.code. A known
      // parent proves existence, but its type does not prove the subfield type.
      const directField = fields?.get(ref.fieldId);
      const field = directField || (ref.fieldId.includes('.') && fields?.has(ref.fieldId.split('.')[0]) ? {} : undefined);
      if (fields && !field) { add('error', 'field_missing', [ref.fieldId]); return []; }
      if (fields && (!directField || !metadata.components[field?.component])) { add('warning', 'reference_details_unknown', [ref.fieldId]); }
      return metadata.components[field?.component] || [];
    }
    if (node.type === 'ArrayExpression') { node.elements.forEach(infer); return ['array']; }
    if (node.type === 'UnaryExpression' && node.operator === '-') {
      const type = infer(node.argument);
      if (!compatible(type, ['number'])) { add('error', 'argument_type', ['-', 1, 'number']); }
      return ['number'];
    }
    if (node.type === 'BinaryExpression') {
      const left = infer(node.left), right = infer(node.right);
      if (!(metadata.binaryOperators || ['+', '-', '*', '/']).includes(node.operator)) {
        add('error', 'operator_invalid', [node.operator]); return [];
      }
      if (!compatible(left, ['number']) || !compatible(right, ['number'])) {
        add('error', 'argument_type', [node.operator, '1/2', 'number']);
      }
      return ['number'];
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      const name = node.callee.name;
      functions.add(name);
      const definition = Object.hasOwn(metadata.functions, name) ? metadata.functions[name] : undefined;
      const args = node.arguments.map(infer);
      if (!definition) {
        const suggestion = Object.keys(metadata.functions).find(key => key.toLowerCase() === name.toLowerCase());
        add('error', suggestion ? 'function_case' : 'function_unknown', [suggestion || name],
          { functionName: name, ...(suggestion ? { suggestion } : {}) });
        return [];
      }
      if (!definition.contexts?.length) { add('warning', 'context_unknown', [name]); }
      else if (!definition.contexts.includes(context)) { add('error', 'function_context', [name, context]); }
      const min = definition.required.length;
      const max = definition.variadic ? Infinity : min + definition.optional.length;
      if (args.length < min || args.length > max) {
        add('error', 'argument_count', [name, min, Number.isFinite(max) ? max : 'N', args.length]);
      }
      const expectedAt = index => definition.required[index] || (definition.variadic ? definition.optional[0] : definition.optional[index - min]);
      args.forEach((type, index) => {
        const expected = expectedAt(index);
        if (expected && !compatible(type, expected)) { add('error', 'argument_type', [name, index + 1, expected.join('/')]); }
      });
      // Some signatures explicitly mix types: SEARCH accepts two strings and
      // an optional numeric offset. Enforce sameType only for arguments whose
      // declared types overlap, so the optional parameter remains usable.
      const mismatchedSameTypes = args.some((type, index) => type.length === 1 && args.slice(index + 1).some((other, offset) => {
        const left = expectedAt(index) || [], right = expectedAt(index + offset + 1) || [];
        return other.length === 1 && type[0] !== other[0] && left.some(item => right.includes(item));
      }));
      if (definition.sameType && mismatchedSameTypes) {
        add('error', 'same_type', [name]);
      }
      // IF is polymorphic: infer its branches instead of pretending every type fits.
      if (name === 'IF') { return [...new Set([...(args[1] || []), ...(args[2] || [])])]; }
      return definition.result;
    }
    add('error', 'syntax_invalid', [node.type]); return [];
  }
  const resultTypes = infer(tree.body[0].expression);
  const targetTypes = options.targetType ? metadata.components[options.targetType] : undefined;
  if (targetTypes && !compatible(resultTypes, targetTypes)) { add('error', 'target_type', [resultTypes.join('/'), options.targetType]); }
  if (targetTypes && resultTypes.length > 1 && compatible(resultTypes, targetTypes) && !resultTypes.every(type => targetTypes.includes(type))) {
    add('warning', 'target_branches', [resultTypes.join('/'), options.targetType]);
  }
  if (options.targetType === 'DateField' && resultTypes.includes('date')) { add('warning', 'date_timestamp'); }
  if (['NumberField', 'DateField'].includes(options.targetType) && resultTypes.includes('string')) { add('warning', 'numeric_result_text'); }
  if (options.targetType && !targetTypes) { add('warning', 'target_unknown', [options.targetType]); }
  if (refs.size && !fields) { add('warning', 'schema_missing'); }
  return { diagnostics, functions: [...functions], resultTypes, syntax: 'passed', refs: [...refs.values()] };
}
// Explicit numeric-literals probe mode only. This is not the consumer's
// preCompile/compileValueMap pipeline and cannot verify its coercion semantics.
function bindNumericValues(source, values) {
  const refs = [...prepare(source).refs.values()].reverse();
  let expression = source;
  for (const ref of refs) {
    const value = values[ref.fieldId];
    if (typeof value === 'number' && Number.isFinite(value)) {
      expression = expression.slice(0, ref.index) + '(' + String(value) + ')' + expression.slice(ref.index + ref.length);
    }
  }
  return expression;
}
module.exports = { collectFields, prepare, checkSyntax, bindNumericValues };
