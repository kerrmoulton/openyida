'use strict';

// The authored paired CSS owns template selectors; design.md owns token changes.
// Never rebuild an existing template from the shared skeleton.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { reviewPalette } = require('./theme-palette-baseline');
const { parseDesignDocument, serializeDesignDocument } = require('../lib/design/document');
const { resolveThemeColors, loadThemeIndex, DESIGN_SKILL_ROOT } = require('../lib/design-plan/themes');
const { applyDesignTokens, readDesignTokens } = require('../lib/app/theme-from-design');
const { writeFiles } = require('../lib/design-plan/files');
const { rootDeclarations } = require('../lib/core/theme-brand-scale');
const { auditPalette } = require('../lib/design/palette-contrast');
const platformCss = fs.readFileSync(path.join(DESIGN_SKILL_ROOT, 'references/theme/app-custom-theme-template.css'), 'utf8');

/** Compile the complete authored theme into scoped CSS, retaining brand placeholders. */
function cssTemplate(markdown, rules = '', pairedCss) {
  // Existing paired files are authored sources, not generated output. A token
  // mismatch is not authorization to rewrite their declarations or selectors.
  if (pairedCss !== undefined) {
    if (!rules.trim()) {return pairedCss;}
    const block = `/* openyida-extra-rules:start */\n${rules.trim()}\n/* openyida-extra-rules:end */`;
    const managed = /\/\* openyida-extra-rules:start \*\/[\s\S]*?\/\* openyida-extra-rules:end \*\//;
    return managed.test(pairedCss) ? pairedCss.replace(managed, () => block) : `${pairedCss.trimEnd()}\n\n${block}\n`;
  }
  // Resolve only to reuse the platform's scope/recipe writer, then restore every
  // project-dependent value. The temporary seed never becomes a template default.
  const metadata = parseDesignDocument(markdown).metadata;
  if (metadata.applicationStyle?.mode === 'creative') {delete metadata.applicationStyle;}
  const source = serializeDesignDocument(metadata, '');
  const resolved = resolveThemeColors(source.replace(/\{\{PRIMARY_COLOR\}\}/g, '#2C73A9'));
  const before = {};
  const collect = node => Object.entries(node).forEach(([key, value]) => {
    if (key.startsWith('--')) {before[key] = String(value);}
    else if (value && typeof value === 'object') {collect(value);}
  });
  collect(metadata.tokens);
  const after = readDesignTokens(resolved);
  // Restore authoring expressions by token identity. An independently designed
  // border or accent may happen to equal the temporary seed and must stay literal.
  const bridges = {
    '--color-brand-1': 'var(--color-brand1-10)', '--color-brand-2': 'var(--color-brand1-1)',
    '--color-brand-3': 'var(--color-brand1-6)', '--color-brand-4': 'var(--color-brand1-9)',
    '--color-group': [6, 1, 5, 2, 9, 3].map(slot => `var(--color-brand1-${slot})`).join(', '),
  };
  let base = platformCss;
  const managed = /\/\* openyida-extra-rules:start \*\/[\s\S]*?\/\* openyida-extra-rules:end \*\//;
  const block = rules.trim() ? `/* openyida-extra-rules:start */\n${rules.trim()}\n/* openyida-extra-rules:end */` : '';
  base = managed.test(base) ? base.replace(managed, () => block) : block ? `${base.trimEnd()}\n\n${block}\n` : base;
  const compiled = applyDesignTokens(base, resolved);
  return compiled
    .replace(/^(\s*(--[\w-]+)\s*:\s*)([^;\n]+);/gm, (_, prefix, name, value) =>
      `${prefix}${value.trim() === after[name] && /\{\{|<生成实际色值：/.test(before[name] || '')
        ? before[name] : (!(name in before) && bridges[name]) || value};`)
    .replace('本模板默认品牌种子为 coffee 咖啡色；最终配色和圆角以 design.md 的 tokens 为准。',
      '品牌值保留项目占位和派生说明；先完成 design.md，再生成实际主题 CSS。')
    .replace(/\s+$/, '\n');
}

/** Compile every template first so an invalid design cannot cause partial writes. */
function build({ root = DESIGN_SKILL_ROOT, themes = loadThemeIndex().themes, check = false, baseline, onReview = () => {} } = {}) {
  const paletteIssues = [];
  const outputs = themes.map(theme => {
    const directory = path.resolve(root, 'templates/design-themes', theme.themeId);
    const source = path.resolve(root, theme.templatePath);
    const output = path.resolve(root, theme.cssTemplatePath);
    if (source !== path.join(directory, 'design.md') || output !== path.join(directory, 'app_theme.css')) {
      throw new Error(`Invalid theme paths: ${theme.themeId}`);
    }
    const rulesFile = path.join(directory, 'theme-rules.css');
    const rules = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf8') : '';
    const markdown = fs.readFileSync(source, 'utf8');
    const css = cssTemplate(markdown, rules, fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : undefined);
    const metadata = parseDesignDocument(markdown).metadata;
    if (metadata.applicationStyle?.mode === 'creative') {delete metadata.applicationStyle;}
    const design = resolveThemeColors(serializeDesignDocument(metadata, '').replace(/\{\{PRIMARY_COLOR\}\}/g, '#2C73A9'));
    const resolved = applyDesignTokens(css, design, markdown, { paired: true });
    const audit = auditPalette(rootDeclarations(resolved.replace(/\/\*[\s\S]*?\*\//g, '')), { css: resolved });
    if (audit.issues.length || audit.unresolved.length) {
      // Normalize line endings so checkout policy cannot change audit identity.
      const sourceHash = createHash('sha256').update(JSON.stringify([markdown, css].map(text => text.replace(/\r\n/g, '\n')))).digest('hex');
      paletteIssues.push({ themeId: theme.themeId, sourceHash, ...audit });
    }
    return [output, css];
  });
  const review = baseline ? reviewPalette(paletteIssues, baseline) : { known: [], regressions: paletteIssues };
  if (review.known.length) {onReview(review.known);}
  if (review.regressions.length) {
    const error = new Error(`Template palette review required: ${review.regressions.map(item => item.themeId).join(', ')}`);
    error.code = 'THEME_PALETTE_REVIEW_REQUIRED';
    error.details = review.regressions;
    throw error;
  }
  const changed = outputs.filter(([file, css]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== css);
  if (check && changed.length) {throw new Error(`Theme CSS out of date: ${changed.map(([file]) => path.relative(root, file)).join(', ')}`);}
  if (!check && changed.length) {writeFiles(changed);}
  return changed.map(([file]) => file);
}

if (require.main === module) {
  if (process.argv.slice(2).some(arg => !['--check', '--strict-palette'].includes(arg))) {throw new Error('Usage: node scripts/build-application-styles.js [--check] [--strict-palette]');}
  try {
    build({
      check: process.argv.includes('--check'),
      baseline: process.argv.includes('--strict-palette') ? undefined : require('./theme-palette-baseline.json'),
      onReview: templates => console.warn(JSON.stringify({ code: 'THEME_PALETTE_BASELINE_REVIEW',
        templates: templates.map(({ themeId, issues, unresolved }) => ({ themeId, issues, unresolved })),
      }, null, 2)),
    });
  }
  catch (error) {
    if (!error.details) {throw error;}
    console.error(JSON.stringify({ code: error.code, templates: error.details }, null, 2));
    process.exitCode = 1;
  }
}
module.exports = { build, cssTemplate };
