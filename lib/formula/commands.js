'use strict';

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { createAuthRef, createYidaClient } = require('../core/yida-client');
const { getFormSchema } = require('../integration/integration-api');
const { fetchMetadata, builtin, context, fail } = require('./metadata');
const { collectFields, bindNumericValues } = require('./syntax');
const { analyzeFormula, readFormulaInput } = require('./evaluate');
const { CONTRACTS } = require('./contracts');
const { evaluateField, indexFields, savedFormula, buildPlan } = require('./runtime');
const { t } = require('../core/i18n');
const { FORMULA_COMMANDS } = require('./cli-contract');

const optionTypes = new Map(Object.values(FORMULA_COMMANDS).flatMap(command => command.args)
  .filter(arg => arg.source === 'option').map(arg => [arg.name, arg.type]));

function parse(args) {
  const positions = [], flags = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) { positions.push(arg); continue; }
    const key = arg.slice(2);
    if (Object.hasOwn(flags, key)) { fail('duplicate ' + arg); }
    if (key === 'help' || optionTypes.get(key) === 'boolean') { flags[key] = true; }
    else if (optionTypes.has(key)
      && args[index + 1] && !args[index + 1].startsWith('--')) { flags[key] = args[++index]; }
    else { fail(arg); }
  }
  return { positions, flags };
}
async function run(action, args) {
  const { positions, flags } = parse(args);
  if (action === 'contracts') {
    if (positions.length || Object.keys(flags).some(key => !['json', 'help'].includes(key))) { fail('arguments'); }
    const output = { success: true, contracts: CONTRACTS, runtimeVerified: false };
    console.log(flags.json ? JSON.stringify(output, null, 2) : t('formula_v2.contracts_help'));
    return output;
  }
  if (!positions.length || flags.help) {
    console.log([t('cli.formula_usage'), ...Object.values(FORMULA_COMMANDS).map(command => '  openyida ' + command.usage)].join('\n'));
    return;
  }
  const [appType, formUuid, input] = positions;
  if (!['functions', 'types', 'inspect', 'test'].includes(action) || (action === 'test'
    ? ![2, 3].includes(positions.length) || (positions.length === 2 && !flags.field)
    : positions.length !== { functions: 1, types: 1, inspect: 2 }[action])) {
    fail('arguments');
  }
  const allowed = FORMULA_COMMANDS[action].args.filter(arg => arg.source === 'option').map(arg => arg.name);
  for (const key of Object.keys(flags)) { if (!allowed.includes(key)) { fail('--' + key); } }
  const selectedContext = context(flags.context);
  let output;
  if (action === 'types') {
    const { catalog } = await fetchMetadata(appType);
    if (flags.component && !Object.hasOwn(catalog.components, flags.component)) { fail('component: ' + flags.component); }
    output = { success: true, source: catalog.source, components: Object.entries(catalog.components)
      .filter(([name]) => !flags.component || name === flags.component)
      .map(([componentName, valueTypes]) => ({ componentName, valueTypes })), runtimeVerified: false };
  } else if (action === 'functions') {
    const { raw, catalog } = await fetchMetadata(appType);
    const names = Object.keys(catalog.functions).filter(name => !flags.name || name === flags.name);
    if (flags.name && !names.length) { fail('function: ' + flags.name); }
    const functions = names.map(name => ({ name, ...catalog.functions[name],
      contextAvailable: catalog.functions[name].contexts.length ? catalog.functions[name].contexts.includes(selectedContext) : null }));
    if (flags.output) {
      const file = path.resolve(flags.output);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // A metadata export is a new snapshot; never overwrite an arbitrary file.
      fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    }
    output = { success: true, context: selectedContext, source: catalog.source, functions,
      consumerAvailabilityVerified: false,
      supportQueryFuncs: catalog.supportQueryFuncs, outputPath: flags.output && path.resolve(flags.output) };
  } else {
    const authRef = createAuthRef();
    const fields = await getFormSchema(authRef, { appType, formUuid });
    const fieldIndex = indexFields(fields);
    const byId = new Map(fields.map(field => [field.props.fieldId, field]));
    if (flags.field && !byId.has(flags.field)) { fail('field: ' + flags.field); }
    if (action === 'inspect') {
      output = { success: true, appType, formUuid, fields: [...byId.values()]
        .filter(field => !flags.field || field.props.fieldId === flags.field)
        .map(field => ({ fieldId: field.props.fieldId, componentType: field.componentName,
          label: field.props.label, valueType: field.props.valueType,
          formula: field.props.complexValue?.formula || field.props.formula || '',
          complexValue: field.props.complexValue, validation: field.props.validation,
          tableFieldId: fieldIndex.get(field.props.fieldId)?.table || undefined,
          dependencies: savedFormula(field) ? analyzeFormula(savedFormula(field), { fields: collectFields(fields) }).fieldRefs : [],
        })), runtimeVerified: false };
    } else {
      if ((!flags['data-file'] && !flags.cases) || !['form', 'validation'].includes(selectedContext)) { fail('test requires --data-file or --cases and context form/validation'); }
      if (flags.cases && (!flags.field || flags['data-file'] || flags.expect !== undefined)) { fail('--cases requires --field; use each case data/expect instead of --data-file/--expect'); }
      const values = flags['data-file'] ? JSON.parse(fs.readFileSync(flags['data-file'], 'utf8')) : undefined;
      const expected = flags.expect === undefined ? undefined : JSON.parse(flags.expect);
      if (flags.field) {
        if (flags.binding || selectedContext !== 'form') { fail('--field uses native field binding and context form'); }
        const options = { appType, formUuid, schema: fields, values,
          fieldId: flags.field, formula: input === undefined ? undefined : readFormulaInput(input),
          metadata: (await fetchMetadata(appType)).catalog,
          timezoneOffset: flags['timezone-offset'] === undefined ? 480 : Number(flags['timezone-offset']), expected };
        if (flags.cases) {
          const cases = JSON.parse(fs.readFileSync(flags.cases, 'utf8'));
          if (!Array.isArray(cases) || !cases.length || cases.length > 100) { fail('cases: array with 1..100 samples'); }
          const names = new Set();
          for (const sample of cases) {
            if (!sample || typeof sample.name !== 'string' || !sample.name.trim() || names.has(sample.name)
              || !Object.hasOwn(sample, 'expect') || !Object.hasOwn(sample, 'data')
              || Object.keys(sample).some(key => !['name', 'data', 'expect'].includes(key))) { fail('case requires unique name, data and expect'); }
            names.add(sample.name);
            buildPlan(fields, sample.data, options.fieldId, options.formula, appType, options.metadata);
          }
          const results = [];
          for (const sample of cases) {
            try { results.push({ name: sample.name, ...await evaluateField(createYidaClient({ authRef }), { ...options, values: sample.data, expected: sample.expect }) }); }
            catch (error) { results.push({ name: sample.name, success: false, error: error.message }); }
          }
          output = { success: results.every(item => item.success), verification: 'field-runtime-cases', saved: false, runtimeVerified: false,
            summary: { total: results.length, passed: results.filter(item => item.success).length, failed: results.filter(item => !item.success).length }, results };
        } else { output = await evaluateField(createYidaClient({ authRef }), options); }
        console.log(JSON.stringify(output, null, 2));
        if (!output.success) { fail(output.diagnostics?.[0]?.message || t('formula_v2.expect_failed')); }
        return output;
      }
      if (flags['timezone-offset'] !== undefined) { fail('--timezone-offset requires --field'); }
      const binding = flags.binding || 'platform';
      if (!['platform', 'numeric-literals'].includes(binding)) { fail('--binding platform|numeric-literals'); }
      if (!values || typeof values !== 'object' || Array.isArray(values)) { fail('data object'); }
      const formula = readFormulaInput(input);
      const { catalog } = await fetchMetadata(appType);
      const result = analyzeFormula(formula, { context: selectedContext, fields: collectFields(fields), metadata: catalog });
      // The platform evaluator can execute business functions. Only a known
      // non-writing set is accepted here; changing a metadata file cannot widen it.
      const unsafe = result.functions.filter(name => !['pure', 'context-read'].includes(builtin.functions[name]?.effect));
      // These depend on preCompile and form/instance state. A raw endpoint
      // probe does not implement that consumer pipeline.
      const requiresConsumer = result.functions.filter(name => ['EXIST', 'EQUAL'].includes(name));
      if (!result.ok) { fail(result.diagnostics.filter(item => item.level === 'error').map(item => item.message).join('; ')); }
      if (unsafe.length) { fail(t('formula_v2.test_blocked', unsafe.join(', '))); }
      if (requiresConsumer.length) { fail(t('formula_v2.consumer_required', requiresConsumer.join(', '))); }
      for (const id of result.fieldRefs) { if (!Object.hasOwn(values, id)) { fail('missing data: ' + id); } }
      const expression = binding === 'numeric-literals' ? bindNumericValues(formula, values) : formula;
      const response = await createYidaClient({ authRef }).postFormOnce(
        `/alibaba/web/${encodeURIComponent(appType)}/query/expression/evaluate.json`,
        { expression, varMap: JSON.stringify(values), formUuid }
      );
      if (response?.success !== true) { fail(response?.errorMsg || 'platform evaluation failed'); }
      const value = response.content;
      output = { success: expected === undefined || isDeepStrictEqual(value, expected), value,
        valueType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value, expected,
        verification: 'expression-endpoint', binding, expression, saved: false, context: selectedContext,
        assertion: expected === undefined ? 'not_requested' : isDeepStrictEqual(value, expected) ? 'passed' : 'failed',
        runtimeVerified: false, checks: { endpoint: 'passed', consumerPreprocessing: 'not_run', targetConversion: 'not_run', runtime: 'not_run' } };
      console.log(JSON.stringify(output, null, 2));
      if (!output.success) { fail(t('formula_v2.expect_failed')); }
      return output;
    }
  }
  if (flags.json || action === 'inspect') { console.log(JSON.stringify(output, null, 2)); }
  else if (action === 'types') { console.log(output.components.map(item => item.componentName + ' — ' + item.valueTypes.join(', ')).join('\n')); }
  else { console.log(output.functions.map(fn => fn.name + ' — ' + fn.description).join('\n')); }
  return output;
}
module.exports = { run, parse };
