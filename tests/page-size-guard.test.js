'use strict';

const {
  LARGE_SOURCE_BYTES,
  LARGE_SOURCE_LINES,
  VERY_LONG_LINE_CHARS,
  analyzePageSourceSize,
  formatBytes,
} = require('../lib/app/page-size-guard');

describe('page size guard', () => {
  test('does not warn for ordinary page source', () => {
    const source = [
      'export function renderJsx() {',
      '  return <div>ok</div>;',
      '}',
    ].join('\n');

    const analysis = analyzePageSourceSize(source, '/tmp/small.oyd.jsx');

    expect(analysis.fileName).toBe('small.oyd.jsx');
    expect(analysis.lineCount).toBe(3);
    expect(analysis.isLarge).toBe(false);
    expect(analysis.shouldWarn).toBe(false);
  });

  test('warns when source exceeds byte budget', () => {
    const source = `export function renderJsx() { return <div>${'x'.repeat(LARGE_SOURCE_BYTES)}</div>; }`;

    const analysis = analyzePageSourceSize(source, '/tmp/large.oyd.jsx');

    expect(analysis.byteLength).toBeGreaterThanOrEqual(LARGE_SOURCE_BYTES);
    expect(analysis.isLarge).toBe(true);
    expect(analysis.shouldWarn).toBe(true);
  });

  test('warns when source exceeds line budget', () => {
    const source = Array.from({ length: LARGE_SOURCE_LINES }, (_, index) => `// line ${index}`).join('\n');

    const analysis = analyzePageSourceSize(source, '/tmp/long.oyd.jsx');

    expect(analysis.lineCount).toBe(LARGE_SOURCE_LINES);
    expect(analysis.isLarge).toBe(true);
    expect(analysis.shouldWarn).toBe(true);
  });

  test('detects long single lines and inline base64 payloads', () => {
    const source = [
      `var vendor = "${'x'.repeat(VERY_LONG_LINE_CHARS)}";`,
      `var image = "data:image/png;base64,${'A'.repeat(4096)}";`,
    ].join('\n');

    const analysis = analyzePageSourceSize(source, '/tmp/vendor.oyd.jsx');

    expect(analysis.hasLongLine).toBe(true);
    expect(analysis.hasBase64Literal).toBe(true);
    expect(analysis.shouldWarn).toBe(true);
  });

  test('formats byte counts for warnings', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
  });
});
