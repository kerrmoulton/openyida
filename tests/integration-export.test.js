'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseArgs,
  resolveOutputPath,
  writeJsonFile,
} = require('../lib/integration/integration-export');

describe('integration raw export', () => {
  test('parses resource identifiers and an optional output path', () => {
    expect(parseArgs(['APP_TEST', 'FORM_TEST', 'LPROC_TEST', './flow.json'])).toEqual({
      appType: 'APP_TEST',
      formUuid: 'FORM_TEST',
      processCode: 'LPROC_TEST',
      outputPath: './flow.json',
      help: false,
    });
  });

  test('rejects transformation options', () => {
    expect(() => parseArgs(['APP_TEST', 'FORM_TEST', 'LPROC_TEST', '--redact']))
      .toThrow('未知参数: --redact');
  });

  test('builds a useful default filename', () => {
    expect(path.basename(resolveOutputPath({ processCode: 'LPROC/TEST' })))
      .toBe('integration-LPROC_TEST.json');
  });

  test('writes the complete response as UTF-8 JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-integration-export-'));
    const outputPath = path.join(tmpDir, 'nested', '自动化.json');
    const response = { success: true, content: '{"schema":{}}' };
    try {
      writeJsonFile(outputPath, response);
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(response);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
