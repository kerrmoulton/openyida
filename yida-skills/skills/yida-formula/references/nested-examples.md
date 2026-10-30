# 嵌套公式和校验示例

只读取当前需要的小节。下面的字段 ID 是便于说明的示例，使用前替换为目标配置的真实 ID。表中的结果是业务预期，用于说明边界，不是本轮已经运行通过的记录。

JSON 示例用结构化文件工具保存到 `<projectRoot>/.cache/openyida/formula-demo/formula/`；下面命令从实际 project 根目录执行。只使用本轮需要的小节，字段和应用 ID 都先替换。

## 先选需要的结构

| 需求 | 结构 | 例子 |
| --- | --- | --- |
| 分成三档返回文本 | `IF(条件一, 结果一, IF(条件二, 结果二, 其他结果))` | 分数等级 |
| A 成立，并且 B 或 C 成立 | `AND(A, OR(B, C))` | 复核条件 |
| 先处理数量，再算单价 | 在除数中放一个始终非零的值 | 数量为零的计算 |
| 满足条件时阻断提交 | 原生公式判断“什么情况要报错” | 提交校验 |
| 自定义校验通过 | JavaScript 返回“是否允许提交” | 同一规则的 JS 配置 |

先缩进理解每层含义，再写成 JSON 中的一个字符串。示例中字符串内部的双引号已用 `\"` 转义；复制 JSON 时保留转义。原生公式使用 `IF/AND/OR/NOT`，JS 表达式使用 `?:/&&/||/!` 及其回调参数。

## 三档判断：嵌套 IF

业务：分数大于等于 90 为优秀，60 到 90 之间为合格，其余待提高。分数来自必填数值字段，结果放在文本字段。

```text
IF(
  GE(#{numberField_score}, 90),
  "优秀",
  IF(
    GE(#{numberField_score}, 60),
    "合格",
    "待提高"
  )
)
```

第二个 `IF` 是第一个 `IF` 的第三个参数，即“未达到 90 分时继续判断”。保存到 `score-changes.json`：

```json
[
  {
    "action": "update",
    "fieldId": "textField_grade",
    "changes": {
      "formula": "IF(GE(#{numberField_score},90),\"优秀\",IF(GE(#{numberField_score},60),\"合格\",\"待提高\"))",
      "behavior": "READONLY"
    }
  }
]
```

```bash
openyida create-form update APP_XXX FORM_XXX .cache/openyida/formula-demo/formula/score-changes.json
```

| 分数 | 预期等级 |
| --- | --- |
| 90 | 优秀 |
| 89 | 合格 |
| 60 | 合格 |
| 59 | 待提高 |

三个 `IF` 参数都保留；从较高门槛往下判断，可以避免 90 分先被“达到 60”这一档截住。

## 多层条件：AND、OR、NOT

业务：金额至少 1000，而且满足以下任一项：类型是加急；或类型是普通且已填说明。

```text
AND(
  GE(#{numberField_amount}, 1000),
  OR(
    EQ(#{textField_type}, "加急"),
    AND(
      EQ(#{textField_type}, "普通"),
      NOT(ISEMPTY(#{textareaField_reason}))
    )
  )
)
```

外层 `AND` 同时要求“金额达标”和“内层任一项成立”。内层 `AND` 只把“普通”和“有说明”绑在一起。这个判断返回布尔值，适合支持公式判断的分支。要在文本字段显示结果，在最外层使用 IF，完整 `review-changes.json` 如下：

```json
[
  {
    "action": "update",
    "fieldId": "textField_review",
    "changes": {
      "formula": "IF(AND(GE(#{numberField_amount},1000),OR(EQ(#{textField_type},\"加急\"),AND(EQ(#{textField_type},\"普通\"),NOT(ISEMPTY(#{textareaField_reason}))))),\"需复核\",\"无需复核\")",
      "behavior": "READONLY"
    }
  }
]
```

`textField_review` 是要显示结果的目标文本字段，其他三个字段是输入。通过 `create-form update` 保存本文件；返回布尔值的版本和返回文本的版本分别用于合适的目标。

| 金额 | 类型 | 说明 | 预期是否复核 |
| --- | --- | --- | --- |
| 1000 | 加急 | 空 | 是 |
| 1000 | 普通 | 已填写 | 是 |
| 1000 | 普通 | 空 | 否 |
| 999 | 加急 | 已填写 | 否 |
| 1000 | 其他 | 已填写 | 否 |

放入完整节点 spec 时，运行引用和编辑器引用分别填写，见 [完整嵌套分支](node-examples.md#嵌套分支先决定是否复核再决定级别)。这里的空值指空字符串或未填值；若业务把纯空格也视为空，需要先确定文本清理规则。

## 数量为零：让除数始终非零

业务：金额与数量均为数值；数量大于零时算单价，数量小于等于零时单价为 0。先保证除数不为零，再做除法，避免依赖 `IF` 是否只计算命中的分支。

```text
ROUND(
  IF(GT(#{numberField_qty}, 0), #{numberField_amount}, 0)
  /
  IF(GT(#{numberField_qty}, 0), #{numberField_qty}, 1),
  2
)
```

数量无效时，分子为 0、分母为 1。保存到 `unit-price-changes.json` 的完整变更：

```json
[
  {
    "action": "update",
    "fieldId": "numberField_unitPrice",
    "changes": {
      "formula": "ROUND(IF(GT(#{numberField_qty},0),#{numberField_amount},0)/IF(GT(#{numberField_qty},0),#{numberField_qty},1),2)",
      "precision": 2,
      "behavior": "READONLY"
    }
  }
]
```

```bash
openyida create-form update APP_XXX FORM_XXX .cache/openyida/formula-demo/formula/unit-price-changes.json
```

| 金额 | 数量 | 预期单价 |
| --- | --- | --- |
| 100 | 4 | 25 |
| 100 | 0 | 0 |
| 100 | -1 | 0 |
| 100 | 0.5 | 200 |

字段未填时的规则另外明确：可以设为必填，也可以约定空值的业务结果；不要仅凭此数值示例推断平台如何转换空值。

## 同一提交规则：原生阻断公式与 JS 通过条件

业务：金额至少 1000，且类型为普通或加急时，必须填写说明。下面示例假定金额已设置必填；类型和说明均为文本值，空白说明也按未填写处理。

原生校验需要判断“是否应该阻断”。公式原文为：

```text
AND(
  GE(#{numberField_amount}, 1000),
  OR(EQ(#{textField_type}, "普通"), EQ(#{textField_type}, "加急")),
  ISEMPTY(TRIM(#{textareaField_reason}))
)
```

原生公式还要配提示和阻断标志，并由对应编辑器生成执行内容，完整保存方式见 [提交校验](expression-formats.md#提交校验)。本段是公式原文，不是 `create-form validation` 的 JSON。

使用 CLI 的自定义校验时，`true` 表示通过，因此对“应该阻断”的条件整体取反。`value` 是当前金额，其他字段通过 `getFieldValue(真实ID)` 读取。写成 `validations.json`：

```json
[
  {
    "type": "custom",
    "fieldId": "numberField_amount",
    "expression": "!(Number(value) >= 1000 && (getFieldValue('textField_type') === '普通' || getFieldValue('textField_type') === '加急') && (getFieldValue('textareaField_reason') == null || String(getFieldValue('textareaField_reason')).trim() === ''))",
    "message": "金额达到1000且类型为普通或加急时，请填写说明"
  }
]
```

```bash
openyida create-form validation APP_XXX FORM_XXX .cache/openyida/formula-demo/formula/validations.json
```

| 金额 | 类型 | 说明 | 原生阻断公式 | JS 校验 |
| --- | --- | --- | --- | --- |
| 1000 | 普通 | 空 | true，阻断 | false，不通过 |
| 1000 | 加急 | 已填写 | false | true，通过 |
| 999 | 普通 | 空 | false | true，通过 |
| 1000 | 免审 | 空 | false | true，通过 |

选择其中一种实际配置方式即可。`create-form rule` 的赋值表达式提供完整 `fields` 映射；当前自定义校验的 `fields` 仅含当前字段。跨字段校验使用 `getFieldValue`，不能套用联动赋值的参数假设。
