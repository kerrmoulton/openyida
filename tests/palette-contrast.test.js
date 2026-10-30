'use strict';

const fs = require('fs');
const path = require('path');
const { auditPalette, validatePalette } = require('../lib/design/palette-contrast');
const { loadThemeIndex, DESIGN_SKILL_ROOT, resolveThemeColors } = require('../lib/design-plan/themes');
const { applyDesignTokens } = require('../lib/app/theme-from-design');
const { rootDeclarations } = require('../lib/core/theme-brand-scale');
const { parseDesignDocument, serializeDesignDocument } = require('../lib/design/document');
const base = fs.readFileSync(path.join(DESIGN_SKILL_ROOT, 'references/theme/app-custom-theme-template.css'), 'utf8');
const defaults = rootDeclarations(base.replace(/\/\*[\s\S]*?\*\//g, ''));

test.each(loadThemeIndex().themes)('$themeId reports unresolved and low-contrast pairs without changing authored colors', theme => {
  const source = fs.readFileSync(path.join(DESIGN_SKILL_ROOT, theme.templatePath), 'utf8');
  const paired = fs.readFileSync(path.join(DESIGN_SKILL_ROOT, theme.cssTemplatePath), 'utf8');
  for (const primary of ['#6F4E37', '#111111', '#FFFFFF', '#FFDE59', '#1677FF', '#B421FD', '#00CCAA']) {
    const metadata = parseDesignDocument(resolveThemeColors(source.replaceAll('{{PRIMARY_COLOR}}', primary))).metadata;
    if (theme.mode === 'creative') {delete metadata.applicationStyle;}
    const css = applyDesignTokens(paired, serializeDesignDocument(metadata, ''));
    const tokens = rootDeclarations(css.replace(/\/\*[\s\S]*?\*\//g, ''));
    const audit = auditPalette(tokens, { css });
    expect(tokens['--color-brand1-6']).toBe(metadata.tokens['application-global'].colors['--color-brand1-6']);
    expect(audit.checks.length + audit.unresolved.length).toBe(26);
    for (const issue of audit.issues) {expect(issue.minimum).toBe(4.5); expect(issue.ratio).toBeLessThan(4.5);}
    if (audit.issues.length) {
      expect(() => validatePalette(tokens, { css })).toThrow(expect.objectContaining({ code: 'DESIGN_THEME_CONTRAST_LOW' }));
    } else {expect(validatePalette(tokens, { css }).issues).toEqual([]);}
  }
});

test('rejects the reported light-on-light navigation and brown-on-brown content', () => {
  const tokens = { ...defaults, '--pod-shell-theme-bg-color': '#F6FEFD', '--pod-nav-item-text-color': '#B4F5F1',
    '--pod-page-bg-color': '#B96B49', '--color-text1-4': '#733C26' };
  expect(auditPalette(tokens).issues.map(pair => pair.role)).toEqual(expect.arrayContaining(['nav.item', 'page.body']));
  expect(() => validatePalette(tokens)).toThrow(expect.objectContaining({ code: 'DESIGN_THEME_CONTRAST_LOW' }));
});

test('a navigation image is pending runtime review, while opaque fills retain the 4.5 threshold', () => {
  const css = '.vc-shell .next-shell-aside.next-shell-navigation { background-image: url("https://example.com/rail.png"); }';
  const tokens = { ...defaults, '--pod-nav-item-text-color': '#FFFFFF', '--pod-shell-theme-bg-color': '#FFFFFF',
    '--pod-nav-menu-bg-selected-color': '#FFFFFF', '--pod-nav-item-text-selected-color': '#FFFFFF' };
  const audit = auditPalette(tokens, { css });
  expect(audit.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'nav.item', reason: 'NAVIGATION_IMAGE_REQUIRES_RUNTIME_CHECK' })]));
  expect(audit.issues).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'nav.selected', ratio: 1, minimum: 4.5 })]));
  expect(() => validatePalette(tokens, { css })).toThrow(expect.objectContaining({ code: 'DESIGN_THEME_CONTRAST_LOW' }));
});

test('main outlined-texture-duotone retains its real 4.41 secondary-text finding', () => {
  const theme = loadThemeIndex().themes.find(item => item.themeId === 'outlined-texture-duotone');
  const design = resolveThemeColors(fs.readFileSync(path.join(DESIGN_SKILL_ROOT, theme.templatePath), 'utf8').replaceAll('{{PRIMARY_COLOR}}', '#2C73A9'));
  const css = require('../lib/app/theme-source').generateThemeCss(design);
  const tokens = rootDeclarations(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  expect(auditPalette(tokens, { css }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'page.secondary', ratio: 4.41, minimum: 4.5 })]));
});

test('composites transparent hover fills on the navigation surface', () => {
  const tokens = { ...defaults, '--pod-shell-theme-bg-color': '#FFFFFF',
    '--pod-nav-menu-bg-hover-color': 'rgba(0, 0, 0, 0.5)', '--pod-nav-item-text-hover-color': '#FFFFFF' };
  const pair = auditPalette(tokens).checks.find(pair => pair.role === 'nav.hover');
  expect(pair.ratio).toBeCloseTo(3.98, 2);
  tokens['--pod-nav-menu-bg-hover-color'] = 'transparent';
  expect(auditPalette(tokens).checks.find(pair => pair.role === 'nav.hover').ratio).toBe(1);
});

test('unknown colors, missing backgrounds and cycles are unresolved rather than passing', () => {
  for (const value of ['oklch(0.7 0.2 40)', 'var(--missing)', 'var(--pod-card-bg-color)']) {
    const audit = auditPalette({ ...defaults, '--pod-card-bg-color': value });
    expect(audit.unresolved.map(pair => pair.role)).toContain('card.body');
    expect(audit.checks.map(pair => pair.role)).not.toContain('card.body');
  }
});

test('disabled colors and a brand swatch are not mistaken for readable text roles', () => {
  const tokens = { ...defaults, '--color-text1-2': '#FFFFFF', '--color-text1-1': '#FFFFFF',
    '--color-brand1-6': '#FFFFFF', '--pod-nav-item-text-selected-color': '#202020', '--pod-nav-menu-bg-selected-color': '#FFFFFF' };
  expect(auditPalette(tokens).issues).toEqual([]);
});
