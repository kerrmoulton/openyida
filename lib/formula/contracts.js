'use strict';

const { context, fail } = require('./metadata');

// A contract describes the value being configured, not the page hosting it.
// The same contract can be used by several designers. Legacy --context names
// remain aliases for the corresponding function menu/reference convention.
const CONTRACTS = {
  'field-value': { context: 'form', format: 'formula string + valueType/complexValue', references: '#{fieldId}', checker: 'expression' },
  'validation-rule': { context: 'validation', format: 'source + precompiled rule/content + message/block', references: '#{fieldId}', checker: 'expression' },
  'business-action': { context: 'business', format: 'source + precompiled rule/content', references: 'consumer-supplied form/field tokens', checker: 'expression' },
  'node-expression': { context: 'automation', format: 'value + __source + __display', references: 'editor #{node//field}; runtime ${node}.field or #{node}.field', checker: 'expression' },
  'dataset-expression': { format: 'fieldDefinition.expression + dataType/aggregateType', references: 'dataset/cube identifiers', checker: null },
  javascript: { format: 'JavaScript expression or callback source', references: 'callback arguments/page API', checker: null },
};

function selectContract(options = {}) {
  const selectedContext = options.context === undefined ? undefined : context(options.context);
  const id = options.contract || Object.keys(CONTRACTS).find(key => CONTRACTS[key].context === (selectedContext || 'form'));
  const definition = CONTRACTS[id];
  if (!definition) { fail('contract: ' + Object.keys(CONTRACTS).join(', ')); }
  if (selectedContext && definition.context !== selectedContext) { fail('--contract / --context'); }
  return { id, ...definition };
}

module.exports = { CONTRACTS, selectContract };
