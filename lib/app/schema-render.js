'use strict';

const fs = require('fs');
const path = require('path');
const { applyTemplateVariables } = require('../core/sample');
const { findProjectRoot } = require('../core/utils');
const { error, success, hint, result, warn } = require('../core/chalk');
const { runLintCheck } = require('./page-linter');
const { compileSource } = require('./page-compiler');
const { buildPageFile, isAuthoringPath } = require('./page-compat');

const SUPPORTED_SCHEMA_TYPES = ['DataList', 'DetailCard', 'FormPanel', 'StatBoard', 'ActionBar'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function printHelp() {
  console.log(`
用法:
  openyida schema-render generate <appType> <formUuid> [--type DataList] [--schema schema.json] [--output path] [--compile]
  openyida schema-render generate --schema schema.json [--output path] [--compile]
  openyida schema-render preview <schema.json> [--output preview.html]

示例:
  openyida schema-render generate APP_XXX FORM-YYY --type DataList --output project/pages/src/
  openyida schema-render generate --schema .cache/openyida/schema-render/customer-list.json --compile
  openyida schema-render preview .cache/openyida/schema-render/customer-list.json
`);
}

function parseOptions(args) {
  const options = {
    positionals: [],
    type: null,
    schema: null,
    output: null,
    title: null,
    pageSize: null,
    compile: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if ((arg === '--type' || arg === '-t') && args[index + 1]) {
      options.type = args[++index];
      continue;
    }

    if ((arg === '--schema' || arg === '-s') && args[index + 1]) {
      options.schema = args[++index];
      continue;
    }

    if ((arg === '--output' || arg === '-o') && args[index + 1]) {
      options.output = args[++index];
      continue;
    }

    if (arg === '--title' && args[index + 1]) {
      options.title = args[++index];
      continue;
    }

    if (arg === '--page-size' && args[index + 1]) {
      options.pageSize = Number(args[++index]);
      continue;
    }

    if (arg === '--compile') {
      options.compile = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    options.positionals.push(arg);
  }

  return options;
}

function ensureDirectory(filePath) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function slugify(value) {
  return String(value || 'schema-render')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'schema-render';
}

function isOutputFile(outputPath) {
  const ext = path.extname(outputPath || '').toLowerCase();
  return ['.js', '.jsx', '.ts', '.tsx'].includes(ext);
}

function resolveOutputPath(rawOutput, schema) {
  const defaultFile = `schema-render-${slugify(schema.type)}.oyd.jsx`;

  if (!rawOutput) {
    return path.join(findProjectRoot(), 'pages', 'src', defaultFile);
  }

  const resolved = path.resolve(rawOutput);
  if (isOutputFile(rawOutput)) {
    return resolved;
  }

  return path.join(resolved, defaultFile);
}

function getSchemaManifestPath(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.openyida-schema-render.json`);
}

function readJsonFile(filePath, label) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    error(`${label} 不存在：${resolvedPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  } catch (err) {
    error(`${label} 不是合法 JSON：${err.message}`);
  }
}

function clampPageSize(value) {
  const pageSize = Number(value || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(pageSize), MAX_PAGE_SIZE);
}

function normalizeOptionList(options) {
  return (options || []).map((option) => {
    if (option && typeof option === 'object') {
      return {
        label: option.label || option.text || option.value || '',
        value: option.value === undefined ? (option.label || option.text || '') : option.value,
      };
    }
    return { label: String(option), value: option };
  }).filter(option => option.label !== '');
}

function normalizeSchema(schema, defaults = {}) {
  const type = schema.type || defaults.type || 'DataList';
  const dataSource = Object.assign({}, schema.dataSource || {});

  if (defaults.appType && !dataSource.appType) {
    dataSource.appType = defaults.appType;
  }
  if (defaults.formUuid && !dataSource.formUuid) {
    dataSource.formUuid = defaults.formUuid;
  }

  const normalized = Object.assign({}, schema, {
    type,
    title: defaults.title || schema.title || defaultTitle(type),
    dataSource,
  });

  if (normalized.pagination || type === 'DataList') {
    normalized.pagination = Object.assign({}, normalized.pagination || {}, {
      pageSize: clampPageSize(defaults.pageSize || (normalized.pagination && normalized.pagination.pageSize)),
    });
  }

  if (type === 'DataList') {
    normalized.filters = normalizeFilters(normalized.filters);
    normalized.columns = normalizeColumns(normalized.columns);
    normalized.actions = normalizeActions(normalized.actions, [
      { label: '查看', type: 'link', action: 'detail' },
      { label: '编辑', type: 'link', action: 'edit' },
    ]);
  } else if (type === 'DetailCard') {
    normalized.fields = normalizeFields(normalized.fields || normalized.columns);
  } else if (type === 'FormPanel') {
    normalized.fields = normalizeFields(normalized.fields);
    normalized.submit = Object.assign({ label: '提交', mode: 'create' }, normalized.submit || {});
  } else if (type === 'StatBoard') {
    normalized.metrics = normalizeMetrics(normalized.metrics);
    normalized.filters = normalizeFilters(normalized.filters);
    normalized.pagination = Object.assign({}, normalized.pagination || {}, {
      pageSize: clampPageSize(defaults.pageSize || (normalized.pagination && normalized.pagination.pageSize) || MAX_PAGE_SIZE),
    });
  } else if (type === 'ActionBar') {
    normalized.actions = normalizeActions(normalized.actions, [
      { label: '刷新', type: 'primary', action: 'refresh' },
      { label: '导出', type: 'secondary', action: 'export' },
    ]);
  }

  return normalized;
}

function normalizeFilters(filters) {
  return (filters || []).map((filter) => Object.assign({
    type: 'text',
    label: filter.field || '筛选',
  }, filter, {
    options: normalizeOptionList(filter.options),
  }));
}

function normalizeColumns(columns) {
  return (columns || []).map((column) => Object.assign({
    label: column.field || '字段',
  }, column));
}

function normalizeFields(fields) {
  return (fields || []).map((field) => Object.assign({
    type: 'text',
    label: field.field || '字段',
    required: false,
  }, field, {
    options: normalizeOptionList(field.options),
  }));
}

function normalizeMetrics(metrics) {
  return (metrics || []).map((metric) => Object.assign({
    aggregate: 'count',
    label: metric.field || '指标',
  }, metric));
}

function normalizeActions(actions, fallback) {
  const list = actions && actions.length ? actions : fallback;
  return list.map((action) => Object.assign({
    type: 'secondary',
    action: 'custom',
  }, action));
}

function defaultTitle(type) {
  const titles = {
    DataList: '数据列表',
    DetailCard: '详情卡片',
    FormPanel: '表单面板',
    StatBoard: '统计面板',
    ActionBar: '操作栏',
  };
  return titles[type] || 'Schema Render';
}

function buildDefaultSchema(type, appType, formUuid, options = {}) {
  const base = {
    type,
    title: options.title || defaultTitle(type),
    dataSource: { appType, formUuid },
  };

  if (type === 'DataList') {
    return Object.assign(base, {
      filters: [
        { field: 'textField_name', label: '名称', type: 'text' },
        {
          field: 'selectField_status',
          label: '状态',
          type: 'select',
          options: [
            { label: '进行中', value: '进行中' },
            { label: '已完成', value: '已完成' },
          ],
        },
      ],
      columns: [
        { field: 'textField_name', label: '名称', width: 160 },
        { field: 'selectField_status', label: '状态', render: 'tag' },
        { field: 'dateField_createdAt', label: '创建时间', format: 'YYYY-MM-DD' },
      ],
      actions: [
        { label: '查看', type: 'link', action: 'detail' },
        { label: '编辑', type: 'link', action: 'edit' },
      ],
      pagination: { pageSize: clampPageSize(options.pageSize) },
    });
  }

  if (type === 'DetailCard') {
    return Object.assign(base, {
      formInstId: '',
      fields: [
        { field: 'textField_name', label: '名称' },
        { field: 'selectField_status', label: '状态', render: 'tag' },
        { field: 'textareaField_remark', label: '备注' },
      ],
    });
  }

  if (type === 'FormPanel') {
    return Object.assign(base, {
      fields: [
        { field: 'textField_name', label: '名称', type: 'text', required: true },
        {
          field: 'selectField_status',
          label: '状态',
          type: 'select',
          options: [
            { label: '进行中', value: '进行中' },
            { label: '已完成', value: '已完成' },
          ],
        },
        { field: 'textareaField_remark', label: '备注', type: 'textarea' },
      ],
      submit: { label: '提交', mode: 'create' },
    });
  }

  if (type === 'StatBoard') {
    return Object.assign(base, {
      filters: [],
      metrics: [
        { label: '记录数', aggregate: 'count', suffix: '条' },
        { label: '金额合计', field: 'numberField_amount', aggregate: 'sum', prefix: '¥' },
        { label: '平均金额', field: 'numberField_amount', aggregate: 'avg', prefix: '¥' },
      ],
      pagination: { pageSize: MAX_PAGE_SIZE },
    });
  }

  return Object.assign(base, {
    actions: [
      { label: '刷新', type: 'primary', action: 'refresh' },
      { label: '导出', type: 'secondary', action: 'export' },
      { label: '新建', type: 'primary', action: 'create' },
    ],
  });
}

function validateSchema(schema) {
  if (!SUPPORTED_SCHEMA_TYPES.includes(schema.type)) {
    error(`不支持的 Schema type：${schema.type}`, {
      hint: `支持的类型：${SUPPORTED_SCHEMA_TYPES.join(', ')}`,
    });
  }

  if (schema.type !== 'ActionBar') {
    const dataSource = schema.dataSource || {};
    if (!dataSource.formUuid) {
      error('schema.dataSource.formUuid 不能为空');
    }
    if (schema.type === 'FormPanel' && !dataSource.appType) {
      error('FormPanel schema.dataSource.appType 不能为空');
    }
  }

  if (schema.type === 'DataList' && (!schema.columns || schema.columns.length === 0)) {
    error('DataList schema.columns 至少需要 1 个字段');
  }

  if (schema.type === 'DetailCard' && (!schema.fields || schema.fields.length === 0)) {
    error('DetailCard schema.fields 至少需要 1 个字段');
  }

  if (schema.type === 'FormPanel' && (!schema.fields || schema.fields.length === 0)) {
    error('FormPanel schema.fields 至少需要 1 个字段');
  }

  if (schema.type === 'StatBoard' && (!schema.metrics || schema.metrics.length === 0)) {
    error('StatBoard schema.metrics 至少需要 1 个指标');
  }
}

function loadTemplate() {
  const templatePath = path.join(__dirname, '..', 'samples', 'yida-schema-render', 'schema-render-page.oyd.jsx');
  if (!fs.existsSync(templatePath)) {
    error(`SchemaRender 页面模板不存在：${templatePath}`);
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

function renderPageSource(schema) {
  return applyTemplateVariables(loadTemplate(), {
    PAGE_TITLE: escapeJsString(schema.title || defaultTitle(schema.type)),
    SCHEMA_JSON: JSON.stringify(schema, null, 2),
  });
}

function escapeJsString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function loadSchemaForGenerate(options, appType, formUuid) {
  const type = options.type || 'DataList';
  if (options.schema) {
    const schema = readJsonFile(options.schema, 'Schema 文件');
    return normalizeSchema(schema, {
      type: options.type || schema.type,
      appType,
      formUuid,
      title: options.title,
      pageSize: options.pageSize,
    });
  }

  if (!appType || !formUuid) {
    error('请提供 appType 和 formUuid，或使用 --schema 指定完整 Schema 文件', {
      hint: '示例：openyida schema-render generate APP_XXX FORM-YYY --type DataList --output project/pages/src/',
    });
  }

  return normalizeSchema(buildDefaultSchema(type, appType, formUuid, options), {
    type,
    appType,
    formUuid,
    title: options.title,
    pageSize: options.pageSize,
  });
}

async function runGenerate(args) {
  const options = parseOptions(args);
  if (options.help) {
    printHelp();
    return;
  }

  const [appType, formUuid] = options.positionals;
  const schema = loadSchemaForGenerate(options, appType, formUuid);
  validateSchema(schema);

  const outputPath = resolveOutputPath(options.output, schema);
  const manifestPath = getSchemaManifestPath(outputPath);
  const outputSource = renderPageSource(schema);

  ensureDirectory(outputPath);
  fs.writeFileSync(outputPath, outputSource, 'utf-8');
  fs.writeFileSync(manifestPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf-8');

  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      output: outputPath,
      manifest: manifestPath,
      type: schema.type,
    }, null, 2));
  } else {
    success(`SchemaRender 页面已生成：${outputPath}`);
    hint(`Schema 配置已写入：${manifestPath}`);
  }

  let checkPath = outputPath;
  let checkSource = outputSource;

  if (isAuthoringPath(outputPath)) {
    const buildResult = buildPageFile(outputPath);
    if (!buildResult.ok) {
      buildResult.errors.forEach((issue) => error(`${issue.code}: ${issue.message}`));
    }
    checkPath = buildResult.outputPath;
    checkSource = fs.readFileSync(checkPath, 'utf-8');
  }

  const lintPassed = runLintCheck(checkSource, checkPath);
  if (!lintPassed) {
    process.exit(1);
  }

  if (options.compile) {
    compileSource(checkPath);
  } else if (!options.json) {
    result(true, 'SchemaRender 生成完成', [
      ['Type', schema.type],
      ['Output', outputPath],
      ['Manifest', manifestPath],
      ['Next', `openyida compile ${checkPath}`],
    ]);
  }
}

function resolvePreviewOutput(rawOutput, schema) {
  if (rawOutput) {
    return path.resolve(rawOutput);
  }
  return path.resolve(
    '.cache',
    'openyida',
    'schema-render',
    `${slugify(schema.title || schema.type)}-preview.html`
  );
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sampleValue(field, index) {
  const label = field.label || field.field || '字段';
  if (field.type === 'select' && field.options && field.options.length) {
    return field.options[index % field.options.length].label;
  }
  if (/date/i.test(field.type || field.field || '')) {
    return '2026-05-27';
  }
  if (/number|amount|money|price/i.test(field.type || field.field || '')) {
    return String((index + 1) * 1200);
  }
  return `${label} ${index + 1}`;
}

function buildPreviewRows(schema) {
  const columns = schema.columns || schema.fields || [];
  return [0, 1, 2].map((rowIndex) => {
    const formData = {};
    columns.forEach((column) => {
      formData[column.field] = sampleValue(column, rowIndex);
    });
    return {
      formInstId: `FINST-DEMO-${rowIndex + 1}`,
      formData,
    };
  });
}

function renderPreviewFilters(filters) {
  if (!filters || filters.length === 0) {
    return '';
  }

  const controls = filters.map((filter) => {
    if (filter.type === 'select') {
      const options = (filter.options || []).map(option => `<option>${escapeHtml(option.label)}</option>`).join('');
      return `<label><span>${escapeHtml(filter.label)}</span><select><option>全部</option>${options}</select></label>`;
    }
    return `<label><span>${escapeHtml(filter.label)}</span><input placeholder="${escapeHtml(filter.label)}" /></label>`;
  }).join('');

  return `<div class="filters">${controls}<button>查询</button></div>`;
}

function renderPreviewTable(schema) {
  const rows = buildPreviewRows(schema);
  const columns = schema.columns || [];
  const head = columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = columns.map(column => `<td>${escapeHtml(row.formData[column.field])}</td>`).join('');
    return `<tr>${cells}<td class="actions">查看 编辑</td></tr>`;
  }).join('');
  return `<table><thead><tr>${head}<th>操作</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderPreviewDetail(schema) {
  const row = buildPreviewRows(schema)[0];
  return `<div class="detail-grid">${(schema.fields || []).map((field) => {
    return `<div class="detail-item"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(row.formData[field.field])}</strong></div>`;
  }).join('')}</div>`;
}

function renderPreviewForm(schema) {
  return `<div class="form-panel">${(schema.fields || []).map((field) => {
    if (field.type === 'textarea') {
      return `<label><span>${escapeHtml(field.label)}</span><textarea>${escapeHtml(sampleValue(field, 0))}</textarea></label>`;
    }
    if (field.type === 'select') {
      const options = (field.options || []).map(option => `<option>${escapeHtml(option.label)}</option>`).join('');
      return `<label><span>${escapeHtml(field.label)}</span><select>${options}</select></label>`;
    }
    return `<label><span>${escapeHtml(field.label)}</span><input value="${escapeHtml(sampleValue(field, 0))}" /></label>`;
  }).join('')}<button>提交</button></div>`;
}

function renderPreviewStats(schema) {
  return `<div class="stat-board">${(schema.metrics || []).map((metric, index) => {
    const value = metric.aggregate === 'count' ? '128' : String((index + 1) * 3860);
    return `<div class="stat-card"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.prefix || '')}${escapeHtml(value)}${escapeHtml(metric.suffix || '')}</strong></div>`;
  }).join('')}</div>`;
}

function renderPreviewActions(schema) {
  return `<div class="action-bar">${(schema.actions || []).map((action) => {
    const className = action.type === 'primary' ? 'primary' : 'secondary';
    return `<button class="${className}">${escapeHtml(action.label)}</button>`;
  }).join('')}</div>`;
}

function renderPreviewBody(schema) {
  if (schema.type === 'DataList') {
    return `${renderPreviewFilters(schema.filters)}${renderPreviewTable(schema)}`;
  }
  if (schema.type === 'DetailCard') {
    return renderPreviewDetail(schema);
  }
  if (schema.type === 'FormPanel') {
    return renderPreviewForm(schema);
  }
  if (schema.type === 'StatBoard') {
    return `${renderPreviewFilters(schema.filters)}${renderPreviewStats(schema)}`;
  }
  return renderPreviewActions(schema);
}

function buildPreviewHtml(schema) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(schema.title)} - SchemaRender Preview</title>
  <style>
    body { margin: 0; background: #f5f7fb; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    h1 { margin: 0 0 18px; font-size: 24px; }
    .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06); }
    .filters, .action-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
    label { display: grid; gap: 6px; min-width: 180px; font-size: 13px; color: #64748b; }
    input, select, textarea { min-height: 34px; border: 1px solid #d6dbe6; border-radius: 6px; padding: 6px 10px; color: #111827; background: #fff; box-sizing: border-box; }
    textarea { min-height: 84px; resize: vertical; }
    button { border: 1px solid #d6dbe6; border-radius: 6px; background: #fff; height: 34px; padding: 0 14px; cursor: pointer; }
    button.primary, .filters button, .form-panel button { border-color: #1677ff; background: #1677ff; color: #fff; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { border-bottom: 1px solid #edf0f5; padding: 12px 10px; text-align: left; font-size: 14px; }
    th { color: #64748b; font-weight: 600; background: #fafbff; }
    .actions { color: #1677ff; white-space: nowrap; }
    .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .detail-item, .stat-card { border: 1px solid #edf0f5; border-radius: 8px; padding: 14px; background: #fbfcff; }
    .detail-item span, .stat-card span { display: block; color: #64748b; font-size: 13px; margin-bottom: 8px; }
    .detail-item strong, .stat-card strong { font-size: 20px; color: #111827; }
    .form-panel { display: grid; gap: 14px; max-width: 640px; }
    .stat-board { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(schema.title)} <small>(${escapeHtml(schema.type)})</small></h1>
    <section class="panel">${renderPreviewBody(schema)}</section>
  </main>
</body>
</html>
`;
}

async function runPreview(args) {
  const options = parseOptions(args);
  if (options.help) {
    printHelp();
    return;
  }

  const schemaFile = options.positionals[0];
  if (!schemaFile) {
    error('请指定 schema 文件', {
      hint: '示例：openyida schema-render preview .cache/openyida/schema-render/customer-list.json',
    });
  }

  const schema = normalizeSchema(readJsonFile(schemaFile, 'Schema 文件'), {
    type: options.type,
    title: options.title,
    pageSize: options.pageSize,
  });
  validateSchema(schema);

  const outputPath = resolvePreviewOutput(options.output, schema);
  ensureDirectory(outputPath);
  fs.writeFileSync(outputPath, buildPreviewHtml(schema), 'utf-8');

  if (options.json) {
    console.log(JSON.stringify({ ok: true, output: outputPath, type: schema.type }, null, 2));
    return;
  }

  success(`SchemaRender 预览已生成：${outputPath}`);
  hint('直接用浏览器打开该 HTML 可查看本地静态预览；真实数据加载以发布后的宜搭页面为准。');
}

async function run(args) {
  const subCommand = args[0];
  const subArgs = args.slice(1);

  if (!subCommand || subCommand === '--help' || subCommand === '-h') {
    printHelp();
    return;
  }

  if (subCommand === 'generate') {
    await runGenerate(subArgs);
    return;
  }

  if (subCommand === 'preview') {
    await runPreview(subArgs);
    return;
  }

  warn(`未知的 schema-render 子命令：${subCommand}`);
  printHelp();
  process.exit(1);
}

module.exports = {
  SUPPORTED_SCHEMA_TYPES,
  buildDefaultSchema,
  buildPreviewHtml,
  getSchemaManifestPath,
  normalizeSchema,
  parseOptions,
  run,
  validateSchema,
};
