'use strict';

// Shared by command discovery, help and the platform-command parser.
const option = (name, type = 'string', description, aliases = []) => ({
  name, type, source: 'option', builder_options: ['--' + name, ...aliases],
  ...(description ? { description } : {}),
});
const positional = (name, position, required = true) => ({ name, type: 'string', source: 'positional', position, required });
const json = option('json', 'boolean');
const app = positional('appType', 0);
const form = positional('formUuid', 1);
const field = option('field', 'string', 'Use props.fieldId from the current form Schema, not the component tree id.');
const contexts = 'form|validation|automation|business';
const checkOptions = '[--component EmployeeField] [--schema file] [--contract field-value|validation-rule|business-action|node-expression] [--context ' + contexts + '] [--target-type NumberField] [--metadata file] [--strict] [--json]';
const checkArgs = [positional('formula', 0),
  option('component', 'string', 'Apply the verified default-value editor allowlist for EmployeeField.'),
  option('schema', 'file', 'Current form Schema used to check real field IDs and types.', ['-s']),
  option('contract', 'string', 'Formula storage format. Dataset expressions and JavaScript are recognized but not checked.'),
  option('context', 'string', contexts), option('target-type', 'string', 'Target componentName, such as NumberField.'),
  option('metadata', 'file', 'Snapshot exported by formula functions --output; uses the exact function names and signatures.'),
  option('strict', 'boolean', 'Exit with an error when static checks fail.'), json];

const FORMULA_COMMANDS = {
  evaluate: { usage: 'formula evaluate <formula|file> ' + checkOptions, args: checkArgs,
    notes: ['Compatibility name for formula check; static checks do not execute formulas.'] },
  check: { usage: 'formula check <formula|file> ' + checkOptions, args: checkArgs,
    notes: ['Static checks only; use --strict for a failing exit code. Function names are case-sensitive.'] },
  contracts: { usage: 'formula contracts [--json]', args: [json] },
  functions: { usage: 'formula functions <appType> [--name IF] [--context ' + contexts + '] [--output file] [--json]',
    args: [app, option('name', 'string', 'Exact formula function name, including case.'), option('context', 'string', contexts),
      option('output', 'file', 'Create a complete metadata snapshot; an existing file is never overwritten.'), json] },
  types: { usage: 'formula types <appType> [--component NumberField] [--json]',
    args: [app, option('component', 'string', 'Exact componentName from platform metadata.'), json] },
  inspect: { usage: 'formula inspect <appType> <formUuid> [--field fieldId] [--json]', args: [app, form, field, json] },
  test: { usage: 'formula test <appType> <formUuid> [formula|file] [--data-file file | --cases file] [--field fieldId] [--timezone-offset minutes] [--context form|validation] [--binding platform|numeric-literals] [--expect JSON] [--json]',
    args: [app, form, positional('formula', 2, false), field,
      option('data-file', 'file', 'Sample input object. Required unless --cases is supplied.'),
      option('cases', 'file', 'With --field: 1..100 samples with unique name, data and expect. Excludes --data-file and --expect.'),
      option('timezone-offset', 'number', 'With --field only: integer minutes from -840 to 840; default 480.'),
      option('context', 'string', 'form (default) or validation; --field requires form.'),
      option('binding', 'string', 'Without --field only: platform (default) or numeric-literals.'),
      option('expect', 'string', 'JSON expected result; comparison preserves the result type.'), json],
    notes: ['With --field, reads the saved formula or tests a candidate. Without --field, a formula is required and only the expression endpoint is checked.',
      'Sample evaluation does not save formulas or submit records. Widget rendering and submission still need separate verification.'] },
};

module.exports = { FORMULA_COMMANDS };
