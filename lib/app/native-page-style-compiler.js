'use strict';

const STYLE_BLOCK_START = '/* openyida-native-styles:start */';
const STYLE_BLOCK_END = '/* openyida-native-styles:end */';

function normalizeCss(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function escapeClassNameToken(token) {
  return token.replace(/[^a-zA-Z0-9_-]/g, function (character) {
    return '\\' + character.codePointAt(0).toString(16) + ' ';
  });
}

function classNameToSelector(className) {
  const tokens = String(className || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return '';
  }
  return tokens.map(function (token) {
    return '.' + escapeClassNameToken(token);
  }).join('');
}

function compileNodeStyle(selector, style) {
  const normalized = normalizeCss(style);
  if (!normalized) {
    return '';
  }
  if (normalized.includes(':root')) {
    return normalized.replace(/:root\b/g, selector);
  }
  if (normalized.includes('{')) {
    const error = new Error('Native page node style must use :root for selector-scoped CSS: ' + selector);
    error.code = 'NATIVE_PAGE_STYLE_ROOT_REQUIRED';
    throw error;
  }
  return selector + ' {\n  ' + normalized.replace(/;\s*/g, ';\n  ').replace(/\s+$/, '') + '\n}';
}

function walkNodes(node, visitor, path) {
  if (!node || typeof node !== 'object') {
    return;
  }
  visitor(node, path);
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach(function (child, index) {
    walkNodes(child, visitor, path + '/children/' + index);
  });
}

function collectPageStyles(pageRoot, pageIndex) {
  const bySelector = new Map();
  const order = [];

  walkNodes(pageRoot, function (node, nodePath) {
    const props = node.props && typeof node.props === 'object' ? node.props : null;
    if (!props || typeof props.__style__ !== 'string' || !props.__style__.trim()) {
      return;
    }
    const selector = classNameToSelector(props.className);
    if (!selector) {
      return;
    }
    const css = compileNodeStyle(selector, props.__style__);
    const normalized = normalizeCss(css);
    const previous = bySelector.get(selector);
    if (previous && previous.normalized !== normalized) {
      const error = new Error('Conflicting native page styles for selector ' + selector);
      error.code = 'NATIVE_PAGE_STYLE_CONFLICT';
      error.details = {
        pageIndex,
        selector,
        firstPath: previous.path,
        secondPath: nodePath,
      };
      throw error;
    }
    if (!previous) {
      bySelector.set(selector, { css, normalized, path: nodePath });
      order.push(selector);
    }
  }, '/pages/' + pageIndex + '/componentsTree/0');

  return order.map(function (selector) {
    return { selector, css: bySelector.get(selector).css };
  });
}

function stripManagedBlock(css) {
  const source = String(css || '');
  const start = source.indexOf(STYLE_BLOCK_START);
  if (start === -1) {
    return source;
  }
  const end = source.indexOf(STYLE_BLOCK_END, start + STYLE_BLOCK_START.length);
  if (end === -1) {
    const error = new Error('Native page CSS contains an unterminated OpenYida style block');
    error.code = 'NATIVE_PAGE_STYLE_BLOCK_INVALID';
    throw error;
  }
  return (source.slice(0, start) + source.slice(end + STYLE_BLOCK_END.length)).trim();
}

function splitTopLevelCss(css) {
  const source = String(css || '');
  const parts = [];
  let cursor = 0;
  let blockStart = 0;
  let depth = 0;
  let quote = '';
  let comment = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index++;
      }
      continue;
    }
    if (!quote && character === '/' && next === '*') {
      comment = true;
      index++;
      continue;
    }
    if (quote) {
      if (character === '\\') {
        index++;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') {
      if (depth === 0) {
        blockStart = index;
      }
      depth++;
      continue;
    }
    if (character === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        parts.push({
          prefix: source.slice(cursor, blockStart),
          block: source.slice(blockStart, index + 1),
        });
        cursor = index + 1;
      }
    }
  }
  if (cursor < source.length) {
    parts.push({ prefix: source.slice(cursor), block: '' });
  }
  return parts;
}

function normalizeSelectorList(value) {
  return String(value || '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

function removeSelectorRules(css, selectors) {
  const selectorSet = new Set(selectors);
  return splitTopLevelCss(css).map(function (part) {
    const selector = normalizeSelectorList(part.prefix);
    if (part.block && selectorSet.has(selector)) {
      return '';
    }
    return part.prefix + part.block;
  }).join('').trim();
}

function buildManagedBlock(rules) {
  if (rules.length === 0) {
    return '';
  }
  return [
    STYLE_BLOCK_START,
    rules.map(function (rule) { return rule.css; }).join('\n\n'),
    STYLE_BLOCK_END,
  ].join('\n');
}

function compileNativePageStyles(schema) {
  if (!schema || !Array.isArray(schema.pages)) {
    return { changed: false, pagesVisited: 0, pagesChanged: 0, rulesCompiled: 0, pages: [] };
  }

  const report = {
    changed: false,
    pagesVisited: schema.pages.length,
    pagesChanged: 0,
    rulesCompiled: 0,
    pages: [],
  };

  schema.pages.forEach(function (page, pageIndex) {
    const roots = page && Array.isArray(page.componentsTree) ? page.componentsTree : [];
    const pageRoot = roots.find(function (node) { return node && node.componentName === 'Page'; });
    if (!pageRoot) {
      return;
    }
    const rules = collectPageStyles(pageRoot, pageIndex);
    const originalCss = String(pageRoot.css || '');
    let preservedCss = stripManagedBlock(originalCss);
    preservedCss = removeSelectorRules(preservedCss, rules.map(function (rule) { return rule.selector; }));
    const managedBlock = buildManagedBlock(rules);
    const compiledCss = [preservedCss, managedBlock].filter(Boolean).join('\n');
    const changed = compiledCss !== originalCss;
    if (changed) {
      pageRoot.css = compiledCss;
      report.changed = true;
      report.pagesChanged++;
    }
    report.rulesCompiled += rules.length;
    report.pages.push({
      pageIndex,
      pageId: page.id || '',
      changed,
      rulesCompiled: rules.length,
      selectors: rules.map(function (rule) { return rule.selector; }),
    });
  });

  return report;
}

module.exports = Object.freeze({
  STYLE_BLOCK_END,
  STYLE_BLOCK_START,
  classNameToSelector,
  compileNativePageStyles,
  compileNodeStyle,
  removeSelectorRules,
  stripManagedBlock,
});
