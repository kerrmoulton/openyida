# 节点表达式

同样的表达式结构可供不同节点设计器使用。本页以自动化的取数、赋值和分支为例；流程节点若采用相同结构，可共用保存方法，并核对其可选变量和函数。

## 先分清“字段”和“公式”

获取数据节点的“按条件过滤”有三种右侧来源：

| 选择 | 用途 | spec 的 `valueType` |
| --- | --- | --- |
| 值 | 金额大于固定的 100 | `literal` |
| 字段 | 目标表金额大于上游记录的金额 | `processVar` |
| 公式 | 目标表金额大于上游金额乘以 2 | `column` |

字段直接比较使用“字段”，计算后再比较使用“公式”。下面说明公式格式；字段比较的格式和验收状态见通用节点技能的“条件与变量”。

表单事件的触发条件使用固定值或字段。需要按公式判断时，在触发后的分支节点配置公式；CLI 会在保存前提示不支持的触发条件公式。

## 分支按公式判断

自动化 `route` 分支选择“按公式定义进入”，使用 `expression`。例如单价大于零时进入此分支：

```json
{
  "id":"positive",
  "name":"单价大于零",
  "expression":{
    "value":"GT(${self}.numberField_price,0)",
    "__source":"GT(#{self//numberField_price},0)",
    "__display":"单价大于零"
  },
  "nodes":[]
}
```

将它放入 `route.branches`；`nodes` 填入满足条件后要执行的节点。公式应返回“是或否”，例如使用 `GT`、`EQ`、`AND`。`self` 对应上游节点别名。

一个分支选择 `expression` 或普通 `conditions` 中的一种。普通分支条件右侧需要计算时，改用上述完整公式；`valueType: column` 用在支持公式的获取数据、赋值等位置。

需要 `A 且（B 或 C）` 或“先判断是否复核，再判断级别”时，直接读取 [完整嵌套分支 spec](node-examples.md#嵌套分支先决定是否复核再决定级别)。示例包含外层 events/nodes、两层 route、每层兜底、完整公式和结果赋值。

CLI 并行分支当前使用 `conditions/rules` 或 `all: true`，不接收这里的 `expression`；按流转控制说明配置。

## 获取数据时按公式筛选

在 `dataRetrieve.conditions` 中写：

```json
{
  "bFieldId":"numberField_targetAmount",
  "bFieldName":"金额",
  "componentType":"NumberField",
  "opCode":"Bigger",
  "valueType":"column",
  "value":{
    "value":"ROUND(${self}.numberField_amount * 2, 2)",
    "__source":"ROUND(#{self//numberField_amount} * 2, 2)",
    "__display":"ROUND(当前记录.金额 * 2, 2)"
  }
}
```

`self` 是前面已配置的 `getSelf` 节点别名。字段 ID 替换成真实值。

- 内层 `value` 是执行公式，上游数据节点字段写成 `${节点别名}.字段ID`。
- `__source` 是再次打开公式编辑器时使用的内容，写成 `#{节点别名//字段ID}`。
- `__display` 是便于阅读的显示文字。

CLI 分别替换执行公式和编辑器内容中的节点别名，并保留两份内容。平台条件规则中，`value` 保存执行公式，`ruleValue` 保存上述三项。

数字比较使用该自动化接口的名称，例如 `Bigger`、`Lesser`、`BiggerOrEqual`、`LesserOrEqual`。CLI 也接受 `GreaterThan/LessThan/GreaterThanOrEqual/LessThanOrEqual` 并转换为这些原生值；查看平台保存内容时按原生编码核对。

需要多条条件时，读取 [字段、嵌套公式与固定值一起过滤的完整 spec](node-examples.md#按编号字段嵌套公式和固定状态取数)。当前取数 `conditions` 为平铺条件，节点级 `logic` 选择 AND 或 OR；一条右侧公式可以嵌套 IF，但不等于目标表多字段条件已支持任意嵌套分组。

## 新增或更新数据时计算字段值

在 `assignments` 中写：

```json
{
  "column":"numberField_targetAmount",
  "valueType":"column",
  "value":"ROUND(${self}.numberField_amount * 2, 2)",
  "__source":"ROUND(#{self//numberField_amount} * 2, 2)",
  "__display":"ROUND(当前记录.金额 * 2, 2)"
}
```

此处 `value` 直接写公式文本。提供 `__source` 和 `__display` 可保留编辑器内容。触发表单字段可用 `#{字段ID}`；上游数据节点使用节点引用；通知正文的占位写法另按通知技能配置。

## 保存与验证

1. 查询实际字段和节点，确认引用来自当前节点之前。
2. 用 `formula check formula.txt --contract node-expression --strict --json` 检查写法和参数。
3. 按 `yida-integration` 保存到测试自动化，再读取设计内容，核对公式及编辑器内容。
4. 在授权范围内触发，查看节点日志和实际取数、赋值结果；再打开设计器确认公式可重新编辑。

节点日志可能晚于运行状态出现。刚完成时若明细为空，稍后重新查询；核对实际字段值后再判断是否通过。

本地检查暂不判断节点先后关系，也不模拟整条自动化。保存成功后继续完成运行和编辑器验证，再报告对应能力可用。
