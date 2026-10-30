'use strict';

const { CliError } = require('../core/cli-error');
const { createAuthRef } = require('../core/yida-client');
const { t } = require('../core/i18n');
const { inspectProcessFields } = require('./services/process-form-fields');

/** Inspect the field source used by the process designer; performs no remote writes. */
async function run(args) {
  const usage = 'openyida process fields <appType> <formUuid> [--json]';
  if (args.includes('--help') || args.includes('-h')) { console.log(usage); return; }
  if (!args[0] || !args[1] || args.slice(0, 2).some(arg => arg.startsWith('-'))
    || args.slice(2).some(arg => arg !== '--json')) {
    throw new CliError(usage, { code: 'PROCESS_FIELDS_INVALID_ARGUMENTS' });
  }
  const output = await inspectProcessFields(createAuthRef(), { appType: args[0], formUuid: args[1] });
  output.message = t('process_errors.fields_verified');
  console.log(JSON.stringify(output, null, 2));
  return output;
}

module.exports = { run };
