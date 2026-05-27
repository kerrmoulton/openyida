/**
 * SchemaRender custom page template
 * @openyida-template yida-schema-render
 * @openyida-schema-render 1.0
 *
 * 生成示例：
 * openyida schema-render generate APP_XXX FORM-YYY --type DataList --output project/pages/src/ --compile
 */

var PAGE_TITLE = '{{PAGE_TITLE}}';
var SCHEMA_RENDER_SCHEMA = {{SCHEMA_JSON}};

var _customState = {
  schemaRender: {},
};

function getSchemaKey(schema) {
  if (!schema) {
    return 'default';
  }
  return schema.id || schema.key || schema.type || 'default';
}

function cloneObject(value) {
  return Object.assign({}, value || {});
}

function getPageSize(schema) {
  var pageSize = schema && schema.pagination ? Number(schema.pagination.pageSize || 20) : 20;
  if (!pageSize || pageSize < 1) {
    pageSize = 20;
  }
  return Math.min(pageSize, 100);
}

function makeInitialSchemaState(schema) {
  return {
    loading: false,
    error: '',
    rows: [],
    total: 0,
    currentPage: 1,
    filters: {},
    formDraft: {},
    formInstId: schema && schema.formInstId ? schema.formInstId : '',
    detailRecord: null,
    metrics: [],
    selectOpen: '',
    formVersion: 1,
  };
}

function normalizeListResponse(res) {
  var content = res && res.content ? res.content : {};
  return {
    rows: (res && res.data) || content.data || [],
    total: (res && res.totalCount) || content.totalCount || 0,
    currentPage: (res && res.currentPage) || content.currentPage || 1,
  };
}

function getRecordData(record) {
  return record && record.formData ? record.formData : (record || {});
}

function normalizeValue(value) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)).join('、');
  }
  if (typeof value === 'object') {
    if (value.label || value.text || value.name) {
      return value.label || value.text || value.name;
    }
    if (value.zh_CN || value.en_US) {
      return value.zh_CN || value.en_US;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function padTwoDigits(value) {
  return value < 10 ? '0' + value : String(value);
}

function formatDateValue(value) {
  if (!value) {
    return '-';
  }
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) {
    return normalizeValue(value);
  }
  var month = padTwoDigits(date.getMonth() + 1);
  var day = padTwoDigits(date.getDate());
  return [date.getFullYear(), month, day].join('-');
}

function getFieldValue(record, config) {
  var data = getRecordData(record);
  var value = data[config.field];
  if (config.format && /Y{2,4}-M{2}-D{2}/.test(config.format)) {
    return formatDateValue(value);
  }
  return normalizeValue(value);
}

function renderTag(value) {
  return <span style={schemaStyles.tag}>{value}</span>;
}

function renderCellValue(record, column) {
  var value = getFieldValue(record, column);
  if (column.render === 'tag') {
    return renderTag(value);
  }
  return value;
}

function metricNumber(value) {
  var numberValue = Number(value);
  return isNaN(numberValue) ? 0 : numberValue;
}

function aggregateMetric(rows, metric) {
  if (metric.aggregate === 'count') {
    return rows.length;
  }
  var values = rows.map((row) => metricNumber(getRecordData(row)[metric.field]));
  var sum = values.reduce((total, item) => total + item, 0);
  if (metric.aggregate === 'avg') {
    return values.length ? Math.round((sum / values.length) * 100) / 100 : 0;
  }
  return sum;
}

function getToastMessage(err, fallback) {
  return (err && (err.message || err.msg)) || fallback;
}

export function getCustomState(key) {
  if (key) {
    return _customState[key];
  }
  return Object.assign({}, _customState);
}

export function setCustomState(newState) {
  Object.keys(newState || {}).forEach((key) => {
    _customState[key] = newState[key];
  });
  this.forceUpdate();
}

export function forceUpdate() {
  this.setState({ timestamp: new Date().getTime() });
}

export function getSchemaState(schema) {
  var key = getSchemaKey(schema);
  if (!_customState.schemaRender[key]) {
    _customState.schemaRender[key] = makeInitialSchemaState(schema);
  }
  return _customState.schemaRender[key];
}

export function patchSchemaState(schema, patch) {
  var key = getSchemaKey(schema);
  var current = this.getSchemaState(schema);
  _customState.schemaRender[key] = Object.assign({}, current, patch || {});
  this.forceUpdate();
}

export function showSchemaError(schema, err, fallback) {
  var message = getToastMessage(err, fallback || '操作失败');
  this.patchSchemaState(schema, { loading: false, error: message });
  if (this.utils && this.utils.toast) {
    this.utils.toast({ title: message, type: 'error' });
  }
}

export function buildSchemaSearchFieldJson(schema, filters) {
  var search = {};
  (schema.filters || []).forEach((filter) => {
    var value = filters ? filters[filter.field] : undefined;
    if (value === undefined || value === null || value === '') {
      return;
    }
    search[filter.field] = value;
  });
  return Object.keys(search).length ? JSON.stringify(search) : '';
}

export function updateSchemaFilter(schema, field, value) {
  var state = this.getSchemaState(schema);
  var filters = cloneObject(state.filters);
  filters[field] = value;
  _customState.schemaRender[getSchemaKey(schema)] = Object.assign({}, state, { filters: filters });
}

export function updateSchemaDraft(schema, field, value) {
  var state = this.getSchemaState(schema);
  var formDraft = cloneObject(state.formDraft);
  formDraft[field] = value;
  _customState.schemaRender[getSchemaKey(schema)] = Object.assign({}, state, { formDraft: formDraft });
}

export function toggleSchemaSelect(schema, selectKey) {
  var state = this.getSchemaState(schema);
  this.patchSchemaState(schema, {
    selectOpen: state.selectOpen === selectKey ? '' : selectKey,
  });
}

export function chooseSchemaFilterOption(schema, field, value) {
  var state = this.getSchemaState(schema);
  var filters = cloneObject(state.filters);
  filters[field] = value;
  this.patchSchemaState(schema, {
    filters: filters,
    selectOpen: '',
  });
}

export function chooseSchemaDraftOption(schema, field, value) {
  var state = this.getSchemaState(schema);
  var formDraft = cloneObject(state.formDraft);
  formDraft[field] = value;
  this.patchSchemaState(schema, {
    formDraft: formDraft,
    selectOpen: '',
  });
}

export function collectSchemaFormValues(schema) {
  var state = this.getSchemaState(schema);
  var draft = cloneObject(state.formDraft);
  var payload = {};
  (schema.fields || []).forEach((field) => {
    if (draft[field.field] !== undefined) {
      payload[field.field] = draft[field.field];
    } else if (field.defaultValue !== undefined) {
      payload[field.field] = field.defaultValue;
    }
  });
  return payload;
}

export function loadSchemaData(schema) {
  if (!schema) {
    return Promise.resolve();
  }
  if (schema.type === 'DataList') {
    return this.loadSchemaList(schema, 1);
  }
  if (schema.type === 'DetailCard') {
    return this.loadSchemaDetail(schema);
  }
  if (schema.type === 'StatBoard') {
    return this.loadSchemaStats(schema);
  }
  return Promise.resolve();
}

export function loadSchemaList(schema, page) {
  if (!this.utils || !this.utils.yida || !this.utils.yida.searchFormDatas) {
    this.patchSchemaState(schema, { error: '当前环境未提供 this.utils.yida.searchFormDatas' });
    return Promise.resolve();
  }

  var state = this.getSchemaState(schema);
  var currentPage = page || state.currentPage || 1;
  var params = {
    formUuid: schema.dataSource.formUuid,
    searchFieldJson: this.buildSchemaSearchFieldJson(schema, state.filters),
    currentPage: currentPage,
    pageSize: getPageSize(schema),
  };

  this.patchSchemaState(schema, { loading: true, error: '', currentPage: currentPage });
  return this.utils.yida.searchFormDatas(params).then((res) => {
    var data = normalizeListResponse(res);
    this.patchSchemaState(schema, {
      loading: false,
      rows: data.rows,
      total: data.total,
      currentPage: data.currentPage || currentPage,
    });
  }).catch((err) => {
    this.showSchemaError(schema, err, '列表数据加载失败');
  });
}

export function loadSchemaDetail(schema) {
  var state = this.getSchemaState(schema);
  var formInstId = schema.formInstId || state.formInstId || (this.state && this.state.urlParams && this.state.urlParams.formInstId);

  if (!formInstId) {
    this.patchSchemaState(schema, { detailRecord: schema.previewData || null });
    return Promise.resolve();
  }

  if (!this.utils || !this.utils.yida || !this.utils.yida.getFormDataById) {
    this.patchSchemaState(schema, { error: '当前环境未提供 this.utils.yida.getFormDataById' });
    return Promise.resolve();
  }

  this.patchSchemaState(schema, { loading: true, error: '', formInstId: formInstId });
  return this.utils.yida.getFormDataById({ formInstId: formInstId }).then((res) => {
    this.patchSchemaState(schema, {
      loading: false,
      detailRecord: (res && (res.data || res.content || res.result)) || res,
    });
  }).catch((err) => {
    this.showSchemaError(schema, err, '详情数据加载失败');
  });
}

export function loadSchemaStats(schema) {
  if (!this.utils || !this.utils.yida || !this.utils.yida.searchFormDatas) {
    this.patchSchemaState(schema, { error: '当前环境未提供 this.utils.yida.searchFormDatas' });
    return Promise.resolve();
  }

  var state = this.getSchemaState(schema);
  var params = {
    formUuid: schema.dataSource.formUuid,
    searchFieldJson: this.buildSchemaSearchFieldJson(schema, state.filters),
    currentPage: 1,
    pageSize: getPageSize(schema),
  };

  this.patchSchemaState(schema, { loading: true, error: '' });
  return this.utils.yida.searchFormDatas(params).then((res) => {
    var data = normalizeListResponse(res);
    var metrics = (schema.metrics || []).map((metric) => {
      return Object.assign({}, metric, {
        value: aggregateMetric(data.rows, metric),
      });
    });
    this.patchSchemaState(schema, {
      loading: false,
      rows: data.rows,
      total: data.total,
      metrics: metrics,
    });
  }).catch((err) => {
    this.showSchemaError(schema, err, '统计数据加载失败');
  });
}

export function handleSchemaSearch(schema) {
  if (schema.type === 'StatBoard') {
    return this.loadSchemaStats(schema);
  }
  return this.loadSchemaList(schema, 1);
}

export function changeSchemaPage(schema, nextPage) {
  if (nextPage < 1) {
    return;
  }
  this.loadSchemaList(schema, nextPage);
}

export function resetSchemaForm(schema) {
  var state = this.getSchemaState(schema);
  this.patchSchemaState(schema, {
    formDraft: {},
    formVersion: state.formVersion + 1,
  });
}

export function submitSchemaForm(schema) {
  var payload = this.collectSchemaFormValues(schema);
  var missingField = (schema.fields || []).find((field) => {
    return field.required && (payload[field.field] === undefined || payload[field.field] === null || payload[field.field] === '');
  });

  if (missingField) {
    if (this.utils && this.utils.toast) {
      this.utils.toast({ title: missingField.label + '不能为空', type: 'warning' });
    }
    return Promise.resolve();
  }

  if (!this.utils || !this.utils.yida) {
    this.patchSchemaState(schema, { error: '当前环境未提供 this.utils.yida' });
    return Promise.resolve();
  }

  var state = this.getSchemaState(schema);
  var submit = schema.submit || {};
  var formInstId = submit.formInstId || state.formInstId || schema.formInstId;
  var isUpdate = submit.mode === 'update' || !!formInstId;

  this.patchSchemaState(schema, { loading: true, error: '' });

  if (isUpdate) {
    if (!this.utils.yida.updateFormData) {
      this.patchSchemaState(schema, { loading: false, error: '当前环境未提供 this.utils.yida.updateFormData' });
      return Promise.resolve();
    }

    return this.utils.yida.updateFormData({
      formInstId: formInstId,
      updateFormDataJson: JSON.stringify(payload),
      useLatestVersion: 'y',
    }).then((res) => {
      this.patchSchemaState(schema, { loading: false });
      if (this.utils && this.utils.toast) {
        this.utils.toast({ title: '更新成功', type: 'success' });
      }
      return res;
    }).catch((err) => {
      this.showSchemaError(schema, err, '更新失败');
    });
  }

  if (!this.utils.yida.saveFormData) {
    this.patchSchemaState(schema, { loading: false, error: '当前环境未提供 this.utils.yida.saveFormData' });
    return Promise.resolve();
  }

  return this.utils.yida.saveFormData({
    appType: schema.dataSource.appType,
    formUuid: schema.dataSource.formUuid,
    formDataJson: JSON.stringify(payload),
  }).then((res) => {
    this.patchSchemaState(schema, { loading: false });
    if (this.utils && this.utils.toast) {
      this.utils.toast({ title: '提交成功', type: 'success' });
    }
    return res;
  }).catch((err) => {
    this.showSchemaError(schema, err, '提交失败');
  });
}

export function handleSchemaAction(schema, action, record) {
  if (action && action.handler && typeof this[action.handler] === 'function') {
    return this[action.handler](record, action, schema);
  }

  if (action && action.action === 'refresh') {
    return this.loadSchemaData(schema);
  }

  if (action && action.action === 'detail') {
    this.patchSchemaState(schema, { detailRecord: record });
    if (this.utils && this.utils.toast) {
      this.utils.toast({ title: '已选中记录，可在自定义区域读取 detailRecord', type: 'success' });
    }
    return Promise.resolve(record);
  }

  if (action && action.url) {
    window.open(action.url, action.target || '_blank');
    return Promise.resolve();
  }

  if (this.utils && this.utils.toast) {
    this.utils.toast({ title: action && action.label ? action.label : '操作已触发', type: 'success' });
  }
  return Promise.resolve(record);
}

export function didMount() {
  this.loadSchemaData(SCHEMA_RENDER_SCHEMA);
}

export function didUnmount() {}

function renderError(errorText) {
  if (!errorText) {
    return null;
  }
  return <div style={schemaStyles.error}>{errorText}</div>;
}

function renderEmpty(text) {
  return <div style={schemaStyles.empty}>{text || '暂无数据'}</div>;
}

function findOptionLabel(options, value, placeholder) {
  if (value === undefined || value === null || value === '') {
    return placeholder;
  }
  var matched = (options || []).find((option) => String(option.value) === String(value));
  return matched ? matched.label : normalizeValue(value);
}

function renderCustomSelect(config) {
  var options = config.options || [];
  var open = config.state.selectOpen === config.selectKey;
  return (
    <div style={schemaStyles.customSelect}>
      <button
        style={schemaStyles.customSelectButton}
        onClick={(e) => { config.ctx.toggleSchemaSelect(config.schema, config.selectKey); }}
      >
        <span>{findOptionLabel(options, config.value, config.placeholder)}</span>
        <span style={schemaStyles.customSelectArrow}>{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <div style={schemaStyles.customSelectMenu}>
          <button
            style={schemaStyles.customSelectOption}
            onClick={(e) => { config.onChoose(''); }}
          >
            {config.emptyLabel || '全部'}
          </button>
          {options.map((option) => (
            <button
              key={String(option.value)}
              style={schemaStyles.customSelectOption}
              onClick={(e) => { config.onChoose(option.value); }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderFilter(schema, filter, ctx, state) {
  var value = state.filters[filter.field] || '';
  if (filter.type === 'select') {
    return (
      <label key={filter.field} style={schemaStyles.filterItem}>
        <span style={schemaStyles.labelText}>{filter.label}</span>
        {renderCustomSelect({
          schema: schema,
          ctx: ctx,
          state: state,
          selectKey: 'filter:' + filter.field,
          options: filter.options,
          value: value,
          placeholder: '全部',
          emptyLabel: '全部',
          onChoose: (nextValue) => { ctx.chooseSchemaFilterOption(schema, filter.field, nextValue); },
        })}
      </label>
    );
  }

  return (
    <label key={filter.field} style={schemaStyles.filterItem}>
      <span style={schemaStyles.labelText}>{filter.label}</span>
      <input
        defaultValue={value}
        placeholder={filter.placeholder || filter.label}
        style={schemaStyles.input}
        onChange={(e) => { ctx.updateSchemaFilter(schema, filter.field, e.target.value); }}
      />
    </label>
  );
}

function renderFilters(schema, ctx, state) {
  if (!schema.filters || schema.filters.length === 0) {
    return null;
  }
  return (
    <div style={schemaStyles.filters}>
      {schema.filters.map((filter) => renderFilter(schema, filter, ctx, state))}
      <button style={schemaStyles.primaryButton} onClick={(e) => { ctx.handleSchemaSearch(schema); }}>查询</button>
    </div>
  );
}

function renderDataList(schema, ctx, state) {
  var rows = state.rows || [];
  var columns = schema.columns || [];
  var pageSize = getPageSize(schema);
  var currentPage = state.currentPage || 1;
  var hasPrev = currentPage > 1;
  var hasNext = currentPage * pageSize < (state.total || 0);

  return (
    <div>
      {renderFilters(schema, ctx, state)}
      {renderError(state.error)}
      <div style={schemaStyles.tableWrap}>
        <table style={schemaStyles.table}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.field} style={Object.assign({}, schemaStyles.th, column.width ? { width: column.width } : {})}>{column.label}</th>
              ))}
              {(schema.actions || []).length ? <th style={schemaStyles.th}>操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.formInstId || rowIndex}>
                {columns.map((column) => (
                  <td key={column.field} style={schemaStyles.td}>{renderCellValue(row, column)}</td>
                ))}
                {(schema.actions || []).length ? (
                  <td style={schemaStyles.td}>
                    <div style={schemaStyles.rowActions}>
                      {(schema.actions || []).map((action, actionIndex) => (
                        <button
                          key={action.label || actionIndex}
                          style={schemaStyles.linkButton}
                          onClick={(e) => { ctx.handleSchemaAction(schema, action, row); }}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {!state.loading && rows.length === 0 ? renderEmpty(schema.emptyText) : null}
      </div>
      <div style={schemaStyles.pagination}>
        <span>共 {state.total || 0} 条</span>
        <button
          style={hasPrev ? schemaStyles.secondaryButton : schemaStyles.disabledButton}
          disabled={!hasPrev}
          onClick={(e) => { ctx.changeSchemaPage(schema, currentPage - 1); }}
        >
          上一页
        </button>
        <span>第 {currentPage} 页</span>
        <button
          style={hasNext ? schemaStyles.secondaryButton : schemaStyles.disabledButton}
          disabled={!hasNext}
          onClick={(e) => { ctx.changeSchemaPage(schema, currentPage + 1); }}
        >
          下一页
        </button>
      </div>
      {state.loading ? <div style={schemaStyles.loading}>数据加载中...</div> : null}
    </div>
  );
}

function renderDetailCard(schema, state) {
  var record = state.detailRecord || schema.previewData || {};
  return (
    <div>
      {renderError(state.error)}
      <div style={schemaStyles.detailGrid}>
        {(schema.fields || []).map((field) => (
          <div key={field.field} style={schemaStyles.detailItem}>
            <div style={schemaStyles.detailLabel}>{field.label}</div>
            <div style={schemaStyles.detailValue}>{field.render === 'tag' ? renderTag(getFieldValue(record, field)) : getFieldValue(record, field)}</div>
          </div>
        ))}
      </div>
      {state.loading ? <div style={schemaStyles.loading}>详情加载中...</div> : null}
    </div>
  );
}

function renderFormField(schema, field, ctx, state) {
  var key = state.formVersion + '-' + field.field;
  var initialValue = state.formDraft[field.field] !== undefined ? state.formDraft[field.field] : (field.defaultValue || '');

  if (field.type === 'textarea') {
    return (
      <label key={field.field} style={schemaStyles.formItem}>
        <span style={schemaStyles.labelText}>{field.label}{field.required ? ' *' : ''}</span>
        <textarea
          key={key}
          defaultValue={initialValue}
          placeholder={field.placeholder || field.label}
          style={schemaStyles.textarea}
          onChange={(e) => { ctx.updateSchemaDraft(schema, field.field, e.target.value); }}
        />
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label key={field.field} style={schemaStyles.formItem}>
        <span style={schemaStyles.labelText}>{field.label}{field.required ? ' *' : ''}</span>
        <div key={key}>
          {renderCustomSelect({
            schema: schema,
            ctx: ctx,
            state: state,
            selectKey: 'draft:' + field.field,
            options: field.options,
            value: initialValue,
            placeholder: '请选择',
            emptyLabel: '请选择',
            onChoose: (nextValue) => { ctx.chooseSchemaDraftOption(schema, field.field, nextValue); },
          })}
        </div>
      </label>
    );
  }

  return (
    <label key={field.field} style={schemaStyles.formItem}>
      <span style={schemaStyles.labelText}>{field.label}{field.required ? ' *' : ''}</span>
      <input
        key={key}
        type={field.type === 'number' ? 'number' : 'text'}
        defaultValue={initialValue}
        placeholder={field.placeholder || field.label}
        style={schemaStyles.input}
        onChange={(e) => { ctx.updateSchemaDraft(schema, field.field, e.target.value); }}
      />
    </label>
  );
}

function renderFormPanel(schema, ctx, state) {
  return (
    <div>
      {renderError(state.error)}
      <div style={schemaStyles.formGrid}>
        {(schema.fields || []).map((field) => renderFormField(schema, field, ctx, state))}
      </div>
      <div style={schemaStyles.formActions}>
        <button style={schemaStyles.primaryButton} onClick={(e) => { ctx.submitSchemaForm(schema); }}>
          {(schema.submit && schema.submit.label) || '提交'}
        </button>
        <button style={schemaStyles.secondaryButton} onClick={(e) => { ctx.resetSchemaForm(schema); }}>重置</button>
      </div>
      {state.loading ? <div style={schemaStyles.loading}>提交中...</div> : null}
    </div>
  );
}

function renderStatBoard(schema, ctx, state) {
  var metrics = state.metrics && state.metrics.length ? state.metrics : (schema.metrics || []).map((metric) => Object.assign({}, metric, { value: 0 }));
  return (
    <div>
      {renderFilters(schema, ctx, state)}
      {renderError(state.error)}
      <div style={schemaStyles.statGrid}>
        {metrics.map((metric, index) => (
          <div key={metric.label || index} style={schemaStyles.statCard}>
            <div style={schemaStyles.statLabel}>{metric.label}</div>
            <div style={schemaStyles.statValue}>
              {metric.prefix || ''}{normalizeValue(metric.value)}{metric.suffix || ''}
            </div>
            {metric.description ? <div style={schemaStyles.statDescription}>{metric.description}</div> : null}
          </div>
        ))}
      </div>
      {state.loading ? <div style={schemaStyles.loading}>统计加载中...</div> : null}
    </div>
  );
}

function renderActionBar(schema, ctx) {
  return (
    <div style={schemaStyles.actionBar}>
      {(schema.actions || []).map((action, index) => (
        <button
          key={action.label || index}
          style={action.type === 'primary' ? schemaStyles.primaryButton : schemaStyles.secondaryButton}
          onClick={(e) => { ctx.handleSchemaAction(schema, action, null); }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function SchemaRender(props) {
  var schema = props.schema || {};
  var ctx = props.context || {};
  var state = ctx.getSchemaState ? ctx.getSchemaState(schema) : makeInitialSchemaState(schema);
  var body = null;

  if (schema.type === 'DataList') {
    body = renderDataList(schema, ctx, state);
  } else if (schema.type === 'DetailCard') {
    body = renderDetailCard(schema, state);
  } else if (schema.type === 'FormPanel') {
    body = renderFormPanel(schema, ctx, state);
  } else if (schema.type === 'StatBoard') {
    body = renderStatBoard(schema, ctx, state);
  } else if (schema.type === 'ActionBar') {
    body = renderActionBar(schema, ctx);
  } else {
    body = renderEmpty('不支持的 Schema 类型：' + normalizeValue(schema.type));
  }

  return (
    <section style={schemaStyles.panel}>
      <div style={schemaStyles.header}>
        <div>
          <h2 style={schemaStyles.title}>{schema.title || PAGE_TITLE}</h2>
          {schema.description ? <p style={schemaStyles.description}>{schema.description}</p> : null}
        </div>
        <span style={schemaStyles.typePill}>{schema.type}</span>
      </div>
      {body}
    </section>
  );
}

export function renderJsx() {
  var self = this;
  return (
    <main style={schemaStyles.page}>
      <div style={{ display: 'none' }}>{this.state && this.state.timestamp}</div>
      <SchemaRender schema={SCHEMA_RENDER_SCHEMA} context={self} />
    </main>
  );
}

var schemaStyles = {
  page: {
    minHeight: '100vh',
    boxSizing: 'border-box',
    padding: 20,
    backgroundColor: '#f5f7fb',
    color: '#1f2937',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  panel: {
    maxWidth: 1180,
    margin: '0 auto',
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 20,
    boxShadow: '0 8px 22px rgba(15, 23, 42, 0.06)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 18,
  },
  title: {
    margin: 0,
    fontSize: 22,
    lineHeight: 1.3,
    fontWeight: 700,
    color: '#111827',
  },
  description: {
    margin: '6px 0 0',
    color: '#64748b',
    fontSize: 14,
    lineHeight: 1.6,
  },
  typePill: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 26,
    padding: '0 10px',
    borderRadius: 6,
    backgroundColor: '#eef5ff',
    color: '#1677ff',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 12,
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#f8fafc',
    border: '1px solid #eef2f7',
    borderRadius: 8,
  },
  filterItem: {
    display: 'grid',
    gap: 6,
    minWidth: 180,
  },
  labelText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 600,
  },
  input: {
    width: '100%',
    height: 34,
    boxSizing: 'border-box',
    padding: '0 10px',
    border: '1px solid #d6dbe6',
    borderRadius: 6,
    backgroundColor: '#fff',
    color: '#111827',
    outline: 'none',
  },
  select: {
    width: '100%',
    height: 34,
    boxSizing: 'border-box',
    padding: '0 8px',
    border: '1px solid #d6dbe6',
    borderRadius: 6,
    backgroundColor: '#fff',
    color: '#111827',
    outline: 'none',
  },
  customSelect: {
    position: 'relative',
    width: '100%',
  },
  customSelectButton: {
    width: '100%',
    height: 34,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '0 10px',
    border: '1px solid #d6dbe6',
    borderRadius: 6,
    backgroundColor: '#fff',
    color: '#111827',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 14,
  },
  customSelectArrow: {
    flexShrink: 0,
    color: '#94a3b8',
    fontSize: 10,
  },
  customSelectMenu: {
    position: 'absolute',
    zIndex: 20,
    top: 38,
    left: 0,
    right: 0,
    maxHeight: 220,
    overflowY: 'auto',
    border: '1px solid #d6dbe6',
    borderRadius: 6,
    backgroundColor: '#fff',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
  },
  customSelectOption: {
    display: 'block',
    width: '100%',
    minHeight: 32,
    padding: '7px 10px',
    border: 0,
    borderBottom: '1px solid #f1f5f9',
    backgroundColor: '#fff',
    color: '#111827',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 14,
  },
  textarea: {
    width: '100%',
    minHeight: 86,
    boxSizing: 'border-box',
    padding: '8px 10px',
    border: '1px solid #d6dbe6',
    borderRadius: 6,
    backgroundColor: '#fff',
    color: '#111827',
    lineHeight: 1.6,
    resize: 'vertical',
    outline: 'none',
  },
  primaryButton: {
    height: 34,
    border: '1px solid #1677ff',
    borderRadius: 6,
    padding: '0 14px',
    backgroundColor: '#1677ff',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
  secondaryButton: {
    height: 34,
    border: '1px solid #d6dbe6',
    borderRadius: 6,
    padding: '0 14px',
    backgroundColor: '#fff',
    color: '#1f2937',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
  disabledButton: {
    height: 34,
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '0 14px',
    backgroundColor: '#f3f4f6',
    color: '#9ca3af',
    cursor: 'not-allowed',
    fontSize: 14,
    fontWeight: 600,
  },
  linkButton: {
    border: 0,
    padding: 0,
    backgroundColor: 'transparent',
    color: '#1677ff',
    cursor: 'pointer',
    fontSize: 13,
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid #eef2f7',
    borderRadius: 8,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
  },
  th: {
    padding: '11px 10px',
    textAlign: 'left',
    color: '#64748b',
    backgroundColor: '#f8fafc',
    borderBottom: '1px solid #eef2f7',
    fontSize: 13,
    fontWeight: 700,
  },
  td: {
    padding: '12px 10px',
    borderBottom: '1px solid #f1f5f9',
    color: '#1f2937',
    fontSize: 14,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 22,
    padding: '0 8px',
    borderRadius: 6,
    backgroundColor: '#eef5ff',
    color: '#1677ff',
    fontSize: 12,
    fontWeight: 700,
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
    color: '#64748b',
    fontSize: 13,
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
  },
  detailItem: {
    minHeight: 76,
    boxSizing: 'border-box',
    padding: 14,
    border: '1px solid #eef2f7',
    borderRadius: 8,
    backgroundColor: '#fbfcff',
  },
  detailLabel: {
    marginBottom: 8,
    color: '#64748b',
    fontSize: 13,
    fontWeight: 600,
  },
  detailValue: {
    color: '#111827',
    fontSize: 16,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 14,
  },
  formItem: {
    display: 'grid',
    gap: 6,
  },
  formActions: {
    display: 'flex',
    gap: 10,
    marginTop: 16,
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14,
  },
  statCard: {
    padding: 16,
    border: '1px solid #eef2f7',
    borderRadius: 8,
    backgroundColor: '#fbfcff',
  },
  statLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 8,
  },
  statValue: {
    color: '#111827',
    fontSize: 28,
    lineHeight: 1.2,
    fontWeight: 800,
  },
  statDescription: {
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 1.5,
  },
  actionBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
  },
  error: {
    marginBottom: 12,
    padding: '9px 12px',
    border: '1px solid #fecaca',
    borderRadius: 6,
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
  empty: {
    padding: 28,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14,
  },
  loading: {
    marginTop: 12,
    color: '#64748b',
    fontSize: 13,
  },
};
