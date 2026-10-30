'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepareThemeSelector } = require('../lib/core/theme-widget');
const { run } = require('../lib/core/sample');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'yida-skills/skills/yida-design/templates/theme-selector.html'));
let temp;
beforeEach(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-widget-')); });
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(temp, { recursive: true, force: true }); });
function options(subtype, env = {}) {
  return { homeDir: temp, cwd: temp, projectRoot: temp, env,
    activeTool: { tool: 'qwenwork', subtype, dirName: '.qwenworkcn' } };
}
function verify(result, skillsRoot) {
  expect(result.success).toBe(true);
  expect(result.widget_path).toBe('yida-skills/skills/yida-design/templates/theme-selector.html');
  expect(path.isAbsolute(result.widget_path)).toBe(false);
  expect(result.skillsRoot).toBe(skillsRoot);
  expect(path.resolve(skillsRoot, result.widget_path)).toBe(result.outputPath);
  expect(fs.readFileSync(result.outputPath).equals(source)).toBe(true);
}

test('desktop copies only HTML under host skills and refreshes it without removing sibling files', () => {
  const config = options('qwenwork_desktop');
  const first = prepareThemeSelector(config);
  verify(first, path.join(temp, '.qwenworkcn/skills'));
  const sibling = path.join(path.dirname(first.outputPath), 'keep.txt');
  fs.writeFileSync(sibling, 'keep');
  fs.writeFileSync(first.outputPath, 'old widget');
  verify(prepareThemeSelector(config), first.skillsRoot);
  expect(fs.readFileSync(sibling, 'utf8')).toBe('keep');
  expect(fs.existsSync(path.join(first.skillsRoot, 'yida-skills/SKILL.md'))).toBe(false);
});

test.each(['custom skills', 'custom skills/yida-skills'])('web uses configured skills root including package-path configuration: %s', configured => {
  const root = path.join(temp, 'custom skills');
  const config = options('qwenwork_web', { QWENWORK_CONFIG_CONTENT: JSON.stringify({ skills: { paths: [path.join(temp, configured)] } }) });
  verify(prepareThemeSelector(config), root);
});

test('web without configured paths uses its workspace market-skills root', () => {
  verify(prepareThemeSelector(options('qwenwork_web')), path.join(temp, '.qwenwork/market-skills'));
});

test('another host and malformed host configuration fail instead of returning a guessed path', () => {
  expect(() => prepareThemeSelector({ ...options('codex'), activeTool: { tool: 'codex', dirName: '.codex' } }))
    .toThrow(expect.objectContaining({ code: 'THEME_WIDGET_QWENWORK_REQUIRED' }));
  expect(() => prepareThemeSelector(options('qwenwork_web', { QWENWORK_CONFIG_CONTENT: '{broken' })))
    .toThrow(expect.objectContaining({ code: 'THEME_WIDGET_SKILLS_ROOT_UNAVAILABLE' }));
  expect(fs.readdirSync(temp)).toEqual([]);
});

test('linked package can be used without modifying source', () => {
  const skills = path.join(temp, '.qwenworkcn/skills');
  fs.mkdirSync(skills, { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'yida-skills'), path.join(skills, 'yida-skills'), process.platform === 'win32' ? 'junction' : 'dir');
  verify(prepareThemeSelector(options('qwenwork_desktop')), skills);
  expect(fs.readFileSync(path.join(ROOT, 'yida-skills/skills/yida-design/templates/theme-selector.html')).equals(source)).toBe(true);
});

(process.platform === 'win32' ? test.skip : test)('does not follow an unrelated destination symlink out of the host skills root', () => {
  const first = prepareThemeSelector(options('qwenwork_desktop'));
  fs.unlinkSync(first.outputPath);
  const outside = path.join(temp, 'outside.html');
  fs.writeFileSync(outside, 'keep');
  fs.symlinkSync(outside, first.outputPath);
  expect(() => prepareThemeSelector(options('qwenwork_desktop'))).toThrow(expect.objectContaining({ code: 'THEME_WIDGET_PATH_OUTSIDE_SKILLS' }));
  expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
});

(process.platform === 'win32' ? test.skip : test)('does not write through a dangling template symlink', () => {
  const first = prepareThemeSelector(options('qwenwork_desktop'));
  fs.unlinkSync(first.outputPath);
  const outside = path.join(temp, 'not-created.html');
  fs.symlinkSync(outside, first.outputPath);
  expect(() => prepareThemeSelector(options('qwenwork_desktop'))).toThrow();
  expect(fs.existsSync(outside)).toBe(false);
});

test.each(['--output', '--var', '--design-file', '--style-id'])('sample rejects %s before writing', async flag => {
  await expect(run(['yida-design', 'theme-selector', flag, 'unused'])).rejects.toMatchObject({ code: 'SAMPLE_ARGUMENT_INVALID' });
});

test('catalog preparation command resolves the copied widget under the host skills root', () => {
  const skillsRoot = path.join(temp, 'host-skills');
  const cliOptions = {
    cwd: temp, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, CI: '1', QWENWORK: '1', QWENWORK_WORKSPACE_DIR: temp,
      QWENWORK_CONFIG_CONTENT: JSON.stringify({ skills: { paths: [skillsRoot] } }) },
  };
  const bin = path.join(ROOT, 'bin/yida.js');
  const cli = args => execFileSync(process.execPath, [bin, ...args], cliOptions);
  const catalog = JSON.parse(cli(['design-plan', 'catalog', '--json']));
  const [executable, ...args] = catalog.themeSelection.qwenwork.prepareCommand.split(' ');
  expect(executable).toBe('openyida');
  expect(fs.existsSync(skillsRoot)).toBe(false);
  expect(cli(['sample', '--list'])).toContain('openyida sample yida-design theme-selector');
  const result = JSON.parse(cli(args));
  expect(result.tool).toBe(catalog.themeSelection.qwenwork.tool);
  verify(result, skillsRoot);
  const manifest = JSON.parse(cli(['commands', '--json']));
  const sample = manifest.commands.find(command => command.id === 'sample');
  expect(sample.notes.join(' ')).toContain('Pass result.widget_path unchanged');
  expect(sample.args.find(arg => arg.name === 'output').description).toContain('Not accepted by theme-selector');
});

test('standalone preview runs on any host and preserves requested order beyond four themes', async () => {
  const ids = ['app-terminal', 'app-sage', 'app-teal', 'app-platinum', 'free-creative'];
  const output = path.join(temp, 'preview.html');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const result = await run(['yida-design', 'theme-preview', '--theme-ids', ids.join(','), '--output', output, '--json']);
  expect(result).toMatchObject({ success: true, purpose: 'preview_only', selectionTool: 'ask_human', outputPath: output });
  expect(result.themes.map(item => item.themeId)).toEqual(ids);
  const html = fs.readFileSync(output, 'utf8');
  const data = JSON.parse(html.match(/<script id="preview-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  expect(data.themes.map(item => item.id)).toEqual(ids);
  expect(data.themes[0].img).toMatch(/^https:/);
  expect(Object.keys(data.themes[0]).sort()).toEqual(['id', 'img', 'name']);
  expect(data.themes[4]).not.toHaveProperty('img');
  expect(html).not.toContain('__bridge');
  await expect(run(['yida-design', 'theme-preview', '--theme-ids', 'app-sage', '--output', output])).rejects.toMatchObject({ code: 'EEXIST' });
  expect(fs.readFileSync(output, 'utf8')).toBe(html);
});

test.each([
  [], ['--theme-ids'], ['--theme-ids', 'app-sage,'], ['--theme-ids', 'app-sage,app-sage'],
  ['--theme-ids', 'app-sage', '--theme-ids', 'app-teal'], ['--theme-ids', 'not-a-theme'],
  ['--theme-ids', 'app-sage', '--var', 'ANY=value'],
])('invalid standalone preview input writes no output: %j', async (...args) => {
  await expect(run(['yida-design', 'theme-preview', ...args, '--output', path.join(temp, 'preview.html')])).rejects.toThrow();
  expect(fs.readdirSync(temp)).toEqual([]);
});

test('embedded metadata escapes script termination while preserving literal text', () => {
  const init = require('../lib/design-plan/init');
  const name = '</script><script>alert(1)</script>&\u2028';
  jest.spyOn(init, 'catalog').mockReturnValue({ themes: [{ themeId: 'safe', label: name }], creativeOption: { themeId: 'free-creative' } });
  const { createThemePreview } = require('../lib/core/theme-widget');
  const output = path.join(temp, 'preview.html');
  createThemePreview(['--theme-ids', 'safe', '--output', output]);
  const html = fs.readFileSync(output, 'utf8');
  expect(html).not.toContain(name);
  expect(JSON.parse(html.match(/<script id="preview-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).themes[0].name).toBe(name);
});


test.each([undefined, 'management', 'all', 'explicit-request', 'showcase'])('standalone pop art preview requires eligible context: %s', context => {
  const { createThemePreview } = require('../lib/core/theme-widget');
  const output = path.join(temp, 'preview.html');
  const args = ['--theme-ids', 'app-pop', '--output', output, ...(context ? ['--pop-art-context', context] : [])];
  if (['explicit-request', 'showcase'].includes(context)) {
    const result = createThemePreview(args);
    expect(result.themes[0].themeId).toBe('app-pop');
    const html = fs.readFileSync(output, 'utf8');
    const data = JSON.parse(html.match(/<script id="preview-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    expect(data.popArtContext).toBe(context);
  } else {
    expect(() => createThemePreview(args)).toThrow();
    expect(fs.existsSync(output)).toBe(false);
  }
});


test('preview cards reuse exact catalog images and render without executable scripts', () => {
  const { createThemePreview } = require('../lib/core/theme-widget');
  const catalog = require('../lib/design-plan/init').catalog();
  const ids = ['app-sage', 'app-terminal', 'free-creative'];
  const output = path.join(temp, 'inline.html');
  const result = createThemePreview(['--theme-ids', ids.join(','), '--output', output]);
  const html = fs.readFileSync(output, 'utf8');
  expect(result.attachment).toEqual({ name: 'inline.html', path: output });
  expect(result.presentation).toMatchObject({ format: 'html_card', surface: 'conversation', timing: 'same_turn_as_ask_human' });
  expect(html.match(/<article /g)).toHaveLength(3);
  expect(html).not.toMatch(/<script>/);
  expect(html).not.toMatch(/<(?:input|button)\b/);
  for (const id of ids.slice(0, 2)) {
    const theme = catalog.themes.find(item => item.themeId === id);
    expect(html).toContain(`src="${theme.previewImage.url}"`);
    expect(html).toContain(`>${theme.label}</h2>`);
  }
  expect(html.match(/<img /g)).toHaveLength(2);
  expect(html).not.toContain('class="preview" hidden');
});
