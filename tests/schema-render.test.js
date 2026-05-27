'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  SUPPORTED_SCHEMA_TYPES,
  buildDefaultSchema,
  buildPreviewHtml,
  normalizeSchema,
  validateSchema,
} = require('../lib/app/schema-render');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yida.js');

describe('schema-render command', () => {
  let tmpDir;
  let tmpHome;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-schema-render-'));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-schema-render-home-'));
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function cliEnv() {
    const env = {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      OPENYIDA_LANG: 'zh',
      OPENYIDA_SKIP_UPDATE_CHECK: '1',
      CI: '1',
    };

    for (const key of Object.keys(env)) {
      if (key.startsWith('CODEX') || key === 'AGENT_WORK_ROOT') {
        delete env[key];
      }
    }

    return env;
  }

  test('normalizes defaults and clamps page size', () => {
    const schema = normalizeSchema(buildDefaultSchema('DataList', 'APP_XXX', 'FORM-YYY', {
      pageSize: 200,
    }));

    expect(schema.type).toBe('DataList');
    expect(schema.dataSource.appType).toBe('APP_XXX');
    expect(schema.pagination.pageSize).toBe(100);
    expect(schema.columns.length).toBeGreaterThan(0);
  });

  test('declares all accepted schema types', () => {
    expect(SUPPORTED_SCHEMA_TYPES).toEqual([
      'DataList',
      'DetailCard',
      'FormPanel',
      'StatBoard',
      'ActionBar',
    ]);

    SUPPORTED_SCHEMA_TYPES.forEach((type) => {
      const schema = normalizeSchema(buildDefaultSchema(type, 'APP_XXX', 'FORM-YYY'));
      validateSchema(schema);
      expect(buildPreviewHtml(schema)).toContain(type);
    });
  });

  test('generates and compiles a DataList page from schema', () => {
    const schemaPath = path.join(tmpDir, 'customer-list.json');
    fs.writeFileSync(schemaPath, JSON.stringify({
      type: 'DataList',
      title: '客户列表',
      dataSource: {
        appType: 'APP_XXX',
        formUuid: 'FORM-YYY',
      },
      filters: [
        { field: 'textField_customerName', label: '客户名称', type: 'text' },
      ],
      columns: [
        { field: 'textField_customerName', label: '客户名称', width: 180 },
        { field: 'selectField_status', label: '状态', render: 'tag' },
      ],
      actions: [
        { label: '查看', type: 'link', action: 'detail' },
      ],
      pagination: { pageSize: 20 },
    }, null, 2), 'utf8');

    execFileSync(process.execPath, [
      BIN,
      'schema-render',
      'generate',
      '--schema',
      schemaPath,
      '--output',
      'pages/src/customer-list.oyd.jsx',
      '--compile',
    ], {
      cwd: tmpDir,
      env: cliEnv(),
      encoding: 'utf8',
      timeout: 15000,
    });

    const sourcePath = path.join(tmpDir, 'pages', 'src', 'customer-list.oyd.jsx');
    const buildPath = path.join(tmpDir, 'pages', 'build', 'customer-list.yida.jsx');
    const compiledPath = path.join(tmpDir, 'pages', 'dist', 'customer-list.yida.js');
    const manifestPath = path.join(tmpDir, 'pages', 'src', 'customer-list.oyd.openyida-schema-render.json');

    expect(fs.existsSync(sourcePath)).toBe(true);
    expect(fs.existsSync(buildPath)).toBe(true);
    expect(fs.existsSync(compiledPath)).toBe(true);
    expect(fs.existsSync(manifestPath)).toBe(true);

    const source = fs.readFileSync(sourcePath, 'utf8');
    expect(source).toContain('export function SchemaRender');
    expect(source).toContain('"type": "DataList"');
    expect(source).toContain('this.utils.yida.searchFormDatas');
    expect(source).not.toContain('{{SCHEMA_JSON}}');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.type).toBe('DataList');
    expect(manifest.pagination.pageSize).toBe(20);
    expect(fs.statSync(compiledPath).size).toBeGreaterThan(1000);
  });

  test('generates local preview html', () => {
    const schema = normalizeSchema(buildDefaultSchema('FormPanel', 'APP_XXX', 'FORM-YYY'));
    const html = buildPreviewHtml(schema);

    expect(html).toContain('表单面板');
    expect(html).toContain('SchemaRender Preview');
    expect(html).toContain('<textarea');
  });

  test('copies schema-render sample files', () => {
    const samplePath = path.join(tmpDir, 'data-list.schema.json');
    execFileSync(process.execPath, [
      BIN,
      'sample',
      'yida-schema-render',
      'data-list',
      '--output',
      samplePath,
    ], {
      cwd: tmpDir,
      env: cliEnv(),
      encoding: 'utf8',
      timeout: 10000,
    });

    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    expect(sample.type).toBe('DataList');
    expect(sample.columns.length).toBeGreaterThan(0);
  });
});
