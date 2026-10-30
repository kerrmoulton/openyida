# 字段取值与完整配置

本页说明普通字段的默认值公式。只要目标组件使用同样的属性，就沿用同样方法，包括普通表单、流程表单，以及提供这些属性的原生页面组件。

## 选择字段和结果类型

宜搭把公式配置在普通字段上，例如数值、文本、日期或成员字段。先选择适合结果的字段，再设置公式：

| 结果 | 常用目标字段 | 例子 |
| --- | --- | --- |
| 数字 | `NumberField` | 金额、数量、平均值 |
| 文本 | `TextField`、`TextareaField` | 拼接编号、状态说明 |
| 日期 | `DateField` | `TIMESTAMP(TODAY())` 填今天；到期日计算后也转换为时间戳 |
| 人员 | `EmployeeField` | 当前登录人、主管 |
| 多个选项或人员 | 接受数组的对应组件 | 多选集合、成员列表 |

人员、日期、选项等值保留组件要求的数据结构。显示名称相同不代表原始值类型相同；先读取字段配置和样例值。函数与组件是否兼容，可以用 `formula check --target-type` 辅助检查，再用 `formula test --field` 核对平台绑定后的字段值。

日期计算与日期字段赋值分两步：`TODAY()` 返回日期对象，填入日期字段时用 `TIMESTAMP(TODAY())`。本地类型检查通过后，也要核对页面是否显示日期，以及提交后的值是否为毫秒时间戳。

“今天”不等于“当天零点”。`TIMESTAMP(TODAY())` 的接口试算可能保留时分秒；日期组件还会按显示格式处理提交值。业务明确需要零点时，先查询 `DAYBEGIN`，使用 `DAYBEGIN(TIMESTAMP(TODAY()))`，按所用时区核对结果；不要直接把接口值、页面日期和提交时间戳当成同一个值。

日期也可以作为判断条件。例如判断结束时间晚于开始时间，可使用当前函数列表支持的 `GT(#{dateField_end}, #{dateField_start})`，将两边统一为毫秒时间戳。按“同一天”判断时先统一时区和日期粒度；完整时刻的相等与日历日期的相等是不同业务条件。不要为比较日期而一律增加文本字段。

## 组件、参数与结果类型

先从 Schema 读取真实字段的 `componentName`，例如 `NumberField`；再查当前组织的组件类型映射和函数签名：

```bash
openyida formula types APP_XXX --component NumberField --json
openyida formula functions APP_XXX --name ROUND --output metadata.json --json
```

组件映射用于检查字段引用和目标字段的兼容类型；函数签名中的 `required/optional` 表示各参数接受的类型，`result` 表示返回类型。例如内置参考中，`NumberField` 支持 `number/string`，`DateField` 支持 `date/number/timestamp/string`，`EmployeeField` 支持 `array/string`。这类宽类型不是任意文本都能赋值成功的保证：数值文本、日期对象和人员结构还要经过对应转换。当前组织查询结果优先，无法确定自定义组件子属性类型时保留未知。

将完整 Schema、元数据和目标组件一起提供给检查器，可核对“字段组件 → 函数参数 → 返回结果 → 目标组件”：

```bash
openyida formula check formula.txt --schema schema.json --metadata metadata.json --target-type NumberField --strict --json
```

字段 ID 前缀、显示名称和样例外观不能代替组件类型。数值精度、日期毫秒时间戳及成员数组的实际回填，继续用字段试算和页面结果核对。

## 读取已有配置

```bash
openyida get-schema APP_XXX FORM_XXX --field-map-json
openyida formula inspect APP_XXX FORM_XXX --field numberField_total --json
```

字段映射用于找 ID；完整 Schema 用于保留字段属性、子表结构、显示状态和原公式。修改前记录 `valueType`、`formula`、`complexValue`，并核对两处公式是否一致。

映射中的字段必须属于目标表单；使用组件 `props.fieldId`，保留真实值的全部字符。文中的示例 ID 全部先替换再保存；`formUuid`、组件树节点 `id`、字段显示名称和 `UUID()` 生成的字符串都不能代替字段 ID。自定义组件的子属性沿用设计器提供的完整引用。

## 保存公式

平台使用以下三个属性表示同一个字段公式：

```json
{
  "valueType":"formula",
  "formula":"ROUND(#{numberField_price} * #{numberField_qty}, 2)",
  "complexValue":{
    "complexType":"formula",
    "formula":"ROUND(#{numberField_price} * #{numberField_qty}, 2)"
  }
}
```

`create-form create/update` 接受上述完整写法，也接受简写 `formula`，CLI 会同步三个属性。两处都提供公式时，内容应一致。

新建独立计算字段，将下面内容保存为 `fields.json`：

```json
[
  {"type":"NumberField","label":"计算金额","behavior":"READONLY","precision":2,"formula":"ROUND(12.345, 2)"},
  {"type":"EmployeeField","label":"填报人","formula":"USER()"},
  {"type":"DateField","label":"填报日期","formula":"TIMESTAMP(TODAY())"}
]
```

```bash
openyida create-form create APP_XXX "计算示例" fields.json --no-open
```

需要引用同表新字段时，先创建基础字段，读取真实 ID，再更新公式。不要用示例 ID 代替自动生成的 ID。

已有字段使用 `changes.json`：

```json
[
  {
    "action":"update",
    "fieldId":"numberField_total",
    "changes":{
      "formula":"ROUND(#{numberField_price} * #{numberField_qty}, 2)",
      "precision":2,
      "behavior":"READONLY"
    }
  }
]
```

```bash
openyida create-form update APP_XXX FORM_XXX changes.json
openyida formula inspect APP_XXX FORM_XXX --field numberField_total --json
```

只更新任务需要的属性。`READONLY` 适合让用户查看自动计算的金额；是否允许手动修改由业务需求决定。金额显示两位小数时，同时设置 `precision: 2`。

恢复手动输入时，将该字段的 `changes` 设为：

```json
{"valueType":"custom","formula":""}
```

需要固定默认值时，另外按目标组件格式设置 `defaultValue`。流水号 `SerialNumberField` 的 `formula` 是专用对象，沿用流水号配置，不采用这里的字符串写法。

## 子表和组件子属性

普通子表字段使用子字段自己的 ID：

| 目标 | 配置位置 | 公式 |
| --- | --- | --- |
| 当前行金额 | 子表的金额字段 | `ROUND(#{numberField_linePrice} * #{numberField_lineQty}, 2)` |
| 所有行金额合计 | 主表的合计字段 | `SUM(#{numberField_lineAmount})` |
| 所有行数量乘单价后合计 | 主表的合计字段 | `SUMPRODUCT(#{numberField_lineQty}, #{numberField_linePrice})` |

同一个字段引用，在子表同行和主表汇总中取得的数据可能不同。主表合计和子表逐行计算分别核对。普通子表字段写成 `#{numberField_lineAmount}`；组件开放的子属性则保留设计器提供的路径，例如 `#{customField_xxx.amount}`。

## 子表同行计算与主表汇总的完整变更

适用结构：子表已有数值字段“单价、数量、行金额”，主表已有数值字段“合计”。先用字段映射分别取得这些 ID，再保存以下 `changes.json`。`numberField_lineAmount` 属于子表，`numberField_total` 属于主表；在同一次更新中配置它们，不重新创建字段。

```json
[
  {
    "action": "update",
    "fieldId": "numberField_lineAmount",
    "changes": {
      "formula": "ROUND(#{numberField_linePrice} * #{numberField_lineQty},2)",
      "precision": 2,
      "behavior": "READONLY"
    }
  },
  {
    "action": "update",
    "fieldId": "numberField_total",
    "changes": {
      "formula": "IF(ISEMPTY(#{numberField_lineAmount}),0,SUM(#{numberField_lineAmount}))",
      "precision": 2,
      "behavior": "READONLY"
    }
  }
]
```

通过 `create-form update APP_XXX FORM_XXX changes.json` 保存。单价 12.30、数量 2 的行金额预期为 24.60；单价 5、数量 3 的行金额预期为 15；主表合计预期为 39.60。修改第一行数量时，关注第一行及主表合计是否变化，第二行金额应按其自己的单价和数量计算。这些是后续验收的业务预期，不表示本轮已运行。

完整示例用 `ISEMPTY` 为零行明细返回 0。业务允许空表时保留这一分支，使用空表样例检查；单独 `SUM` 空列在平台上可能没有字段值。

页面里的空白行与零行明细分别检查。子表默认 `minItems: 1`，只把它改为 0 也可能在提交时保留空白行；需要允许不填明细并过滤全空行时，读取真实子表 ID 后保存下面补丁：

```json
[
  {
    "action": "field-props",
    "fieldId": "tableField_lines",
    "props": { "minItems": 0, "filterEmptyRowData": true }
  }
]
```

`tableField_lines` 替换为当前子表的真实 ID，用 `create-form patch APP_XXX FORM_XXX patch.json` 保存。分别验收空明细和有内容的明细；提交后用 `data query subform` 核对条数，不能仅凭页面看起来为空或合计显示 0 判断没有明细行。

## 隐藏、提交和依赖

需要隐藏但随表单提交的计算值时，检查现有提交策略，必要时设置：

```json
[
  {"action":"field-props","fieldId":"numberField_total","props":{"behavior":"HIDDEN","submittable":"ALWAYS"}}
]
```

用 `create-form patch APP_XXX FORM_XXX patch.json` 保存。隐藏状态、是否计算、是否提交是分别需要核对的行为；`submittable: ALWAYS` 表示始终提交，并不能单独证明公式已执行。

隐藏字段不等于永远不参与计算。平台取值会检查公式依赖和提交策略；公式明确需要的隐藏输入字段也可能被取入计算。先确认依赖字段有值、计算目标能得到结果，再核对提交数据。展示正确、试算正确与提交成功分别记录。

让计算按清楚的顺序进行，例如“单价、数量 → 行金额 → 合计”。修改公式时检查直接引用自身及 A→B→A 的循环。CLI 保存时同步公式属性并检查字段公式依赖；更完整的函数、参数和类型诊断由显式的 `formula check` 提供。

例如，给“合计”配置公式时，输入应是其他金额字段，不能写成“合计 = 合计 + 金额”。空值默认文本的示例也配置在另一个输出字段；给当前字段设默认值时，选择不引用自身的表达式。

## 常见问题

| 看到的现象 | 优先查看 |
| --- | --- |
| 默认值没有变成公式 | 三个公式属性、字段是否确实保存成功 |
| 公式编辑器显示字段失效 | 字段 ID、子属性路径、可引用字段列表 |
| 页面显示正确，提交结果为空 | 字段提交策略及实际提交值 |
| 金额小数显示不一致 | 公式舍入位数和字段 `precision` |
| 子表每行结果相同或合计不对 | 公式配置位置、同行值与整列值的区别 |
| 本地通过，页面结果不同 | 页面预处理、空值与零、日期和成员结构、执行时机 |

用户要求验收时，保存后回读，用 `formula test --field` 检查依赖和样例，再从实际页面检查正常值、空值、零和两行不同明细。可直接使用 [完整试算与回归样例](runtime-examples.md)，页面精度和提交策略另行核对。
