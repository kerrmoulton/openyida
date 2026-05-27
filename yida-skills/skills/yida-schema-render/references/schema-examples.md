# Schema 示例

## 客户列表

```bash
openyida sample yida-schema-render data-list --output .cache/openyida/schema-render/customer-list.json
openyida schema-render preview .cache/openyida/schema-render/customer-list.json
openyida schema-render generate --schema .cache/openyida/schema-render/customer-list.json --output project/pages/src/ --compile
```

生成标准筛选器、表格、行操作和分页。适合 CRM 客户、工单、项目台账等列表页。

## 客户录入表单

```bash
openyida sample yida-schema-render form-panel --output .cache/openyida/schema-render/customer-form.json
openyida schema-render generate --schema .cache/openyida/schema-render/customer-form.json --output project/pages/src/ --compile
```

字段配置里的 `required` 会在前端做必填提示；提交时通过 `saveFormData` 写入 `dataSource.formUuid`。

## 轻量统计面板

```bash
openyida sample yida-schema-render stat-board --output .cache/openyida/schema-render/customer-stats.json
openyida schema-render generate --schema .cache/openyida/schema-render/customer-stats.json --output project/pages/src/ --compile
```

适合少量记录的快速概览。若用户要经营报表、趋势图、分组聚合或大数据统计，切换到 `yida-report` 或 `yida-chart`。

## 组合用法

生成后的页面可以继续混合手写 JSX：

```jsx
export function renderJsx() {
  var self = this;
  return (
    <main>
      <SchemaRender schema={SCHEMA_RENDER_SCHEMA} context={self} />
      <div style={{ marginTop: 16 }}>
        <button onClick={(e) => { self.handleExport(); }}>自定义导出</button>
      </div>
    </main>
  );
}
```

新增自定义方法时仍遵守 `yida-custom-page` 规范：需要访问 `this` 的方法必须写成 `export function`。
