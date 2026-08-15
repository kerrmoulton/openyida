'use strict';

const {
  STYLE_BLOCK_START,
  compileNativePageStyles,
} = require('../lib/app/native-page-style-compiler');

function buildSchema(children, css) {
  return {
    pages: [{
      id: 'FORM_TEST',
      componentsTree: [{
        componentName: 'Page',
        css: css || 'body { background: #f2f3f5; }',
        children,
      }],
    }],
  };
}

describe('native page style compiler', () => {
  test('compiles :root styles and preserves global CSS', () => {
    const schema = buildSchema([{
      componentName: 'Div',
      props: {
        className: 'crud_actions',
        __style__: ':root { display:flex; gap:12px; justify-content:flex-end; }',
      },
    }]);

    const report = compileNativePageStyles(schema);

    expect(report).toMatchObject({ changed: true, pagesChanged: 1, rulesCompiled: 1 });
    expect(schema.pages[0].componentsTree[0].css).toContain('body { background: #f2f3f5; }');
    expect(schema.pages[0].componentsTree[0].css).toContain(STYLE_BLOCK_START);
    expect(schema.pages[0].componentsTree[0].css).toContain('.crud_actions { display:flex; gap:12px; justify-content:flex-end; }');
  });

  test('is idempotent and replaces an existing selector rule', () => {
    const schema = buildSchema([{
      componentName: 'Div',
      props: {
        className: 'toolbar dense',
        __style__: ':root { display:flex; gap:16px; }',
      },
    }], 'body{margin:0}.toolbar.dense{gap:2px}');

    const first = compileNativePageStyles(schema);
    const firstCss = schema.pages[0].componentsTree[0].css;
    const second = compileNativePageStyles(schema);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(schema.pages[0].componentsTree[0].css).toBe(firstCss);
    expect(firstCss).not.toContain('gap:2px');
    expect(firstCss).toContain('.toolbar.dense { display:flex; gap:16px; }');
  });

  test('rejects conflicting styles for the same class selector', () => {
    const schema = buildSchema([
      { componentName: 'Div', props: { className: 'same', __style__: ':root { gap:8px; }' } },
      { componentName: 'Div', props: { className: 'same', __style__: ':root { gap:12px; }' } },
    ]);

    expect(function () { compileNativePageStyles(schema); }).toThrow(/Conflicting native page styles/);
  });

  test('ignores object styles used by ordinary form components', () => {
    const schema = buildSchema([{
      componentName: 'TextField',
      props: { className: 'field', __style__: { marginTop: 8 } },
    }]);

    const report = compileNativePageStyles(schema);

    expect(report.rulesCompiled).toBe(0);
    expect(schema.pages[0].componentsTree[0].css).toBe('body { background: #f2f3f5; }');
  });

  test('supports declaration-only node styles deterministically', () => {
    const schema = buildSchema([{
      componentName: 'Div',
      props: { className: 'plain', __style__: 'display:flex; gap:8px;' },
    }]);

    compileNativePageStyles(schema);

    expect(schema.pages[0].componentsTree[0].css).toContain('.plain {\n  display:flex;\n  gap:8px;\n}');
  });
});
