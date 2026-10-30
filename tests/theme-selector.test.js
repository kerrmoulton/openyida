'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { catalog } = require('../lib/design-plan/init');
const { getVisualDecisionPolicy } = require('../lib/design-plan/visual-policy');

const html = fs.readFileSync(path.join(__dirname, '../yida-skills/skills/yida-design/templates/theme-selector.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// DOM double for passive rendering; responsive layout is checked in a browser.
function element(tag) {
  return {
    tag, childNodes: [], handlers: {}, attributes: {}, hidden: false,
    appendChild(child) { child.parent = this; this.childNodes.push(child); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    remove() { this.parent.childNodes = this.parent.childNodes.filter(child => child !== this); },
  };
}
function mount(themes, embedded = false, popArtContext) {
  const bridge = { sendToAgent: jest.fn() };
  const ids = Object.fromEntries(['themes', 'status', 'preview-data'].map(id => [id, element('div')]));
  ids['preview-data'].textContent = JSON.stringify(embedded ? { themes, popArtContext } : {});
  const window = { ...(embedded ? {} : { __WIDGET_DATA__: { themes, popArtContext } }), __bridge: bridge };
  vm.runInNewContext(script, { window, document: { getElementById: id => ids[id], createElement: element } });
  const descendants = node => [node, ...node.childNodes.flatMap(descendants)];
  return { ...ids, window, bridge, nodes: tag => descendants(ids.themes).filter(node => node.tag === tag) };
}
const candidates = [
  { id: 'soft-inset-surfaces', name: '柔和内嵌', desc: '适合持续阅读', img: 'https://example.test/preview.png', tags: ['推荐'] },
  { id: 'free-creative', name: '自由创意', desc: '重新推演' },
];

test('preview is read-only even with legacy preselection or a bridge', () => {
  const ui = mount([{ ...candidates[0], selected: true }, candidates[1]]);
  expect(ui.nodes('article')).toHaveLength(2);
  expect(ui.nodes('input')).toHaveLength(0);
  expect(ui.nodes('button')).toHaveLength(0);
  expect(ui.bridge.sendToAgent).not.toHaveBeenCalled();
  expect(script).not.toContain('__bridge');
  expect(html).not.toMatch(/<(?:button|input|fieldset)\b/);
});

test('renders every requested theme in order, including beyond four, from embedded data', () => {
  const themes = Array.from({ length: 7 }, (_, i) => ({ id: `theme-${i}`, name: `风格${i}` }));
  const ui = mount(themes, true);
  expect(ui.nodes('article').map(node => node.attributes['data-theme-id'])).toEqual(themes.map(item => item.id));
  expect(ui.nodes('h2').map(node => node.textContent)).toEqual(themes.map(item => item.name));
});

test('missing or broken images leave text choices without an empty image frame', () => {
  const ui = mount(candidates);
  expect(ui.nodes('img')).toHaveLength(1);
  const image = ui.nodes('img')[0];
  expect(image.hidden).toBe(true);
  image.handlers.load();
  expect(image.hidden).toBe(false);
  image.handlers.error();
  expect(ui.nodes('img')).toHaveLength(0);
  expect(ui.nodes('article')).toHaveLength(2);
});

test('renders supplied text literally, rejects invalid/duplicate IDs and unsafe image schemes', () => {
  const name = '<img src=x onerror=alert(1)>';
  const ui = mount([{ id: 'safe', name, img: 'javascript:alert(1)' }, { id: 'safe', name: '重复' }, { id: 'bad）', name: '错误' }, null]);
  expect(ui.nodes('article')).toHaveLength(1);
  expect(ui.nodes('img')).toHaveLength(0);
  expect(ui.nodes('h2').some(node => node.textContent === name)).toBe(true);
  expect(ui.nodes('article')[0].attributes['aria-labelledby']).toBe('theme-title-0');
});

test.each([undefined, null, {}, []])('empty or malformed data is handled: %p', themes => {
  const ui = mount(themes);
  expect(ui.nodes('article')).toHaveLength(0);
  expect(ui.status.textContent).toContain('没有可展示');
  expect(ui.bridge.sendToAgent).not.toHaveBeenCalled();
});

test('current CLI catalog supplies optional images to template without requiring every theme to have one', () => {
  const result = catalog();
  const themes = [...result.themes, result.creativeOption].map(theme => ({
    id: theme.themeId, name: theme.label, desc: theme.styleSummary, img: theme.previewImage?.url,
  }));
  const ui = mount(themes);
  expect(ui.nodes('article')).toHaveLength(themes.length - 1);
  expect(ui.nodes('article').some(node => node.attributes['data-theme-id'] === 'app-pop')).toBe(false);
  expect(ui.nodes('img')).toHaveLength(result.themes.filter(theme => theme.previewImage && theme.themeId !== 'app-pop').length);
  expect(ui.nodes('article').some(node => node.attributes['data-theme-id'] === 'free-creative')).toBe(true);
  const policy = result.themeSelection;
  expect(policy).toEqual(getVisualDecisionPolicy().themeSelection);
  expect(policy.qwenwork).toMatchObject({ activeToolId: 'qwenwork', tool: 'qoder_show_widget', purpose: 'preview_only', response: 'none',
    trigger: 'explicit_user_request', defaultEnabled: false });
  expect(policy.preview).toMatchObject({ trigger: 'explicit_user_request', defaultEnabled: false });
  expect(policy.selectionTool).toBe('ask_human');
  expect(policy.preview).toMatchObject({ trigger: 'explicit_user_request', purpose: 'preview_only', maxColumns: 6, desktopColumns: [4, 5, 6], content: ['name', 'img'] });
  expect(policy.qwenwork.prepareCommand).toBe('openyida sample yida-design theme-selector --json');
  expect(policy.qwenwork.widgetPathSource).toContain('relative to the host skills root');
  expect(policy.qwenwork).not.toHaveProperty('template');
});


test.each(['app-sage', 'app-teal', 'app-terminal'])('%s can be previewed with its catalog name', async themeId => {
  const theme = catalog().themes.find(item => item.themeId === themeId);
  const previews = require('../yida-skills/skills/yida-design/references/theme-preview-images.json');
  expect(theme.previewImage.url).toBe(previews[themeId]);
  const ui = mount([{ id: themeId, name: theme.label, img: theme.previewImage.url, desc: theme.styleSummary }]);
  expect(ui.nodes('img')[0].src).toBe(previews[themeId]);
  expect(ui.nodes('h2')[0].textContent).toBe(theme.label);
  expect(ui.bridge.sendToAgent).not.toHaveBeenCalled();
});


test.each([undefined, 'management', 'all', 'explicit-request', 'showcase'])('pop art preview is gated by context: %s', context => {
  const ui = mount([{ id: 'app-pop', name: '波普印刷' }, candidates[0]], false, context);
  expect(ui.nodes('article').some(node => node.attributes['data-theme-id'] === 'app-pop')).toBe(['explicit-request', 'showcase'].includes(context));
  expect(ui.nodes('article').some(node => node.attributes['data-theme-id'] === candidates[0].id)).toBe(true);
});


test('cards contain only the title and optional image, ignoring legacy descriptions and tags', () => {
  const ui = mount(candidates);
  expect(ui.nodes('article')[0].childNodes.map(node => node.tag)).toEqual(['h2', 'img']);
  expect(ui.nodes('article')[1].childNodes.map(node => node.tag)).toEqual(['h2']);
  expect(ui.nodes('span')).toHaveLength(0);
  expect(html).not.toContain('reference-note');
  expect(html).not.toContain('<h1>');
});
