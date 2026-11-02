'use strict';

const fs = require('fs');
const { throwCommandError, throwUsage } = require('../core/command-errors');
const path = require('path');
const { builtin, load: loadMetadata } = require('./metadata');
const { collectFields, checkSyntax } = require('./syntax');
const { selectContract } = require('./contracts');
const { checkWorkflowValueUsage } = require('./workflow-values');
const { FORMULA_COMMANDS } = require('./cli-contract');
const { t } = require('../core/i18n');
const { getComponentFormulaProfile } = require('./component-profiles');
const {
  normalizeFormulaFieldRefs,
  normalizeSubtableFieldId,
  stripSubtableFieldPrefix,
} = require('./field-refs');

const KNOWN_FUNCTIONS = new Set(Object.keys(builtin.functions));


const CHINESE_PUNCTUATION = {
  '，': ',',
  '；': ',',
  '（': '(',
  '）': ')',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
};

const COMPARISON_OPERATORS = [
  { token: '>=', replacement: 'GE(left, right)' },
  { token: '<=', replacement: 'LE(left, right)' },
  { token: '==', replacement: 'EQ(left, right)' },
  { token: '!=', replacement: 'NE(left, right)' },
  { token: '>', replacement: 'GT(left, right)' },
  { token: '<', replacement: 'LT(left, right)' },
  { token: '=', replacement: 'EQ(left, right)' },
];

function parseArgs(args) {
  const parsed = {
    formulaInput: '',
    componentName: '',
    schemaPath: '',
    json: false,
    strict: false,
    help: false,
    context: undefined,
    contract: undefined,
    metadataPath: '',
    targetType: '',
  };
  const formulaParts = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--component' && args[index + 1]) {
      parsed.componentName = args[++index];
    } else if (arg === '--strict') {
      parsed.strict = true;
    } else if ((arg === '--schema' || arg === '-s') && args[index + 1] && !args[index + 1].startsWith('-')) {
      parsed.schemaPath = args[index + 1];
      index++;
    } else if (['--context', '--contract', '--metadata', '--target-type'].includes(arg) && args[index + 1] && !args[index + 1].startsWith('--')) {
      parsed[{ '--context': 'context', '--contract': 'contract', '--metadata': 'metadataPath', '--target-type': 'targetType' }[arg]] = args[++index];
    } else if (!arg.startsWith('--')) {
      formulaParts.push(arg);
    } else {
      throwUsage(t('formula_v2.failed', arg), usage());
    }
  }

  parsed.formulaInput = formulaParts.join(' ').trim();
  return parsed;
}

function usage() {
  return [
    'Usage: openyida ' + FORMULA_COMMANDS.check.usage,
    'Example: openyida formula evaluate \'IF(GT(#{numberField_total}, 100), "high", "low")\' --schema .cache/schema.json',
  ].join('\n');
}

function createDiagnostic(level, code, message, details = {}) {
  return {
    level,
    code,
    message,
    ...details,
  };
}

function readFormulaInput(formulaInput) {
  const resolved = path.resolve(formulaInput);
  if (formulaInput && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return fs.readFileSync(resolved, 'utf-8').replace(/^\uFEFF/, '').trim();
  }
  return String(formulaInput || '').trim();
}

function loadSchemaFieldIds(schemaPath) {
  if (!schemaPath) {
    return null;
  }
  const resolved = path.resolve(schemaPath);
  const schema = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  return collectSchemaFieldIds(schema);
}

function collectSchemaFieldIds(value) {
  const fieldIds = new Set();

  function visit(node) {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (typeof node.fieldId === 'string' && node.fieldId) {
      fieldIds.add(node.fieldId);
    }

    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  }

  visit(value);
  return fieldIds;
}

function scanOutsideStrings(formula, callback) {
  let quote = '';
  let escaped = false;

  for (let index = 0; index < formula.length; index++) {
    const char = formula[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    callback(char, index);
  }
}

function maskIgnoredRanges(formula) {
  const chars = formula.split('');
  let quote = '';
  let escaped = false;

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (quote) {
      chars[index] = ' ';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      chars[index] = ' ';
      continue;
    }

    if (char === '#' && chars[index + 1] === '{') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 2;
      while (index < chars.length && chars[index] !== '}') {
        chars[index] = ' ';
        index++;
      }
      if (index < chars.length) {
        chars[index] = ' ';
      }
    }
  }

  return chars.join('');
}

function collectFieldRefs(formula, diagnostics) {
  const refs = [];
  let quote = '';
  let escaped = false;

  for (let index = 0; index < formula.length; index++) {
    const char = formula[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char !== '#') {
      continue;
    }

    if (formula[index + 1] !== '{') {
      diagnostics.push(createDiagnostic(
        'warning',
        'field_ref_missing_brace',
        'Field references should use #{fieldId}.',
        { index }
      ));
      continue;
    }

    const end = formula.indexOf('}', index + 2);
    if (end === -1) {
      diagnostics.push(createDiagnostic(
        'error',
        'field_ref_unclosed',
        'Field reference is missing a closing }.',
        { index }
      ));
      break;
    }

    const fieldId = formula.slice(index + 2, end).trim();
    if (!fieldId) {
      diagnostics.push(createDiagnostic(
        'error',
        'field_ref_empty',
        'Field reference cannot be empty.',
        { index }
      ));
    } else {
      if (/\s/.test(fieldId)) {
        diagnostics.push(createDiagnostic(
          'warning',
          'field_ref_whitespace',
          `Field reference "${fieldId}" contains whitespace; use the exact fieldId from get-schema.`,
          { fieldId, index }
        ));
      }
      const normalizedFieldId = normalizeSubtableFieldId(fieldId);
      if (normalizedFieldId.changed) {
        const suggestion = normalizedFieldId.value;
        diagnostics.push(createDiagnostic(
          'error',
          'field_ref_subtable_prefix',
          `Field reference "#{${fieldId}}" uses a subtable prefix. Yida formulas reference subtable child fields by their plain fieldId, and get-schema/save store them without the "tableField_xxx." prefix. Use "#{${suggestion}}".`,
          { fieldId, suggestion, index }
        ));
      }
      refs.push({ fieldId, index });
    }

    index = end;
  }

  if (quote) {
    diagnostics.push(createDiagnostic(
      'error',
      'string_unclosed',
      `String literal is missing a closing ${quote}.`
    ));
  }

  return refs;
}

function checkParentheses(formula, diagnostics) {
  const stack = [];
  let maxDepth = 0;

  scanOutsideStrings(formula, (char, index) => {
    if (char === '(') {
      stack.push(index);
      maxDepth = Math.max(maxDepth, stack.length);
    } else if (char === ')') {
      if (stack.length === 0) {
        diagnostics.push(createDiagnostic(
          'error',
          'parenthesis_extra_close',
          'Closing parenthesis has no matching opening parenthesis.',
          { index }
        ));
      } else {
        stack.pop();
      }
    }
  });

  for (const index of stack) {
    diagnostics.push(createDiagnostic(
      'error',
      'parenthesis_unclosed',
      'Opening parenthesis has no matching closing parenthesis.',
      { index }
    ));
  }

  return maxDepth;
}

function collectFunctionCalls(formula) {
  const masked = maskIgnoredRanges(formula);
  const calls = [];
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match = pattern.exec(masked);

  while (match) {
    const name = match[1];
    const upperName = name.toUpperCase();
    const call = {
      name,
      normalizedName: upperName,
      index: match.index,
    };
    calls.push(call);

    match = pattern.exec(masked);
  }

  return calls;
}

function checkPunctuation(formula, diagnostics) {
  scanOutsideStrings(formula, (char, index) => {
    if (Object.prototype.hasOwnProperty.call(CHINESE_PUNCTUATION, char)) {
      diagnostics.push(createDiagnostic(
        'warning',
        'fullwidth_punctuation',
        `Full-width punctuation "${char}" may break formulas; use "${CHINESE_PUNCTUATION[char]}".`,
        { index, suggestion: CHINESE_PUNCTUATION[char] }
      ));
    } else if (char === ';') {
      diagnostics.push(createDiagnostic(
        'warning',
        'semicolon_argument_separator',
        'Yida formulas normally use commas between function arguments, not semicolons.',
        { index, suggestion: ',' }
      ));
    }
  });
}

function checkOperators(formula, diagnostics) {
  const masked = maskIgnoredRanges(formula);

  for (let index = 0; index < masked.length; index++) {
    const pair = masked.slice(index, index + 2);
    const twoCharOperator = COMPARISON_OPERATORS.find(entry => entry.token === pair);
    if (twoCharOperator) {
      diagnostics.push(createDiagnostic(
        'warning',
        'comparison_operator',
        `Direct comparison operator "${pair}" is risky in Yida formulas; use ${twoCharOperator.replacement}.`,
        { index, suggestion: twoCharOperator.replacement }
      ));
      index++;
      continue;
    }

    const char = masked[index];
    if (char === '>' || char === '<' || char === '=') {
      const operator = COMPARISON_OPERATORS.find(entry => entry.token === char);
      diagnostics.push(createDiagnostic(
        'warning',
        'comparison_operator',
        `Direct comparison operator "${char}" is risky in Yida formulas; use ${operator.replacement}.`,
        { index, suggestion: operator.replacement }
      ));
    } else if (char === '&' && masked[index + 1] === '&') {
      diagnostics.push(createDiagnostic(
        'warning',
        'logical_operator',
        'Use AND(a, b) instead of && in Yida formulas.',
        { index, suggestion: 'AND(left, right)' }
      ));
      index++;
    } else if (char === '|' && masked[index + 1] === '|') {
      diagnostics.push(createDiagnostic(
        'warning',
        'logical_operator',
        'Use OR(a, b) instead of || in Yida formulas.',
        { index, suggestion: 'OR(left, right)' }
      ));
      index++;
    }
  }
}

function checkSchemaFieldRefs(fieldRefs, schemaFieldIds, diagnostics) {
  if (!schemaFieldIds) {
    return;
  }

  for (const ref of fieldRefs) {
    if (!schemaFieldIds.has(ref.fieldId) && !(ref.fieldId.includes('.') && schemaFieldIds.has(ref.fieldId.split('.')[0]))) {
      diagnostics.push(createDiagnostic(
        'error',
        'field_ref_not_in_schema',
        `Field reference "#{${ref.fieldId}}" was not found in the provided schema.`,
        { fieldId: ref.fieldId, index: ref.index }
      ));
    }
  }
}

function analyzeFormula(formula, options = {}) {
  const diagnostics = [];
  const componentProfile = getComponentFormulaProfile(options.componentName);
  const normalized = String(formula || '').trim();
  const contract = selectContract(options);
  options = { ...options, context: contract.context };
  if (!contract.checker) {
    return { ok: false, verification: 'not_supported', contract, formula: normalized,
      diagnostics: [createDiagnostic('error', 'contract_not_supported', t('formula_v2.contract_not_supported', contract.id))],
      fieldRefs: [], functions: [], resultTypes: [],
      checks: { syntax: 'not_run', metadata: 'not_used', fields: 'not_run', signatures: 'not_run', types: 'not_run', context: 'not_run', platform: 'not_run', runtime: 'not_run' },
      metrics: { length: normalized.length, fieldRefCount: 0, uniqueFieldRefCount: 0, functionCallCount: 0, maxParenDepth: 0 } };
  }

  if (!normalized) {
    diagnostics.push(createDiagnostic('error', 'formula_empty', 'Formula is empty.'));
    return {
      ok: false,
      formula: normalized,
      diagnostics,
      fieldRefs: [],
      functions: [],
      metrics: {
        length: 0,
        fieldRefCount: 0,
        uniqueFieldRefCount: 0,
        functionCallCount: 0,
        maxParenDepth: 0,
      },
    };
  }

  checkPunctuation(normalized, diagnostics);
  checkOperators(normalized, diagnostics);
  const fieldRefs = collectFieldRefs(normalized, diagnostics);
  const functions = collectFunctionCalls(normalized, diagnostics);
  const maxParenDepth = checkParentheses(normalized, diagnostics);
  const schemaFieldIds = options.schemaFieldIds || null;
  if (options.context !== 'automation') { checkSchemaFieldRefs(fieldRefs, schemaFieldIds, diagnostics); }
  const syntax = checkSyntax(normalized, options);
  if (contract.id === 'node-expression') {
    diagnostics.push(...checkWorkflowValueUsage(normalized, options));
  }
  if (componentProfile) {
    for (const call of functions) {
      const canonical = componentProfile.allowedFunctions.find(name => name.toUpperCase() === call.name.toUpperCase());
      if (!canonical) {
        diagnostics.push(createDiagnostic('error', 'function_not_allowed_for_component',
          t('formula_profile.not_allowed', call.name, componentProfile.componentName),
          { functionName: call.name, componentName: componentProfile.componentName, index: call.index }));
      } else if (canonical !== call.name) {
        diagnostics.push(createDiagnostic('error', 'function_case_for_component',
          t('formula_profile.canonical_case', call.name, canonical),
          { functionName: call.name, suggestion: canonical, index: call.index }));
      }
    }
  }
  // The default-value editor allowlist does not establish signatures or types.
  // Preserve syntax/reference diagnostics while avoiding generic-menu conflicts.
  diagnostics.push(...syntax.diagnostics.filter(item => !componentProfile ||
    !['function_unknown', 'function_case', 'argument_count', 'argument_type', 'same_type',
      'function_context', 'context_unknown', 'target_unknown'].includes(item.code)));

  const uniqueFieldRefs = Array.from(new Set(fieldRefs.map(ref => ref.fieldId)));
  const metrics = {
    length: normalized.length,
    fieldRefCount: fieldRefs.length,
    uniqueFieldRefCount: uniqueFieldRefs.length,
    functionCallCount: functions.length,
    maxParenDepth,
  };

  if (metrics.length > 1000) {
    diagnostics.push(createDiagnostic(
      'warning',
      'formula_long',
      'Formula is longer than 1000 characters; consider splitting logic into helper fields.'
    ));
  }
  if (metrics.maxParenDepth > 10) {
    diagnostics.push(createDiagnostic(
      'warning',
      'formula_deep',
      'Formula nesting is deep; review readability and platform limits.'
    ));
  }
  if (metrics.functionCallCount > 30) {
    diagnostics.push(createDiagnostic(
      'warning',
      'formula_many_functions',
      'Formula has many function calls; consider simplifying before publishing.'
    ));
  }

  const hasError = (...codes) => diagnostics.some(item => item.level === 'error' && codes.includes(item.code));
  return {
    ok: diagnostics.every(item => item.level !== 'error'),
    verification: 'local-static',
    ...(componentProfile ? { componentProfile } : {}),
    contract,
    checks: { syntax: syntax.syntax, metadata: (options.metadata || builtin).source.kind,
      fields: hasError('field_missing', 'field_ref_not_in_schema', 'field_ref_subtable_prefix', 'reference_context') ? 'failed' : diagnostics.some(item => item.code === 'reference_details_unknown') ? 'unknown' : options.fields || schemaFieldIds ? 'passed' : 'unknown',
      signatures: hasError('argument_count', 'function_unknown', 'function_case', 'function_not_allowed_for_component', 'function_case_for_component') ? 'failed' : componentProfile ? 'not_run' : 'passed',
      types: hasError('argument_type', 'target_type', 'same_type', 'serialized_array_access') ? 'failed' : diagnostics.some(item => ['reference_details_unknown', 'function_unknown', 'target_branches', 'date_timestamp', 'numeric_result_text'].includes(item.code)) ? 'unknown' : syntax.resultTypes.length ? 'inferred' : 'unknown',
      context: hasError('function_context') ? 'failed' : diagnostics.some(item => item.code === 'context_unknown') ? 'unknown' : 'passed',
      consumerPreprocessing: 'not_run', platform: 'not_run', runtime: 'not_run' },
    availabilityBasis: 'bundled-function-menu; consumer flags and injected variables not verified',
    resultTypes: syntax.resultTypes,
    context: options.context || 'form',
    formula: normalized,
    diagnostics,
    fieldRefs: uniqueFieldRefs,
    functions: functions.map(call => call.name),
    metrics,
  };
}

function renderText(result) {
  const lines = [];
  const errors = result.diagnostics.filter(item => item.level === 'error');
  const warnings = result.diagnostics.filter(item => item.level === 'warning');

  lines.push('openyida formula evaluate - static check');
  lines.push(result.ok ? 'OK: ' + t('formula_v2.local_pass') : `ERROR: ${errors.length} blocking issue(s) found.`);
  lines.push(`Warnings: ${warnings.length}`);
  lines.push('');

  if (result.diagnostics.length > 0) {
    lines.push('Diagnostics:');
    result.diagnostics.forEach((item) => {
      const location = typeof item.index === 'number' ? ` @${item.index}` : '';
      lines.push(`  [${item.level}] ${item.code}${location}: ${item.message}`);
    });
    lines.push('');
  }

  lines.push('Metrics:');
  lines.push(`  length: ${result.metrics.length}`);
  lines.push(`  field refs: ${result.metrics.fieldRefCount} (${result.metrics.uniqueFieldRefCount} unique)`);
  lines.push(`  function calls: ${result.metrics.functionCallCount}`);
  lines.push(`  max parenthesis depth: ${result.metrics.maxParenDepth}`);

  if (result.fieldRefs.length > 0) {
    lines.push('');
    lines.push('Field refs:');
    result.fieldRefs.forEach(fieldId => lines.push(`  - ${fieldId}`));
  }

  return lines.join('\n');
}

async function run(args) {
  const parsed = parseArgs(args);

  if (parsed.help || !parsed.formulaInput) {
    console.log(usage());
    if (!parsed.help) {
      throwUsage('Missing formula input', usage());
    }
    return;
  }

  const formula = readFormulaInput(parsed.formulaInput);
  const schemaFieldIds = loadSchemaFieldIds(parsed.schemaPath);
  const fields = parsed.schemaPath ? collectFields(JSON.parse(fs.readFileSync(path.resolve(parsed.schemaPath), 'utf8'))) : null;
  const result = analyzeFormula(formula, { schemaFieldIds, fields, context: parsed.context, contract: parsed.contract,
    metadata: loadMetadata(parsed.metadataPath), targetType: parsed.targetType, componentName: parsed.componentName });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderText(result));
  }

  if (parsed.strict && !result.ok) {
    throwCommandError('Formula validation failed', { code: 'CLI_FORMULA_INVALID' });
  }
}

function collectComponentFormulaDiagnostics(schema) {
  const diagnostics = [];
  function visit(node) {
    if (!node || typeof node !== 'object') { return; }
    const props = node.props || {};
    if (node.componentName === 'EmployeeField' &&
      (props.valueType === 'formula' || props.complexValue?.complexType === 'formula')) {
      const formulas = new Set([props.formula, props.complexValue?.formula]
        .filter(value => typeof value === 'string' && value.trim()));
      for (const formula of formulas) {
        const checked = analyzeFormula(formula, { componentName: 'EmployeeField' });
        diagnostics.push(...checked.diagnostics.filter(item => item.level === 'error')
          .map(item => ({ ...item, fieldId: props.fieldId, componentName: node.componentName })));
      }
    }
    (node.children || []).forEach(visit);
  }
  (schema.pages || []).forEach(page => (page.componentsTree || []).forEach(visit));
  return diagnostics;
}

module.exports = {
  collectComponentFormulaDiagnostics,
  KNOWN_FUNCTIONS,
  analyzeFormula,
  collectSchemaFieldIds,
  normalizeFormulaFieldRefs,
  parseArgs,
  readFormulaInput,
  renderText,
  run,
  stripSubtableFieldPrefix,
};
