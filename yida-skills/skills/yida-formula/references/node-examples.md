# 复杂节点的完整配置示例

本页示例是自动化 `--spec` 的完整外层对象，包含 `events`、`nodes` 和上游别名。相同表达式格式可供其他配置复用，但保存入口不同的流程 props 按其真实结构处理。以下结果是业务预期，本轮没有执行示例。

## 先选结构

| 需要什么 | 写法 |
| --- | --- |
| 同层多个筛选条件全部成立 | 在取数节点设置 `logic: "AND"`，`conditions` 是平铺数组 |
| 同层多个筛选条件任一成立 | 在取数节点设置 `logic: "OR"`，其他条件仍是同层 |
| 右侧值需要先计算 | 一条取数条件的 `valueType: "column"`，`value` 为三段式公式对象 |
| 分支判断 A 且（B 或 C） | 一整个 `route.branches[].expression`，在公式中嵌套 `AND/OR` |
| 命中分支后还需继续判断 | 把第二个 `route` 放进已命中分支的 `nodes` |

当前取数 spec 的 `conditions` 尚不支持任意嵌套条件组。`A 且（B 或 C）` 涉及目标表多字段时，需要该位置真正支持的条件树入口；不要摊平成全 AND、全 OR，或误把目标记录字段当成上游字段写进右侧公式。单个条件右侧支持复杂公式，也不代表整个查询已支持任意嵌套筛选。

## 按编号字段、嵌套公式和固定状态取数

业务：从目标表获取一条数据，三个条件全部成立：

1. 目标编号等于当前记录编号。
2. 目标金额大于门槛。当前数量大于 10 时，门槛为当前金额的九折；否则为当前金额。
3. 目标状态等于固定文本“有效”。

替换位置：

| 示例内容 | 替换来源 |
| --- | --- |
| `FORM_TARGET` | 被查询普通表单的真实 ID，属于当前应用 |
| `textField_code`、`numberField_qty`、`numberField_amount` | 当前触发表单的编号、数量、金额字段 |
| `textField_targetCode`、`numberField_targetAmount`、`textField_targetStatus` | 目标表的编号、金额、状态字段 |
| `self`、`lookup` | 本例声明的唯一节点别名，可保留；重命名 `self` 时同时更新两种引用 |

将下面完整对象保存为任务 integration 目录中的 `query-spec.json`：

```json
{
  "events": [
    "insert"
  ],
  "nodes": [
    {
      "id": "self",
      "type": "getSelf",
      "formType": "receipt"
    },
    {
      "id": "lookup",
      "type": "dataRetrieve",
      "name": "按编号、金额和状态取数",
      "formUuid": "FORM_TARGET",
      "formType": "receipt",
      "retrieveType": "single",
      "filterType": "condition",
      "logic": "AND",
      "conditions": [
        {
          "bFieldId": "textField_targetCode",
          "bFieldName": "目标编号",
          "componentType": "TextField",
          "opCode": "Equal",
          "valueType": "processVar",
          "aFieldId": "${self}.textField_code"
        },
        {
          "bFieldId": "numberField_targetAmount",
          "bFieldName": "目标金额",
          "componentType": "NumberField",
          "opCode": "Bigger",
          "valueType": "column",
          "value": {
            "value": "ROUND(IF(GT(${self}.numberField_qty,10),${self}.numberField_amount * 0.9,${self}.numberField_amount),2)",
            "__source": "ROUND(IF(GT(#{self//numberField_qty},10),#{self//numberField_amount} * 0.9,#{self//numberField_amount}),2)",
            "__display": "ROUND(IF(当前记录.数量大于10,当前记录.金额 * 0.9,当前记录.金额),2)"
          }
        },
        {
          "bFieldId": "textField_targetStatus",
          "bFieldName": "目标状态",
          "componentType": "TextField",
          "opCode": "Equal",
          "valueType": "literal",
          "value": "有效"
        }
      ]
    }
  ]
}
```

三个条件依次示范“字段、公式、值”。第一条用 `aFieldId` 引用上游字段；第二条 `value` 内还有一个 `value`，内层为执行文本，旁边是编辑器原文和显示文字；第三条 `value` 直接是固定文本。`logic` 放在取数节点这一层。

说明用输入：当前记录编号 `A1`、数量 `12`、金额 `100`，门槛为 `90`。

| 目标编号 | 目标金额 | 目标状态 | 预期是否匹配 |
| --- | --- | --- | --- |
| A1 | 91 | 有效 | 是 |
| A1 | 90 | 有效 | 否，大于不含等于 |
| B1 | 91 | 有效 | 否，编号不同 |
| A1 | 91 | 停用 | 否，状态不同 |

多条都匹配时，单条查询还需要业务确定排序或唯一性；不要用上表推断未配置的排序。需要多条时，根据业务改为 `retrieveType: "batch"` 并提供数量上限，另读批量数据说明。

## 嵌套分支：先决定是否复核，再决定级别

业务：金额至少 1000，且“加急”或“普通并已填说明”时需要复核；其中金额至少 5000 为高级复核，其余为普通复核；不满足第一层条件时标记无需复核。

执行层次：

```text
读取当前记录 self
→ 第一层 route：是否需要复核
  → 是：第二层 route：金额是否至少5000
    → 是：写高级复核
    → 其他：写普通复核
  → 其他：写无需复核
```

将下方对象保存为任务 integration 目录中的 `review-spec.json`。把 `numberField_amount`、`textField_type`、`textareaField_reason`、`textField_reviewLevel` 换成当前表单真实的金额、类型、说明和复核级别字段 ID。类型和级别在本例中都是文本字段；如果实际是选项组件，按其真实字段类型和值配置。

```json
{
  "events": [
    "insert"
  ],
  "nodes": [
    {
      "id": "self",
      "type": "getSelf",
      "formType": "receipt"
    },
    {
      "id": "reviewGate",
      "type": "route",
      "name": "判断是否需要复核",
      "branches": [
        {
          "id": "needReview",
          "name": "需要复核",
          "expression": {
            "value": "AND(GE(${self}.numberField_amount,1000),OR(EQ(${self}.textField_type,\"加急\"),AND(EQ(${self}.textField_type,\"普通\"),NOT(ISEMPTY(${self}.textareaField_reason)))))",
            "__source": "AND(GE(#{self//numberField_amount},1000),OR(EQ(#{self//textField_type},\"加急\"),AND(EQ(#{self//textField_type},\"普通\"),NOT(ISEMPTY(#{self//textareaField_reason})))))",
            "__display": "金额至少1000，且加急或普通并已填说明"
          },
          "nodes": [
            {
              "id": "reviewRank",
              "type": "route",
              "name": "判断复核级别",
              "branches": [
                {
                  "id": "senior",
                  "name": "金额至少5000",
                  "expression": {
                    "value": "GE(${self}.numberField_amount,5000)",
                    "__source": "GE(#{self//numberField_amount},5000)",
                    "__display": "金额至少5000"
                  },
                  "nodes": [
                    {
                      "id": "markSenior",
                      "type": "dataUpdate",
                      "source": "self",
                      "assignments": [
                        {
                          "column": "textField_reviewLevel",
                          "valueType": "literal",
                          "value": "高级复核"
                        }
                      ]
                    }
                  ]
                },
                {
                  "id": "normal",
                  "name": "其余需复核记录",
                  "default": true,
                  "nodes": [
                    {
                      "id": "markNormal",
                      "type": "dataUpdate",
                      "source": "self",
                      "assignments": [
                        {
                          "column": "textField_reviewLevel",
                          "valueType": "literal",
                          "value": "普通复核"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "id": "skipReview",
          "name": "无需复核",
          "default": true,
          "nodes": [
            {
              "id": "markSkipped",
              "type": "dataUpdate",
              "source": "self",
              "assignments": [
                {
                  "column": "textField_reviewLevel",
                  "valueType": "literal",
                  "value": "无需复核"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

第二个 `route` 在 `needReview.nodes` 里面；内层两个结果节点与外层兜底的结果节点放在各自分支的 `nodes`。每个分支分别选择 `expression` 或 `default`，没有同时填写普通 `conditions`。每个 route 都有自己的兜底，所有节点和分支别名都不重复。

| 金额 | 类型 | 说明 | 预期写入复核级别 |
| --- | --- | --- | --- |
| 5000 | 加急 | 空 | 高级复核 |
| 4999 | 加急 | 空 | 普通复核 |
| 1000 | 普通 | 已填写 | 普通复核 |
| 1000 | 普通 | 空 | 无需复核 |
| 999 | 加急 | 已填写 | 无需复核 |

本例仅声明新增事件 `insert`。要扩展为编辑触发时，先明确更新结果字段后是否会再次触发，以及如何避免重复处理。

## 使用与核对

示例文件通过结构化文件工具写入 `<projectRoot>/.cache/openyida/formula-demo/integration/`。下面命令从实际 project 根目录执行。先替换真实资源和字段，保留文件内的完整对象层级，再按 `yida-integration` 的授权和保存步骤处理。以下命令默认不启用；按任务需要选择其中一个文件：

```bash
openyida integration create APP_XXX FORM_TRIGGER "复杂取数" --spec .cache/openyida/formula-demo/integration/query-spec.json
openyida integration create APP_XXX FORM_TRIGGER "嵌套复核分支" --spec .cache/openyida/formula-demo/integration/review-spec.json
```

保存后对照 `value/__source/__display` 和节点输出回读。需要运行验收时，按授权范围核对上表的实际匹配和写入结果；用户暂停测试时仅保留示例与待验收状态。
