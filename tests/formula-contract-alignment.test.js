'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { flattenCommandManifest } = require('../lib/core/command-manifest');
const { assertManagedInvocation } = require('../lib/agent/managed-run');
const { classifyManagedMutation } = require('../lib/agent/managed-command-map');
const { parse } = require('../lib/formula/commands');
const { parseArgs, analyzeFormula } = require('../lib/formula/evaluate');
const { collectFields } = require('../lib/formula/syntax');
const { formulaFields } = require('../lib/formula/config');
const createForm = require('../lib/app/create-form')._private;
const { buildSpecProcessAndViewJson } = require('../lib/integration/integration-spec-builder');
const skillIndex = require('../yida-skills/skills-index.json');
const { SKILL_COVERAGE } = require('../scripts/e2e-real/skill-coverage');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = flattenCommandManifest().filter(command => command.command === 'formula');
const skillNames = ['yida-formula', 'yida-formula-evaluate'];
const skillFiles = skillNames.flatMap(name => {
  const base = 'yida-skills/skills/' + name;
  const references = path.join(root, base, 'references');
  return [base + '/SKILL.md', ...(fs.existsSync(references) ? fs.readdirSync(references, { withFileTypes: true }) : [])
    .filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => base + '/references/' + entry.name)];
});

describe('formula CLI, Skill and manifest alignment', () => {
  test.each(skillNames)('%s discovery matches its description, documented commands and executable coverage', name => {
    const skill = read('yida-skills/skills/' + name + '/SKILL.md');
    const header = yaml.load(skill.split('---')[1]);
    const entry = skillIndex.skills.find(item => item.name === name);
    expect(entry.description).toBe(header.description);
    const commandIds = [...new Set([...skill.matchAll(/(?:openyida )?formula (check|evaluate|contracts|functions|types|inspect|test)\b/g)]
      .map(match => 'formula.' + match[1]))];
    expect(commandIds.length).toBeGreaterThanOrEqual(6);
    expect(entry.command_ids).toEqual(expect.arrayContaining(commandIds));
    for (const id of entry.command_ids) { expect(manifest.find(command => command.id === id)).toBeDefined(); }
    for (const testFile of SKILL_COVERAGE[name].tests) { expect(fs.existsSync(path.join(root, testFile))).toBe(true); }
  });

  test('all advertised options have structured arguments that the actual parser accepts', () => {
    expect(manifest).toHaveLength(7);
    for (const entry of manifest) {
      const options = entry.args.filter(arg => arg.source === 'option');
      const usageOptions = [...entry.usage.matchAll(/--[a-z-]+/g)].map(match => match[0]);
      expect(options.map(arg => arg.builder_options[0]).sort()).toEqual([...new Set(usageOptions)].sort());
      for (const arg of options) {
        const value = arg.type === 'boolean' ? [] : ['sample'];
        const argv = [arg.builder_options[0], ...value];
        if (['formula.check', 'formula.evaluate'].includes(entry.id)) { expect(() => parseArgs(['1', ...argv])).not.toThrow(); }
        else { expect(parse(argv).flags[arg.name]).toBe(value[0] || true); }
      }
    }
  });

  test.each(skillFiles)('the commands in %s use supported options and required positional inputs', file => {
    const commands = [...read(file).replace(/\\\n/g, ' ').matchAll(/^openyida formula (\w+) (.+)$/gm)];
    for (const [, action, text] of commands) {
      const entry = manifest.find(command => command.id === 'formula.' + action);
      expect(entry).toBeDefined();
      const tokens = (text.match(/'[^']*'|"[^"\\]*(?:\\.[^"\\]*)*"|\S+/g) || [])
        .map(token => /^['"]/.test(token) ? token.slice(1, -1) : token);
      const flags = tokens.filter(token => token.startsWith('--'));
      for (const flag of flags) { expect(entry.args.some(arg => arg.builder_options?.includes(flag))).toBe(true); }
      if (['check', 'evaluate'].includes(action)) { expect(parseArgs(tokens).formulaInput).not.toBe(''); }
      else {
        const parsed = parse(tokens);
        expect(parsed.positions.length).toBeGreaterThanOrEqual(entry.args.filter(arg => arg.required).length);
      }
    }
  });

  test('read-only formula operations stay bound to the selected application in managed runs', () => {
    const env = { OPENYIDA_MANAGED_RUN: '1', OPENYIDA_AGENT_APP_TYPE: 'APP_BOUND',
      OPENYIDA_AGENT_CORP_ID: 'test-corp', OPENYIDA_AGENT_USER_ID: 'test-user',
      OPENYIDA_AGENT_RUN_ID: 'test-run', OPENYIDA_AGENT_ATTEMPT_ID: 'test-attempt',
      OPENYIDA_AGENT_BASE_URL: 'https://platform.example.test', OPENYIDA_AGENT_TASK_GRANT: 'task_' + 'g'.repeat(48) };
    for (const action of ['functions', 'types', 'inspect', 'test']) {
      const args = [action, 'APP_BOUND', ...(['inspect', 'test'].includes(action) ? ['FORM_TEST'] : [])];
      expect(assertManagedInvocation('formula', args, { env })).toMatchObject({ appType: 'APP_BOUND' });
      expect(classifyManagedMutation('formula', args)).toBeNull();
      expect(() => assertManagedInvocation('formula', args.map(arg => arg === 'APP_BOUND' ? 'APP_OTHER' : arg), { env }))
        .toThrow(expect.objectContaining({ code: 'MANAGED_APP_MISMATCH' }));
    }
  });
});

describe('documented nested formulas and real CLI dispatch', () => {
  const fields = [
    ['numberField_score', 'NumberField'], ['numberField_amount', 'NumberField'], ['numberField_qty', 'NumberField'],
    ['textField_type', 'TextField'], ['textareaField_reason', 'TextareaField'], ['textField_grade', 'TextField'],
    ['textField_review', 'TextField'], ['numberField_unitPrice', 'NumberField'],
  ].map(([fieldId, componentName]) => ({ componentName, id: 'tree-' + fieldId, props: { fieldId } }));

  test('complete IF, AND/OR/NOT and safe-division examples check and persist without losing field settings', () => {
    const doc = read('yida-skills/skills/yida-formula/references/nested-examples.md');
    const changes = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]))
      .flat().filter(item => item.action === 'update');
    expect(changes).toHaveLength(3);
    const formFields = JSON.parse(JSON.stringify(fields));
    const schema = { pages: [{ componentsTree: [{ componentName: 'FormContainer', children: formFields }] }] };
    for (const change of changes) {
      const targetType = fields.find(field => field.props.fieldId === change.fieldId).componentName;
      const result = analyzeFormula(change.changes.formula, { fields: collectFields(schema), targetType });
      expect(result.diagnostics.filter(item => item.level === 'error')).toEqual([]);
      expect(result.ok).toBe(true);
    }
    createForm.applyChangesToSchema(schema, changes);
    for (const change of changes) {
      expect(formulaFields(schema).get(change.fieldId).formula).toBe(change.changes.formula);
      const field = formFields.find(item => item.props.fieldId === change.fieldId);
      expect(field.props).toMatchObject({ ...change.changes, valueType: 'formula', complexValue: { complexType: 'formula', formula: change.changes.formula } });
      expect(field.id).toBe('tree-' + change.fieldId);
    }
    const before = JSON.stringify(schema);
    const applied = createForm.applyChangesToSchema(schema, [{ ...changes[0], fieldId: 'invented-field' }]);
    expect(applied).toHaveLength(0);
    expect(applied.diagnostics).toContainEqual(expect.objectContaining({ code: 'CREATE_FORM_FIELD_ID_NOT_FOUND' }));
    expect(JSON.stringify(schema)).toBe(before);
  });

  test('complete filter and nested branch examples compile both execution references and editor tokens', () => {
    const doc = read('yida-skills/skills/yida-formula/references/node-examples.md');
    const specs = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
    expect(specs).toHaveLength(2);
    for (const spec of specs) {
      const built = buildSpecProcessAndViewJson({ spec, processCode: 'LPROC-TEST', appType: 'APP_TEST', formUuid: 'FORM_TEST', flowName: 'Skill example' });
      const processText = JSON.stringify(built.processJson);
      const viewText = JSON.stringify(built.viewJson);
      expect(built.nodeIdMap.self).toBeDefined();
      expect(processText).toContain('${' + built.nodeIdMap.self + '}');
      expect(viewText).toContain('#{' + built.nodeIdMap.self + '//');
      expect(processText).not.toContain('${self}');
      expect(viewText).not.toContain('#{self//');
      const displays = [];
      const visit = value => {
        if (!value || typeof value !== 'object') { return; }
        if (value.__display) { displays.push(value.__display); }
        Object.values(value).forEach(visit);
      };
      visit(spec);
      expect(displays.length).toBeGreaterThan(0);
      for (const display of displays) { expect(viewText).toContain(display); }
    }
  });

  test.each(['check', 'evaluate'])('%s dispatch honors schema, metadata, target type, JSON and strict exit status', action => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'formula-cli-contract-'));
    try {
      const schemaFile = path.join(directory, 'schema.json');
      const metadataFile = path.join(directory, 'metadata.json');
      fs.writeFileSync(schemaFile, JSON.stringify(fields));
      // Platform metadata includes just this one exact function name.
      fs.writeFileSync(metadataFile, JSON.stringify({ expressionMapping: { ROUND: {
        inputs: { requiredParams: [{ baseType: ['number'] }, { baseType: ['number'] }] }, outputs: { baseType: ['number'] },
      } }, componentMapping: { NumberField: { type: ['number'] } } }));
      const invoke = formula => spawnSync(process.execPath, [path.join(root, 'bin/yida.js'), 'formula', action, formula,
        '--schema', schemaFile, '--metadata', metadataFile, '--contract', 'field-value', '--context', 'form',
        '--target-type', 'NumberField', '--strict', '--json'],
      { encoding: 'utf8', env: { ...process.env, OPENYIDA_SKIP_UPDATE_CHECK: '1', OPENYIDA_MANAGED_RUN: '0' } });
      const good = invoke('ROUND(#{numberField_amount},2)');
      expect(good.status).toBe(0);
      expect(JSON.parse(good.stdout)).toMatchObject({ ok: true, formula: 'ROUND(#{numberField_amount},2)', checks: { platform: 'not_run' } });
      for (const [formula, code] of [
        ['round(1,2)', 'function_case'], ['MYROUND(1,2)', 'function_unknown'],
        ['SUM(1,2)', 'function_unknown'], ['ROUND(#{tree-numberField_amount},2)', 'field_missing'],
      ]) {
        const bad = invoke(formula);
        expect(bad.status).not.toBe(0);
        expect(JSON.parse(bad.stdout).diagnostics).toContainEqual(expect.objectContaining({ level: 'error', code }));
      }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  test('help and contracts work through the real CLI without login or remote evaluation', () => {
    const invoke = args => spawnSync(process.execPath, [path.join(root, 'bin/yida.js'), 'formula', ...args],
      { encoding: 'utf8', env: { ...process.env, OPENYIDA_SKIP_UPDATE_CHECK: '1', OPENYIDA_MANAGED_RUN: '0' } });
    const result = invoke(['contracts', '--json']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ success: true, runtimeVerified: false });
    const help = invoke(['test', '--help']);
    expect(help.status).toBe(0);
    for (const command of manifest) { expect(help.stdout).toContain(command.usage); }
  });
});
