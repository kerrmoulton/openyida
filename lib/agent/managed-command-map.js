'use strict';

const { resolveManagedPolicy } = require('../core/managed-policy');

// Compatibility adapter for receipts and application checks. Scope and mutation
// metadata come from the same manifest consumed by the invocation guard.
function resolveManagedAppCommand(command, args = []) {
  if (args.includes('--help') || args.includes('-h')) {return null;}
  const selected = resolveManagedPolicy(command, args);
  if (selected?.policy.scope !== 'app') {return null;}
  const policy = selected.policy;
  let target;
  if (policy.appParser === 'prd-completeness') {
    const { parseArgs } = require('../app/check-prd-completeness');
    try {
      const parsed = parseArgs(args, { strict: true });
      if (!parsed.prdPath || !parsed.appType) {return null;}
      target = { appType: parsed.appType };
    } catch {return null;}
  } else if (policy.appOption) {
    const positions = args.flatMap((arg, index) => arg === policy.appOption ? [index] : []);
    if (positions.length !== 1 || !args[positions[0] + 1] || args[positions[0] + 1].startsWith('-')) {return null;}
    target = { appType: args[positions[0] + 1] };
  } else {
    if (policy.sourcePosition !== undefined && (!args[policy.sourcePosition] || /^APP_/i.test(args[policy.sourcePosition]) || args[policy.sourcePosition].startsWith('-'))) {return null;}
    target = { appPosition: policy.appPosition };
  }
  const mutation = policy.mutation;
  return { ...target, ...(mutation ? { operation: mutation.operation,
    ...(mutation.formUuidPosition !== undefined ? { formUuid: values => values[mutation.formUuidPosition] }
      : mutation.formUuidOption ? { formUuid: values => {
        const positions = values.flatMap((value, index) => value === mutation.formUuidOption ? [index] : []);
        return positions.length === 1 && values[positions[0] + 1] && !values[positions[0] + 1].startsWith('-')
          ? values[positions[0] + 1] : undefined;
      } } : {}) } : {}) };
}

function classifyManagedMutation(command, args = []) {
  const entry = resolveManagedAppCommand(command, args);
  const policy = resolveManagedPolicy(command, args)?.policy;
  if (policy?.mutation?.requiredFlags?.some(flag => !args.includes(flag)) || policy?.mutation?.forbiddenFlags?.some(flag => args.includes(flag))) {return null;}
  return entry?.operation
    ? { operation: entry.operation, ...(entry.formUuid ? { formUuid: entry.formUuid(args) } : {}) }
    : null;
}

module.exports = { resolveManagedAppCommand, classifyManagedMutation };
