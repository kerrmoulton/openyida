'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');
const { flattenCommandManifest } = require('../lib/core/command-manifest');
const { assertManagedInvocation } = require('../lib/agent/managed-run');
const { classifyManagedMutation } = require('../lib/agent/managed-command-map');
const coolCard = require('../lib/app/cool-card');
const dataCard = require('../lib/app/data-card');
const settings = require('../lib/app/app-settings');
const index = require('../yida-skills/skills-index.json');
const { SKILL_COVERAGE } = require('../scripts/e2e-real/skill-coverage');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = flattenCommandManifest();
const entryFor = id => manifest.find(entry => entry.id === id);
const parsers = { 'cool-card': coolCard.parseArgs, 'data-card': dataCard.parseArgs, 'app-settings': settings.parseArgs };
const hash = 'a'.repeat(64);
// Independent executable examples for every action, including action-specific options.
const cases = {
  'cool-card': {
    list: ['--type', 'im', '--page', '2', '--size', '10', '--search', '订单'],
    templates: ['--type', 'onebox', '--page', '2', '--size', '10', '--search', '项目'],
    create: ['--type', 'im', '--name', '项目简报', '--out', 'snapshot.json'],
    get: ['form123', '--out', 'snapshot.json'],
  },
  'data-card': {
    list: ['--page', '2', '--size', '10', '--search', '项目', '--published'],
    create: ['--name', '项目简报', '--description', '经营分析', '--out', 'schema.json'],
    get: ['CARD-123', '--version', '2', '--out', 'schema.json'],
    save: ['CARD-123', '--schema', 'schema.json', '--expected-hash', hash, '--backup', 'backup.json'],
    publish: ['CARD-123', '--expected-hash', hash, '--backup', 'backup.json'],
    probe: ['CARD-123', '--published'],
    'release-get': ['CARD-123', '--out', 'release.json'],
    'release-save': ['CARD-123', '--config', 'release.json', '--expected-hash', hash, '--backup', 'backup.json', '--allow-send'],
    'release-check': ['CARD-123'],
    'release-test': ['CARD-123', '--config', 'release.json', '--allow-send'],
    refs: ['CARD-123', '--page', '2', '--size', '20'],
  },
};
const invoke = (argv, cwd = root) => spawnSync(process.execPath, [path.join(root, 'bin/yida.js'), ...argv], {
  cwd, encoding: 'utf8', timeout: 15000,
  env: { ...process.env, OPENYIDA_SKIP_UPDATE_CHECK: '1', OPENYIDA_MANAGED_RUN: '0' },
});
const skillFiles = name => {
  const base = `yida-skills/skills/${name}`;
  return [`${base}/SKILL.md`, ...fs.readdirSync(path.join(root, base, 'references'))
    .filter(file => file.endsWith('.md')).map(file => `${base}/references/${file}`)];
};

describe('native card CLI, Skill, tests and manifest alignment', () => {
  test.each(['zh', 'en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'vi', 'zh-HK'])('%s help options match the manifest', locale => {
    const pack = require(path.join(root, ['zh', 'en'].includes(locale) ? 'lib/core/locales' : 'locales-extra/core', locale));
    for (const [id, key] of [['cool-card', 'cool_card'], ['data-card', 'data_card'], ['app-settings', 'app_settings']]) {
      expect([...new Set(pack[key].usage.match(/--[a-z-]+/g))].sort())
        .toEqual([...new Set(entryFor(id).usage.match(/--[a-z-]+/g))].sort());
      for (const action of entryFor(id).args.find(arg => arg.name === 'action')?.choices || []) {
        expect(pack[key].usage).toContain(action);
      }
    }
  });

  test.each(Object.keys(parsers))('%s advertises every option through structured arguments', id => {
    const entry = entryFor(id);
    const flags = entry.args.filter(arg => arg.source === 'option').flatMap(arg => arg.builder_options);
    expect(flags.sort()).toEqual([...new Set(entry.usage.match(/--[a-z-]+/g))].sort());
    expect(entry.args.filter(arg => arg.required).map(arg => arg.name))
      .toEqual(id === 'app-settings' ? ['appType'] : ['action', 'appType']);
  });

  test.each(Object.keys(cases))('%s action examples parse and cover all advertised flags', id => {
    const entry = entryFor(id);
    expect(entry.args.find(arg => arg.name === 'action').choices.sort()).toEqual(Object.keys(cases[id]).sort());
    const seen = new Set(['--json']);
    for (const [action, flags] of Object.entries(cases[id])) {
      const argv = [action, 'APP_TEST', ...flags, '--json'];
      expect(parsers[id](argv)).toMatchObject({ action, appType: 'APP_TEST' });
      flags.filter(flag => flag.startsWith('--')).forEach(flag => seen.add(flag));
    }
    expect([...seen].sort()).toEqual(entry.args.filter(arg => arg.source === 'option').flatMap(arg => arg.builder_options).sort());
    expect(Object.keys(entry.managedRun.actions).sort()).toEqual(Object.keys(cases[id]).sort());
    expect([...entry.sideEffect.read_actions, ...entry.sideEffect.mutating_actions].sort()).toEqual(Object.keys(cases[id]).sort());
  });

  test.each(['yida-cool-card', 'yida-data-card'])('%s discovery, examples and coverage match executable commands', name => {
    const entry = index.skills.find(skill => skill.name === name);
    const skill = read(entry.path.replace(/^/, 'yida-skills/'));
    expect(entry.description).toBe(yaml.load(skill.split('---')[1]).description);
    for (const id of entry.command_ids) { expect(entryFor(id)).toBeDefined(); }
    expect(SKILL_COVERAGE[name].tests).toContain('tests/native-card-contract-alignment.test.js');
    for (const file of SKILL_COVERAGE[name].tests) { expect(fs.existsSync(path.join(root, file))).toBe(true); }
    const commands = skillFiles(name).flatMap(file => [...read(file).replace(/\\\n/g, ' ')
      .matchAll(/^openyida (cool-card|data-card|app-settings) (.+)$/gm)]);
    expect(commands.length).toBeGreaterThan(5);
    for (const [, id, text] of commands) {
      expect(entry.command_ids).toContain(id);
      const tokens = (text.match(/'[^']*'|"[^"]*"|\S+/g) || []).map(token => {
        if (/^['"]/.test(token)) { return token.slice(1, -1); }
        if (token.startsWith('<')) { return hash; }
        if (token.startsWith('form')) { return 'form123'; }
        return token;
      });
      for (const flag of tokens.filter(token => token.startsWith('--'))) {
        expect(entryFor(id).args.some(arg => arg.builder_options?.includes(flag))).toBe(true);
      }
      expect(() => parsers[id](tokens)).not.toThrow();
    }
  });

  test('all settings sections resolve through the same parser and manifest choices', () => {
    for (const section of entryFor('app-settings').args.find(arg => arg.name === 'section').choices) {
      expect(settings.parseArgs(['APP_TEST', '--section', section, '--json'])).toEqual({ appType: 'APP_TEST', section });
    }
    expect(() => settings.parseArgs(['APP_TEST', '--section', 'entitlements'])).toThrow();
  });

  test('unsupported cool-card save/publish/send and cross-resource IDs fail before remote execution', () => {
    expect(coolCard.capabilities).toMatchObject({ save: false, publish: false, send: false });
    for (const action of ['save', 'publish', 'send']) {
      expect(() => coolCard.parseArgs([action, 'APP_TEST', 'form123'])).toThrow();
      expect(entryFor('cool-card').managedRun.actions[action]).toBeUndefined();
    }
    expect(() => coolCard.parseArgs(['get', 'APP_TEST', 'CARD-123'])).toThrow();
    expect(() => dataCard.parseArgs(['get', 'APP_TEST', 'form123'])).toThrow();
    expect(() => dataCard.parseArgs(['release-test', 'APP_TEST', 'CARD-123'])).toThrow();
    expect(() => dataCard.parseArgs(['save', 'APP_TEST', 'CARD-123', '--config', 'c.json'])).toThrow();
  });

  test('manifest execution policies bind all supported actions to the selected app and forbid test sends', () => {
    const env = { OPENYIDA_MANAGED_RUN: '1', OPENYIDA_AGENT_APP_TYPE: 'APP_TEST',
      OPENYIDA_AGENT_CORP_ID: 'corp', OPENYIDA_AGENT_USER_ID: 'user', OPENYIDA_AGENT_RUN_ID: 'run',
      OPENYIDA_AGENT_ATTEMPT_ID: 'attempt', OPENYIDA_AGENT_BASE_URL: 'https://platform.example.test',
      OPENYIDA_AGENT_TASK_GRANT: 'test_' + 'g'.repeat(48) };
    for (const [id, actions] of Object.entries(cases)) {
      for (const [action, flags] of Object.entries(actions)) {
        const argv = [action, 'APP_TEST', ...flags, '--json'];
        if (action === 'release-test') {
          expect(() => assertManagedInvocation(id, argv, { env })).toThrow();
          continue;
        }
        expect(assertManagedInvocation(id, argv, { env })).toMatchObject({ appType: 'APP_TEST' });
        expect(() => assertManagedInvocation(id, argv.map(arg => arg === 'APP_TEST' ? 'APP_OTHER' : arg), { env })).toThrow();
        expect(!!classifyManagedMutation(id, argv)).toBe(entryFor(id).sideEffect.mutating_actions.includes(action));
      }
    }
  });

  test.each(Object.keys(parsers))('%s real CLI help is available without platform authentication', id => {
    const result = invoke([id, '--help']);
    expect(result.status).toBe(0);
    for (const flag of entryFor(id).usage.match(/--[a-z-]+/g)) { expect(result.stdout).toContain(flag); }
  });

  test('the documented cool-card sample command produces importable local JSON through the real CLI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-card-contract-'));
    try {
      const command = read('yida-skills/skills/yida-cool-card/references/design.md')
        .match(/^openyida sample yida-cool-card project-brief .+$/m)[0];
      const argv = command.split(/\s+/).slice(1);
      argv[argv.indexOf('--var') + 1] = 'APP_URL=https://tenant.aliwork.com/APP_TEST/workbench';
      const result = invoke(argv, dir);
      expect(result.status).toBe(0);
      const payload = JSON.parse(fs.readFileSync(path.join(dir, argv[argv.indexOf('--output') + 1]), 'utf8'));
      expect(payload.type).toBe('im');
      const editorData = JSON.parse(payload.editorData);
      expect(editorData.variableList.length).toBeGreaterThanOrEqual(10);
      expect(JSON.stringify(payload)).not.toContain('{{APP_URL}}');
      expect(JSON.stringify(payload)).toContain('https://tenant.aliwork.com/APP_TEST/workbench');
      expect(entryFor('sample').notes.join(' ')).toContain('yida-cool-card project-brief');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
