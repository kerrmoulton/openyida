# 流转控制

## 什么时候用

根据条件走不同分支、执行并行分支，或重复处理数据。先区分改变走向的条件分支与同一节点内的条件选人。

## 必填配置

| 节点 | 流程 | 自动化 spec |
| --- | --- | --- |
| 条件分支 | 可直接生成：`route.conditions[]`，分支内用 `rules/childNodes` | 可直接生成：`route.branches[]`，分支内用 `conditions/nodes` |
| 并行分支 | 可直接生成：`parallel.branches[]`，分支内用 `rules/childNodes` | 可直接生成：`parallel.branches[]`，分支内用 `conditions/nodes` |
| 循环容器 | 需要已有真实 `CycleContainer` 配置才能透传 | 可直接生成：`cycle.source/nodes`，单层循环；批量复制也可用批量数据节点 |
| 拒绝后跳转 | 人工节点的 `routeRules` | 不适用，不是自动化分支 |

比较规则和变量来源只读 [条件与变量](conditions-variables.md)。流程分支按数组顺序生成优先级；自动化指定至多一个 `default: true` 兜底分支。不要手写底层连线或 `conditionNode`。

自动化分支需要计算后判断时，使用完整的 `branches[].expression`，与普通 `conditions` 二选一；读取 [分支按公式判断](../../yida-formula/references/automation-formulas.md#分支按公式判断)，保留执行文本、编辑器原文和显示文字。普通流程条件由编译器生成自己的表达式，沿用流程格式；相同计算目的不代表两种 JSON 可以互换。

自动化并行分支沿用 `conditions/rules` 或 `all: true`；整段 `expression` 当前仅由 route 分支接收。

两层判断直接参照 [包含 events/nodes 的完整嵌套分支](../../yida-formula/references/node-examples.md#嵌套分支先决定是否复核再决定级别)。第二个 route 放在命中分支的 nodes，每层分别配置兜底；公式中的 AND/OR 与流程图的 route 嵌套是两种不同结构。

## 最小示例

流程：金额超过阈值时进入审批，未命中时 CLI 自动补“其他情况”分支。

```json
{
  "type": "route",
  "name": "金额分支",
  "conditions": [
    {
      "name": "金额超过一万",
      "rules": [
        {
          "fieldId": "<真实金额字段ID>",
          "fieldName": "金额",
          "componentType": "NumberField",
          "op": "GreaterThan",
          "value": 10000
        }
      ],
      "childNodes": [
        {
          "type": "approval",
          "name": "财务审批",
          "approver": "originator"
        }
      ]
    }
  ]
}
```

自动化：`self` 是前面已声明的 `getSelf` 节点；命中后更新当前记录。

```json
{
  "type": "route",
  "branches": [
    {
      "name": "已获取记录",
      "conditions": [
        {
          "fieldId": "${self}.form_inst_id",
          "fieldName": "表单实例ID",
          "componentType": "TextField",
          "opCode": "ExistValue"
        }
      ],
      "nodes": [
        {
          "type": "dataUpdate",
          "source": "self",
          "assignments": [
            {
              "column": "<真实处理状态字段ID>",
              "valueType": "literal",
              "value": "待处理"
            }
          ]
        }
      ]
    },
    {
      "name": "其他情况",
      "default": true,
      "nodes": []
    }
  ]
}
```

流程并行时改用 `type: "parallel"` 和 `branches`，每个分支提供 `name/childNodes`；可选 `rules/logic`，不设置条件表示该分支全部进入。

### 并行分支示例

```json
{
  "type": "parallel",
  "name": "并行会审",
  "branches": [
    {
      "name": "第一分支",
      "childNodes": [
        {
          "type": "approval",
          "name": "第一分支审批",
          "approver": "originator"
        }
      ]
    },
    {
      "name": "条件分支",
      "logic": "AND",
      "rules": [
        {
          "fieldId": "<真实金额字段ID>",
          "fieldName": "金额",
          "componentType": "NumberField",
          "op": "GreaterThan",
          "value": 10000
        }
      ],
      "childNodes": [
        {
          "type": "approval",
          "name": "第二分支审批",
          "approver": "originator"
        }
      ]
    }
  ]
}
```

### 流程分支参数

| 位置 | 参数与限制 |
| --- | --- |
| 条件路由节点 | `type: route`，`conditions` 为分支列表 |
| 条件分支 | `name/rules`，可选 `logic/childNodes`；`logic` 默认 `AND`，可用 `OR` |
| 并行节点 | `type: parallel`，`branches` 为分支列表，兼容 `conditions/parallelBranches` |
| 并行分支 | 可选 `name/rules/logic/childNodes`；无规则表示全部进入，不是互斥兜底 |
| 一条规则 | `fieldId/fieldName/componentType/op/value`；使用真实字段及其组件类型 |

别名 `route/branch/ConditionContainer` 归一为条件路由，`parallel/parallelBranch` 归一为并行。按字段类型选择操作符，见 [条件与变量](conditions-variables.md)；不要把自动化的 `opCode/valueType` 直接放进流程条件。

人工节点拒绝后回退的片段：

```json
{
  "routeRules": [
    {
      "when": "disagree",
      "jumpTo": "主管审核"
    }
  ]
}
```

`jumpTo` 用流程中实际目标节点的 `name`，或 `"结束"`。

## 自动化并行与循环

以下都是完整自动化 spec，写入 `spec.json` 后，用 `integration create APP FORM 名称 --spec spec.json` 保存草稿。`APP/FORM` 和 `<…>` 内容从实际查询结果替换；先保存、核对，再按用户要求发布。

### 自动化并行示例

用途：每次触发都执行两条检查，汇合后再继续。两条分支都写 `all:true`：

```json
{
  "events": ["insert"],
  "nodes": [
    {
      "id": "checks", "type": "parallel", "name": "同时检查",
      "branches": [
        {"id": "first", "all": true, "nodes": [{"id": "readFirst", "type": "getSelf", "name": "检查一"}]},
        {"id": "second", "all": true, "nodes": [{"id": "readSecond", "type": "getSelf", "name": "检查二"}]}
      ]
    },
    {"id": "afterChecks", "type": "getSelf", "name": "检查完成后继续"}
  ]
}
```

预期：新增一条记录后，“检查一”“检查二”各执行一次，“检查完成后继续”执行一次。`getSelf` 在此只读当前记录，方便先验证分支结构。

有条件的分支使用 `conditions`；`default:true` 是没有条件命中时的兜底，最多一条。每次都执行的分支用上例的 `all:true`。并行中避免多个分支同时覆盖同一业务字段。

### 循环逐行写入示例

循环的 `source` 指向上游批量取数节点，`nodes` 是循环体。`blockType` 为 `continue`（异常后跳过本条）或 `break`（退出循环）。每条自动化最多一个循环，CLI 生成回路和出口。当前行用 `${循环别名}.字段ID`，整批结果与当前行分别引用；平台拒绝时按错误处理。

用途：最多取 3 条来源记录，将每条的编号和金额写入另一张普通表单。目标表使用独立测试表或明确允许写入的表。

```json
{
  "events": ["insert"],
  "nodes": [
    {
      "id": "rows", "type": "dataRetrieve",
      "formUuid": "<真实来源表单ID>",
      "retrieveType": "batch", "quantity": 3, "filterType": "all"
    },
    {
      "id": "loop", "type": "cycle", "source": "rows", "blockType": "continue",
      "nodes": [
        {
          "id": "copy", "type": "dataCreate", "formUuid": "<真实目标表单ID>",
          "assignments": [
            {"column": "<真实目标编号字段ID>", "valueType": "processVar", "value": "${loop}.<真实源编号字段ID>"},
            {"column": "<真实目标金额字段ID>", "valueType": "processVar", "value": "${loop}.<真实源金额字段ID>"}
          ]
        }
      ]
    }
  ]
}
```

`rows` 是整批来源；`loop` 是本轮正在处理的一条记录，因此赋值用 `${loop}.字段ID`。`column` 填目标表字段，`value` 中填来源表字段，两张表的编号都用文本、金额都用数字。

预期：若本次取到 A/5、B/15、C/25，目标表新增这 3 条对应记录。核对目标记录数量和每列值；`quantity:3` 表示最多取 3 条，来源表超过 3 条时，本例只处理本次取到的记录。

先保存草稿及回读，再以空数组、单条、多条和中途异常验证业务结果。配置保存不能证明并行汇合或循环执行正确。

## 特有限制

- 流程嵌套分支不超过 3 层；超过时必须拆分结构。默认“其他情况”由 CLI 生成；排查底层结构时核对最后一个条件为 `conditionType: else`，不猜测或省略兜底。
- 并行分支可能同时执行；不能用多个按优先级选择的条件分支假装并行。
- 节点别名只能引用当前分支的上游。某条分支内查询出的数据不能在无关分支中使用。
- 流程循环容器的范围、当前项、退出条件与子节点必须来自真实配置，不能只写空 `cycleContainerRules`。
- 批量取数再逐行新增不需要额外循环节点，见 [数据](data.md)。
