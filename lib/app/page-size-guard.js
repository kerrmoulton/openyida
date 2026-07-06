'use strict';

const path = require('path');
const { t } = require('../core/i18n');
const { warn, hint } = require('../core/chalk');

const LARGE_SOURCE_BYTES = 2 * 1024 * 1024;
const LARGE_SOURCE_LINES = 3000;
const VERY_LONG_LINE_CHARS = 200000;
const LONG_BASE64_RE = /base64,[A-Za-z0-9+/=]{4096,}/;

const warnedSources = new Set();

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function scanSource(sourceCode) {
  if (!sourceCode) {
    return { lineCount: 0, maxLineLength: 0 };
  }

  let lineCount = 1;
  let currentLineLength = 0;
  let maxLineLength = 0;

  for (let index = 0; index < sourceCode.length; index++) {
    if (sourceCode.charCodeAt(index) === 10) {
      lineCount++;
      if (currentLineLength > maxLineLength) {
        maxLineLength = currentLineLength;
      }
      currentLineLength = 0;
    } else {
      currentLineLength++;
    }
  }

  if (sourceCode.endsWith('\n')) {
    lineCount--;
  }
  if (currentLineLength > maxLineLength) {
    maxLineLength = currentLineLength;
  }

  return { lineCount, maxLineLength };
}

function analyzePageSourceSize(sourceCode, sourcePath = '') {
  const text = sourceCode || '';
  const byteLength = Buffer.byteLength(text, 'utf8');
  const { lineCount, maxLineLength } = scanSource(text);
  const hasLongLine = maxLineLength >= VERY_LONG_LINE_CHARS;
  const hasBase64Literal = text.includes('base64,') && LONG_BASE64_RE.test(text);
  const isLarge = byteLength >= LARGE_SOURCE_BYTES || lineCount >= LARGE_SOURCE_LINES;

  return {
    sourcePath,
    fileName: sourcePath ? path.basename(sourcePath) : '',
    byteLength,
    byteSize: formatBytes(byteLength),
    lineCount,
    maxLineLength,
    isLarge,
    hasLongLine,
    hasBase64Literal,
    shouldWarn: isLarge || hasLongLine || hasBase64Literal,
  };
}

function getWarningKey(sourcePath, analysis) {
  const resolvedPath = sourcePath ? path.resolve(sourcePath) : '<inline>';
  return [
    resolvedPath,
    analysis.byteLength,
    analysis.lineCount,
    analysis.maxLineLength,
  ].join('|');
}

function warnLargePageSource(sourceCode, sourcePath = '') {
  const analysis = analyzePageSourceSize(sourceCode, sourcePath);
  if (!analysis.shouldWarn) {
    return analysis;
  }

  const warningKey = getWarningKey(sourcePath, analysis);
  if (warnedSources.has(warningKey)) {
    return analysis;
  }
  warnedSources.add(warningKey);

  const displayPath = analysis.fileName || sourcePath || '<inline>';
  warn(t('page_size.large_source', displayPath, analysis.byteSize, analysis.lineCount));
  if (analysis.hasLongLine) {
    hint(t('page_size.long_line_hint', analysis.maxLineLength));
  }
  if (analysis.hasBase64Literal) {
    hint(t('page_size.base64_hint'));
  }
  hint(t('page_size.memory_hint'));
  hint(t('page_size.windows_hint'));

  return analysis;
}

module.exports = {
  LARGE_SOURCE_BYTES,
  LARGE_SOURCE_LINES,
  VERY_LONG_LINE_CHARS,
  analyzePageSourceSize,
  formatBytes,
  warnLargePageSource,
};
