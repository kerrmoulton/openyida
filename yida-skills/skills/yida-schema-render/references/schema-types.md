# Schema 类型定义

## 公共字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | String | `DataList`、`DetailCard`、`FormPanel`、`StatBoard`、`ActionBar` |
| `title` | String | 页面区块标题 |
| `description` | String | 可选说明 |
| `dataSource.appType` | String | 应用 ID；提交表单时需要 |
| `dataSource.formUuid` | String | 数据表单 ID |

## DataList

```json
{
  "type": "DataList",
  "dataSource": { "appType": "APP_XXX", "formUuid": "FORM-YYY" },
  "filters": [
    { "field": "textField_name", "label": "姓名", "type": "text" },
    { "field": "selectField_status", "label": "状态", "type": "select", "options": [{ "label": "进行中", "value": "进行中" }] }
  ],
  "columns": [
    { "field": "textField_name", "label": "姓名", "width": 160 },
    { "field": "selectField_status", "label": "状态", "render": "tag" }
  ],
  "actions": [
    { "label": "查看", "type": "link", "action": "detail" }
  ],
  "pagination": { "pageSize": 20 }
}
```

`filters` 会转换为 `searchFieldJson`，空值不参与查询。`columns[].render = "tag"` 会用标签样式展示字段值。

## DetailCard

```json
{
  "type": "DetailCard",
  "dataSource": { "appType": "APP_XXX", "formUuid": "FORM-YYY" },
  "formInstId": "FINST-XXX",
  "fields": [
    { "field": "textField_name", "label": "姓名" },
    { "field": "selectField_status", "label": "状态", "render": "tag" }
  ]
}
```

`formInstId` 可留空，运行时会尝试从 URL 参数 `formInstId` 读取。

## FormPanel

```json
{
  "type": "FormPanel",
  "dataSource": { "appType": "APP_XXX", "formUuid": "FORM-YYY" },
  "fields": [
    { "field": "textField_name", "label": "姓名", "type": "text", "required": true },
    { "field": "textareaField_note", "label": "备注", "type": "textarea" }
  ],
  "submit": { "label": "提交", "mode": "create" }
}
```

`submit.mode = "create"` 调用 `saveFormData`；`submit.mode = "update"` 或存在 `formInstId` 时调用 `updateFormData`。

## StatBoard

```json
{
  "type": "StatBoard",
  "dataSource": { "appType": "APP_XXX", "formUuid": "FORM-YYY" },
  "metrics": [
    { "label": "记录数", "aggregate": "count", "suffix": "条" },
    { "label": "金额合计", "field": "numberField_amount", "aggregate": "sum", "prefix": "¥" },
    { "label": "平均金额", "field": "numberField_amount", "aggregate": "avg", "prefix": "¥" }
  ],
  "pagination": { "pageSize": 100 }
}
```

支持 `count`、`sum`、`avg`。仅用于轻量聚合预览，正式报表优先使用 `yida-report`。

## ActionBar

```json
{
  "type": "ActionBar",
  "actions": [
    { "label": "刷新", "type": "primary", "action": "refresh" },
    { "label": "导出", "type": "secondary", "action": "export", "handler": "handleExport" }
  ]
}
```

`handler` 指向页面源码中的 `export function handleExport(record, action, schema) {}`。
