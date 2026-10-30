# 宜搭查询条件编写指南

用于普通表单 `searchFormDatas`。CLI、页面 `this.utils.yida.searchFormDatas` 和 Canvas bridge 共用下列条件格式。

## 基础格式

`searchFieldJson` 是 **JSON 条件数组的字符串**。先构造数组，再序列化：

```json
[
  {
    "key": "字段ID",
    "value": "搜索值",
    "type": "字段类型",
    "operator": "操作符",
    "componentName": "组件名称"
  }
]
```

| 属性 | 填写方式 |
| --- | --- |
| `key` | 当前表单的真实字段 ID；区间端点可加 `.start` / `.end` |
| `value` | 按组件和操作符传字符串、数字或数组 |
| `type` | 查询数据类型，见下表 |
| `operator` | 查询操作符；日期区间整体范围查询省略此属性 |
| `componentName` | 组件英文名；区间端点按 `DateField` 查询 |
| `parentId` | 查询子表内部字段时填写子表字段 ID |

字段 ID 用 `openyida get-schema APP_xxx FORM-xxx --field-map-json` 获取。

```bash
openyida data query form APP_xxx FORM-xxx \
  --search-json '[{"key":"textField_xxx","value":"A","type":"TEXT","operator":"eq","componentName":"TextField"}]'
```

CLI 的 `--search-json` 接收上述数组的 JSON 文本，shell 中用单引号包裹；较长条件用 `--search-file`。页面参数使用 `searchFieldJson: JSON.stringify(conditions)`；清空筛选传 `JSON.stringify([])`。

## 组件与操作符速查

保留各组件原有的值查询能力；空值方法按组件语义补充。表中列的是常用方法。

| 组件 | componentName | type | 值查询操作符 | 空值 / 有值查询 |
| --- | --- | --- | --- | --- |
| 单行文本 | TextField | TEXT | `eq`, `like` | `is` / `is_not` |
| 多行文本 | TextareaField | TEXT | `eq`, `like` | `is` / `is_not` |
| 数值 | NumberField | DOUBLE | `eq`, `gt`, `ge`, `lt`, `le`, `between` | `is` / `is_not`；0 有值 |
| 评分 | RateField | DOUBLE | `gt`, `ge`, `lt`, `le`, `between` | 空值用法按目标字段验证 |
| 日期 | DateField | DOUBLE | `eq`, `gt`, `ge`, `lt`, `le`, `between` | `is` / `is_not`；0 有值 |
| 日期区间 | CascadeDateField | DOUBLE | 嵌套数组范围，省略 operator | 按 `.start` / `.end` 查询 |
| 单选 | RadioField | ARRAY | `eq`, `contains` | 单选模式用 `is` / `is_not` |
| 下拉单选 | SelectField | ARRAY | `eq`, `contains` | 单选模式用 `is` / `is_not` |
| 复选 | CheckboxField | ARRAY | `eq`, `contains` | 未选 / 已选按选项数查询 |
| 下拉复选 | MultiSelectField | ARRAY | `eq`, `contains` | 未选 / 已选按选项数查询 |
| 级联选择 | CascadeSelectField | STRING | `eq`, `contains` | 空值用法按目标字段验证 |
| 图片 | ImageField | TEXT | `like`，按实际文件路径核对 | `is` / `is_not` |
| 附件 | AttachmentField | TEXT | `like`，按实际文件路径核对 | `is` / `is_not` |
| 成员 | EmployeeField | STRING | `eq`, `contains` | `is` / `is_not` |
| 子表单 | TableField | TEXT | 整体关键词 `contains`；子字段可单独查询 | 无行 / 有行按行数查询 |

`eq` 表示相等，`like` 为文本模糊匹配，`contains` 按组件查询包含值。`gt/ge/lt/le` 分别表示大于、大于等于、小于、小于等于；`between` 的值是 `[下限,上限]`。`is/is_not` 表示存储为空 / 有值，值传 `""`。

## 按字段类型编写

以下展示传给 `--search-json` 或 `JSON.stringify()` 的条件数组；示例字段 ID 和选项值替换为当前表单的真实值。

### 文本：相等与包含

```json
[
  {"key":"textField_xxx","value":"A","type":"TEXT","operator":"eq","componentName":"TextField"},
  {"key":"textareaField_xxx","value":"测试","type":"TEXT","operator":"like","componentName":"TextareaField"}
]
```

### 数值与评分：比较与范围

`value` 使用数字；范围使用数字数组。

```json
[
  {"key":"numberField_xxx","value":10,"type":"DOUBLE","operator":"gt","componentName":"NumberField"},
  {"key":"rateField_xxx","value":[2,4],"type":"DOUBLE","operator":"between","componentName":"RateField"}
]
```

### 日期与日期区间：毫秒时间戳

单日期用数字比较或 `between`。区间整体范围为 `[[开始下限,开始上限],[结束下限,结束上限]]`；仅约束一端时另一端传 `[]`。

```json
[
  {"key":"dateField_xxx","value":[1704038400000,1706716800000],"type":"DOUBLE","operator":"between","componentName":"DateField"},
  {"key":"cascadeDateField_xxx","value":[[1704038400000,1706716800000],[]],"type":"DOUBLE","componentName":"CascadeDateField"}
]
```

按业务时区转换，范围上下限按业务设置。JavaScript 与 Python 示例均将北京时间转换为毫秒：

```javascript
new Date('2024-01-01T00:00:00+08:00').getTime() // 1704038400000
```

```python
from datetime import datetime
int(datetime.fromisoformat("2024-01-01T00:00:00+08:00").timestamp() * 1000)
```

### 选择类：单值与多值

单选 `eq` 传真实选项值；多选 `contains` 传选项值数组。选项 ID 与展示文本以 Schema 和回读结果为准。

```json
[
  {"key":"radioField_xxx","value":"A","type":"ARRAY","operator":"eq","componentName":"RadioField"},
  {"key":"checkboxField_xxx","value":["A","B"],"type":"ARRAY","operator":"contains","componentName":"CheckboxField"}
]
```

### 级联选择：路径数组

`value` 使用各层选项的真实值，保留路径顺序：

```json
[{"key":"cascadeSelectField_xxx","value":["product","product_a"],"type":"STRING","operator":"eq","componentName":"CascadeSelectField"}]
```

### 文件类：路径关键词

从真实记录回读文件地址或序列化内容，选择其中的文件路径关键词：

```json
[
  {"key":"imageField_xxx","value":"fileUpload/","type":"TEXT","operator":"like","componentName":"ImageField"},
  {"key":"attachmentField_xxx","value":"APP_xxx","type":"TEXT","operator":"like","componentName":"AttachmentField"}
]
```

文件路径搜索在目标字段核对结果；“是否上传”使用下文的 `is` / `is_not`。

### 成员：用户 ID

相等传真实 userId；包含传 userId 数组。本次普通表单验证也支持原有的字符串化数组形式。

```json
[
  {"key":"employeeField_owner","value":"userId","type":"STRING","operator":"eq","componentName":"EmployeeField"},
  {"key":"employeeField_members","value":["userId_1","userId_2"],"type":"STRING","operator":"contains","componentName":"EmployeeField"}
]
```

沿用字符串化数组的调用可继续传：

```json
[{"key":"employeeField_xxx","value":"[\"userId_1\",\"userId_2\"]","type":"STRING","operator":"contains","componentName":"EmployeeField"}]
```

### 子表整体与内部字段

整体关键词搜索保留 `TableField + TEXT + contains`：

```json
[{"key":"tableField_xxx","value":"关键词","type":"TEXT","operator":"contains","componentName":"TableField"}]
```

按指定子字段查询时，使用子字段真实 ID，并填写子表 `parentId`：

```json
[{"key":"textField_xxx","value":"测试","type":"TEXT","operator":"like","componentName":"TextField","parentId":"tableField_xxx"}]
```

## 多条件组合查询（AND）

同一个数组内的条件必须同时满足。例如文本为 A、数值大于 10、日期在指定时间之后：

```json
[
  {"key":"textField_xxx","value":"A","type":"TEXT","operator":"eq","componentName":"TextField"},
  {"key":"numberField_xxx","value":10,"type":"DOUBLE","operator":"gt","componentName":"NumberField"},
  {"key":"dateField_xxx","value":1704038400000,"type":"DOUBLE","operator":"gt","componentName":"DateField"}
]
```

完整 CLI 示例：

```bash
openyida data query form APP_xxx FORM-xxx --page 1 --size 20 \
  --dynamic-order '{"numberField_xxx":"+"}' \
  --search-json '[
    {"key":"textField_xxx","value":"A","type":"TEXT","operator":"eq","componentName":"TextField"},
    {"key":"numberField_xxx","value":10,"type":"DOUBLE","operator":"gt","componentName":"NumberField"},
    {"key":"dateField_xxx","value":1704038400000,"type":"DOUBLE","operator":"gt","componentName":"DateField"}
  ]'
```

空值也可以参与组合，例如 A 组且日期未填写：

```json
[
  {"key":"textField_xxx","value":"A","type":"TEXT","operator":"eq","componentName":"TextField"},
  {"key":"dateField_xxx","value":"","type":"DOUBLE","operator":"is","componentName":"DateField"}
]
```

页面调用同样发送整个条件数组：

```javascript
const result = await bridge.searchFormDatas({
  formUuid, currentPage: 1, pageSize: 20,
  searchFieldJson: JSON.stringify(conditions),
  dynamicOrder: JSON.stringify({ [fields.sequence]: '+' })
});
```

## 为空 / 不为空

单日期为空使用 `is`，不为空使用 `is_not`，`value` 固定传 `""`：

```javascript
const conditions = [{
  key: fields.date,
  componentName: 'DateField',
  type: 'DOUBLE',
  operator: 'is',
  value: ''
}];
const result = await bridge.searchFormDatas({
  formUuid, currentPage: 1, pageSize: 20,
  searchFieldJson: JSON.stringify(conditions),
  dynamicOrder: JSON.stringify({ [fields.sequence]: '+' })
});
```

日期不为空的完整条件如下；`value` 同样固定传 `""`，`type` 仍是 `DOUBLE`：

```json
[{"key":"dateField_xxx","componentName":"DateField","type":"DOUBLE","operator":"is_not","value":""}]
```

数字 `0` 和日期零时间戳属于有值，`is_not` 会保留这些记录。

表中的 `is` / `is_not` 和区间端点空值方法已在普通表单实测；文本样本的空白内容保存后归为空值。

## 日期区间

`CascadeDateField` 按端点查询：真实字段 ID 后加 `.start` 或 `.end`，条件的 `componentName` 使用 `DateField`、`type` 使用 `DOUBLE`。

```javascript
const startEmpty = {
  key: fields.period + '.start', componentName: 'DateField',
  type: 'DOUBLE', operator: 'is', value: ''
};
const endEmpty = { ...startEmpty, key: fields.period + '.end' };
const startFilled = { ...startEmpty, operator: 'is_not' };
const endFilled = { ...endEmpty, operator: 'is_not' };
```

| 筛选含义 | 条件数组 |
| --- | --- |
| 整个区间未填 | `[startEmpty, endEmpty]` |
| 两端均已填写 | `[startFilled, endFilled]` |
| 仅填写开始日期 | `[startFilled, endEmpty]` |
| 仅填写结束日期 | `[startEmpty, endFilled]` |
| 开始日期未填 / 已填 | `[startEmpty]` / `[startFilled]` |
| 结束日期未填 / 已填 | `[endEmpty]` / `[endFilled]` |

页面筛选文案明确写“两端均已填写”或具体端点。业务需要“任一端已填”时，用下文的已填端点数查询 `gt 0`；这样半填区间也能命中，并保留服务端分页。

查询时间范围时，日期传毫秒时间戳；区间整体传 `[[开始下限,开始上限],[结束下限,结束上限]]`，省略 `operator`。例如仅约束开始日期：

```javascript
{ key: fields.period, componentName: 'CascadeDateField', type: 'DOUBLE',
  value: [[startFrom, startTo], []] }
```

## 业务数量与空值

“有没有选项”“有没有明细行”按业务数量判断。为这些字段增加数值字段，在每次保存、更新时和原值一起维护，并回填全部历史记录：

| 业务含义 | 数值字段内容 | 未填写 | 已填写 |
| --- | --- | --- | --- |
| 区间任一端已填 | 已填端点数，0 / 1 / 2 | `eq 0` | `gt 0` |
| 多选是否选择 | 所选选项数量 | `eq 0` | `gt 0` |
| 子表是否有行 | 明细行数 | `eq 0` | `gt 0` |

`CheckboxField` / `MultiSelectField` 的“未选任何项”统一使用选项数，使未填写、清空和历史空数组具有一致语义。子表整体使用行数；子字段查询表示“存在匹配的明细行”。

```javascript
const present = value => value !== null && value !== undefined && value !== '';
const data = {
  [fields.period]: period,
  [fields.periodCount]: Array.isArray(period) ? period.slice(0, 2).filter(present).length : 0,
  [fields.choices]: choices,
  [fields.choiceCount]: choices.length
};
// 将 data 作为同一次 create/update 的表单数据。
const anyDateFilled = [{
  key: fields.periodCount, componentName: 'NumberField', type: 'DOUBLE',
  operator: 'gt', value: 0
}];
```

原生表单、导入、API 等写入入口都要同步维护计数。计数启用前，完成历史回填并核对原值与数量；主记录分批回填，子表行数从完整子表数据计算。查询页面直接使用计数字段筛选。

## 子表内字段为空

```javascript
{ key: fields.detailDate, parentId: fields.details,
  componentName: 'DateField', type: 'DOUBLE', operator: 'is', value: '' }
```

该条件命中有明细行且明细日期为空的主记录。没有明细行的记录通过明细行数 `eq 0` 查询。

## 分页与模板复用

把已确认的业务条件追加到同一个数组。改变条件时回到第 1 页，并给 `dynamicOrder` 设置稳定排序字段。返回空结果时展示空状态；请求失败时保留条件并显示失败状态。

```bash
openyida data query form APP_xxx FORM-xxx --page 1 --size 20 --search-json '[{"key":"dateField_xxx","componentName":"DateField","type":"DOUBLE","operator":"is","value":""}]'
openyida sample yida-data-management empty-query --output .cache/openyida/empty-query.js
```

模板提供 `buildEmptyConditions(field, mode)`，区间明确选择 `empty`、`complete` 或端点模式；计数字段使用 `buildCountConditions(field, 'empty' / 'filled')`。返回数组可直接组合后序列化。CLI 的 `--resolve-aliases` 支持 `区间别名.start` / `.end` 和子表条件的 `parentId`。

其他组件的空值方法，先在目标表单保存并回读空值、有值、清空后和零值样本，再核对记录 ID、组合条件和分页总数。评分和级联选择继续使用上表原有值查询方法；新增空值映射按此流程验证。
