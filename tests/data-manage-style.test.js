'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, buildStylesheet, generate } = require('../lib/style/data-manage-style');
const { presets } = require('../lib/style/native-data-manage');
const { flattenCommandManifest } = require('../lib/core/command-manifest');
const { resolveManagedPolicy } = require('../lib/core/managed-policy');
const base = ':root { --color-brand1-6:#5168D9; }\n/* existing theme */\n.keep { color: red; }\n';
const config = { app: 'APP_TEST', form: 'FORM-TEST', style: 'horizontal', fieldIds: ['textField_actual'], focus: 'balanced' };

test.each(presets)('generates scoped $id without changing virtual row geometry', preset => {
  const css = buildStylesheet(base, { ...config, style: preset.id });
  expect(css.startsWith(base)).toBe(true);
  expect(css).toContain('[data-formuuid="FORM-TEST"]');
  expect(css).toContain('[data-field-id="textField_actual"]');
  const added = css.slice(base.length);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const paint = selector => rules.filter(([, selectors]) => selectors.includes(selector))
    .flatMap(([, , body]) => [...body.matchAll(/(?:^|;)\s*background:([^;]+)/g)].map(match => match[1].trim())).pop();
  // The action pane covers header coordinates: an opaque wrapper hides even a
  // correctly themed placeholder. Both cases reproduced on the native table.
  expect(paint('#newDataManageTable .right-fixed-pane')).toBe('transparent !important');
  expect(paint('#newDataManageTable .leftHeaderPane ~ div')).toBe(paint('#newDataManageTable [data-role="header-cell"][data-column-key]'));

  // Every selector starts with the form manager or an explicit selected-nav guard.
  for (const rule of added.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(selector.startsWith(':is(body:has(')).toBe(true);
  }
  expect(added).not.toMatch(/(?:^|[;\n])\s*(?:height|top|transform|position)\s*:/);
  expect(added).not.toContain('body {');
  expect(added).not.toContain('--pod-nav-l-container-bg');
});

test('regeneration is idempotent and preserves other forms and byte suffixes', () => {
  const first = buildStylesheet(base, config);
  expect(buildStylesheet(first, config)).toBe(first);
  const second = buildStylesheet(first, { ...config, form: 'FORM-OTHER', style: 'rose' });
  const changed = buildStylesheet(second, { ...config, style: 'dark-header' });
  const other = '/* openyida-data-manage:APP_TEST:FORM-OTHER:start */';
  expect(changed.slice(changed.indexOf(other))).toBe(second.slice(second.indexOf(other)));
  expect(changed.match(/APP_TEST:FORM-TEST:start/g)).toHaveLength(1);
});

test('dark header owns inner label tokens and checkbox contrast; rose has no nested capsule', () => {
  const dark = buildStylesheet(base, { ...config, style: 'dark-header' });
  expect(dark).toContain('--color-text1-4:#EAF0FC');
  expect(dark).toContain('--color-text1-10:#EAF0FC');
  expect(dark).toContain('input[type="checkbox"]:not(:checked) + span');
  expect(dark).toContain('--lab-native-tab-border:none');
  const rose = buildStylesheet(base, { ...config, style: 'rose' });
  expect(rose).toContain('--lab-native-left-border:none');
  expect(rose).toContain('--lab-native-left-shadow:none');
  expect(rose).toContain('--lab-native-control-radius:10px');
});

test('actions and shell options are explicit and retain dangerous-action semantics', () => {
  const css = buildStylesheet(base, { ...config, focus: 'actions', followShell: true });
  expect(css).toContain('text-underline-offset:3px');
  expect(css).toContain('.next-btn-primary:not(.next-btn-text):not([disabled])');
  expect(css).toContain('--pod-nav-l-container-bg');
  expect(css).not.toMatch(/\.notable-yida-action-column-btns\s*\{[^}]*background:/);
  expect(css).not.toContain('display:none');
});

test('nav-free fallback is omitted when no real field evidence is supplied', () => {
  const css = buildStylesheet(base, { ...config, fieldIds: [] });
  expect(css).not.toContain(':is()');
  expect(css).not.toContain('.vc-yida-form-manage:has(');
  expect(css).toContain('body:has(.next-selected[data-formuuid="FORM-TEST"])');
});

test.each([
  { form: 'FORM-X"]{}body{' }, { app: 'https://elsewhere' }, { style: 'olive-register' },
  { fieldIds: ['x"]body{}'] }, { fieldIds: ['textField_x', 'textField_x'] }, { focus: 'delete' },
])('rejects unsafe or unsupported options %j', patch => {
  expect(() => buildStylesheet(base, { ...config, ...patch })).toThrow();
});

test('malformed markers and absent base theme fail before writing', () => {
  expect(() => buildStylesheet(base + '/* openyida-data-manage:APP_TEST:FORM-TEST:start */', config)).toThrow();
  expect(() => buildStylesheet('', config)).toThrow();
  expect(() => parseArgs(['list', '--follow-shell'])).toThrow();
  expect(() => parseArgs(['generate', '--unknown'])).toThrow();
});

test('CLI generates a new file offline, never overwrites base/output, returns truthful evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-style-'));
  try {
    const input = path.join(dir, 'base.css'), output = path.join(dir, 'new.css');
    fs.writeFileSync(input, base);
    const args = ['generate', '--app', config.app, '--form', config.form, '--style', config.style, '--base-css', input, '--output', output, '--json'];
    const parsed = parseArgs(args);
    const result = generate(parsed);
    expect(result).toMatchObject({ published: false, runtimeVerified: false, navFreeSupported: false });
    expect(fs.readFileSync(input, 'utf8')).toBe(base);
    expect(() => generate(parsed)).toThrow();
    expect(() => generate({ ...parsed, output: input })).toThrow();
    const run = spawnSync(process.execPath, [path.join(__dirname, '../bin/yida.js'), 'data-manage-style', 'list', '--json'], { encoding: 'utf8', env: { ...process.env, OPENYIDA_AUTO_UPDATE: '0' } });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).styles).toHaveLength(24);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('manifest, managed scope and independent skill expose authoring plus optional recipe commands', () => {
  const commands = flattenCommandManifest().filter(c => c.id.startsWith('data-manage-style.'));
  expect(commands.map(c => c.id)).toEqual(['data-manage-style.guide', 'data-manage-style.list', 'data-manage-style.generate']);
  expect(commands.every(c => c.requiresLogin === false)).toBe(true);
  for (const command of commands) {
    expect(command.managedRun.scope).toBe('local');
    expect(command.sideEffect.mutates_yida).toBe(false);
  }
  expect(resolveManagedPolicy('data-manage-style', ['unknown'])).toBeNull();
  const index = require('../yida-skills/skills-index.json').skills.find(s => s.name === 'yida-data-manage-ui');
  expect(index.command_ids).toEqual(expect.arrayContaining(commands.map(c => c.id)));
  expect(index.positive_signals).toContain('针对当前数据管理页换一种风格');
  const skill = fs.readFileSync(path.join(__dirname, '..', 'yida-skills', index.path), 'utf8');
  expect(skill).toContain('--focus actions');
});

test('guide works offline without a style ID or creating files and advertises scoped authoring', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-ui-guide-'));
  try {
    const run = spawnSync(process.execPath, [path.join(__dirname, '../bin/yida.js'), 'data-manage-style', 'guide', '--json'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, OPENYIDA_AUTO_UPDATE: '0' },
    });
    expect(run.status).toBe(0);
    const guide = JSON.parse(run.stdout);
    expect(guide).toMatchObject({ mode: 'composable-css', presetRequired: false, runtimeVerified: false, published: false });
    expect(guide.tokenGroups.header).toContain('--table-header-bg');
    expect(guide.cssTargets.cell).toContain('[data-field-id]');
    expect(guide.preserve).toContain('virtual-grid-geometry');
    expect(guide).not.toHaveProperty('styles');
    expect(fs.existsSync(path.join(__dirname, '..', guide.reference))).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(resolveManagedPolicy('data-manage-style', ['guide', '--json']).policy.scope).toBe('local');
    expect(() => parseArgs(['guide', '--style', 'rose'])).toThrow();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test.each(presets)('column emphasis follows $id and preserves geometry without a side line', preset => {
  const css = buildStylesheet(base, { ...config, style: preset.id, fieldIds: [],
    emphasizeFields: ['textField_name', 'numberField_amount'], tagFields: ['selectField_status'] });
  expect(css.startsWith(base)).toBe(true);
  expect(css).toContain('[data-column-key="textField_name"]');
  expect(css).toContain('[data-column-key="numberField_amount"]');
  expect(css).toContain('[data-field-id="selectField_status"] [data-componentname="SelectField"]');
  const normal = css.match(/[^{}]* \.DataCellWrapper\[data-field-id="textField_name"\]\[role="gridcell"\] \{([^}]+)\}/)[1];
  expect(normal).toContain('font-weight:600 !important');
  expect(normal).not.toMatch(/box-shadow|border-left|height:|width:|padding:|transform:|top:/);
  expect(css).toContain('[data-in-selected-area="true"]');
  const emphasis = css.slice(css.indexOf('font-weight:700 !important'));
  expect(emphasis).not.toContain('inset 3px');
});

test('repeatable column args normalize nav-free evidence and round-trip regeneration', () => {
  const p = parseArgs(['generate', '--app', config.app, '--form', config.form, '--style', 'rose',
    '--base-css', 'base.css', '--output', 'new.css', '--emphasize-field', 'textField_name',
    '--emphasize-field', 'numberField_amount', '--tag-field', 'selectField_status']);
  expect(p.emphasizeFields).toEqual(['textField_name', 'numberField_amount']);
  expect(p.fieldIds).toEqual(['textField_name', 'numberField_amount', 'selectField_status']);
  const emphasized = buildStylesheet(base, p);
  expect(buildStylesheet(emphasized, p)).toBe(emphasized);
  const plain = { ...config, style: 'rose', fieldIds: p.fieldIds };
  expect(buildStylesheet(emphasized, plain)).toBe(buildStylesheet(base, plain));
  const withOther = buildStylesheet(emphasized, { ...config, form: 'FORM-OTHER' });
  const stripped = buildStylesheet(withOther, plain);
  const marker = '/* openyida-data-manage:APP_TEST:FORM-OTHER:start */';
  expect(stripped.slice(stripped.indexOf(marker))).toBe(withOther.slice(withOther.indexOf(marker)));
});

test.each([
  { emphasizeFields: ['x"]{}body{'] }, { tagFields: ['selectField_x"]{}body{'] },
  { emphasizeFields: ['textField_x', 'textField_x'] }, { tagFields: ['textField_name'] },
  { emphasizeFields: ['selectField_status'], tagFields: ['selectField_status'] },
])('rejects unsafe or conflicting column configuration %j', columns => {
  expect(() => buildStylesheet(base, { ...config, ...columns })).toThrow();
});

test('CLI publishes column metadata offline and manifest allows both repeatable flags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'column-style-'));
  try {
    const input = path.join(dir, 'base.css'), output = path.join(dir, 'column.css');
    fs.writeFileSync(input, base);
    const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/yida.js'), 'data-manage-style', 'generate',
      '--app', config.app, '--form', config.form, '--style', 'rose', '--base-css', input, '--output', output,
      '--emphasize-field', 'textField_name', '--tag-field', 'selectField_status', '--json'],
    { encoding: 'utf8', env: { ...process.env, OPENYIDA_AUTO_UPDATE: '0' } });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ emphasizeFields: ['textField_name'], tagFields: ['selectField_status'],
      navFreeSupported: true, published: false, runtimeVerified: false });
    expect(fs.readFileSync(input, 'utf8')).toBe(base);
    const command = flattenCommandManifest().find(c => c.id === 'data-manage-style.generate');
    for (const flag of ['--emphasize-field', '--tag-field']) {
      expect(command.args.find(arg => arg.builder_options.includes(flag)).repeatable).toBe(true);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
