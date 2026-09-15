'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findRawOperation,
  parseExportOptions,
  parseRawOperations,
  resolveExportPath,
  writeJsonFile,
} = require('../lib/connector/connector-export-utils');

describe('connector raw export', () => {
  test('parses export arguments without changing positional values', () => {
    expect(parseExportOptions(['916783'])).toEqual({
      connectorId: '916783',
      help: false,
      outputPath: '',
    });
    expect(parseExportOptions(
      ['916783', 'process_reconcileAttempt'],
      { requireOperationId: true }
    )).toEqual({
      connectorId: '916783',
      operationId: 'process_reconcileAttempt',
      help: false,
      outputPath: '',
    });
    expect(parseExportOptions(
      ['916783', 'process_reconcileAttempt', './action.json'],
      { requireOperationId: true }
    ).outputPath).toBe('./action.json');
  });

  test('selects the exact raw action without normalization', () => {
    const raw = [{
      operationId: 'process_reconcileAttempt',
      inputs: [{ name: 'Body', componentName: 'TextArea', childList: [] }],
    }];
    const operations = parseRawOperations(JSON.stringify(raw));
    expect(findRawOperation(operations, 'process_reconcileAttempt')).toStrictEqual(raw[0]);
    expect(operations[0].inputs[0].componentName).toBe('TextArea');
  });

  test('rejects options that could make the export differ from the source', () => {
    expect(() => parseExportOptions(['916783', '--redact'])).toThrow('未知参数: --redact');
  });

  test('writes UTF-8 JSON to the requested output file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-connector-export-'));
    const outputPath = path.join(tmpDir, 'nested', '动作.json');
    try {
      writeJsonFile(outputPath, { summary: '对账流程实例' });
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual({ summary: '对账流程实例' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('builds a useful default filename', () => {
    expect(path.basename(resolveExportPath({ connectorId: '916783' })))
      .toBe('connector-916783.json');
    expect(path.basename(resolveExportPath({
      connectorId: '916783',
      operationId: 'process/reconcileAttempt',
    }))).toBe('connector-916783-process_reconcileAttempt.json');
  });
});
