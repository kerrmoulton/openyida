# 字段绑定与样例验证

用这份说明检查“公式能否算出值、值能否交给目标字段”。先读取字段 ID 和已存公式，再选择下面相应示例。这里的 ID 是说明用的，替换成真实 ID 后使用。

## 先分清三个结果

1. `rawValue`：平台已经按组件类型和公式依赖计算、绑定后的字段返回值；它不是公式引擎内部未经转换的原始值。
2. `value`：CLI 按原生回填规则转换的数值、日期或成员值；其他类型保留平台返回内容。
3. 页面显示与提交值：还受字段精度、日期格式、显示状态和提交策略影响，需要在实际页面检查。

例如平台返回 `"24.6"`，数值字段回填得到数字 `24.6`，页面设置两位小数后显示 `24.60`。前两步通过后，仍要核对第三步。

日期也分别核对这三步：`TIMESTAMP(TODAY())` 的接口结果可能带当天时分秒，而只显示年月日的组件可能在提交时保存当天零点。需要明确的零点结果时，查询并使用 `DAYBEGIN(TIMESTAMP(TODAY()))`，同时固定时区；不能把不同处理阶段的差异直接判为公式错误。

原生 `ISEMPTY` 会把纯空格文本视为空，例如 `ISEMPTY("  ")` 返回 `true`，与 JavaScript 的 `=== ""` 不同。把空字符串、纯空格、零和未填值分别列入业务样例，再核对当前绑定位置的结果，不按其他语言或工具的同名函数推断。

## 金额：读取、试算、保存、再试算

已有数值字段“单价、数量、金额”，目标金额保留两位小数。先读完整配置，保留原有设置和真实 ID：

```bash
openyida get-schema APP_XXX FORM_XXX
openyida formula inspect APP_XXX FORM_XXX --field numberField_total --json
```

将输入写入 `amount-data.json`：

```json
{"numberField_price":12.3,"numberField_qty":2}
```

先检查候选公式。命令中给出公式，只替换本次试算的目标公式，保存配置仍需下一步：

```bash
openyida formula test APP_XXX FORM_XXX 'ROUND(#{numberField_price}*#{numberField_qty},2)' --field numberField_total --data-file amount-data.json --expect 24.6 --json
```

预期 `value` 为数字 `24.6`。将下面完整变更写入 `amount-changes.json`：

```json
[
  {"action":"update","fieldId":"numberField_total","changes":{
    "formula":"ROUND(#{numberField_price}*#{numberField_qty},2)",
    "precision":2,"behavior":"READONLY"
  }}
]
```

```bash
openyida create-form update APP_XXX FORM_XXX amount-changes.json
openyida formula inspect APP_XXX FORM_XXX --field numberField_total --json
openyida formula test APP_XXX FORM_XXX --field numberField_total --data-file amount-data.json --expect 24.6 --json
```

最后一次省略公式文本，直接使用已保存的公式。确认回读内容与候选一致，再在页面填写相同数据，检查显示 `24.60` 和提交后金额 `24.6`。

已有记录的表单可能返回 `requiresConfirmation`，此时尚未保存。核对本次修改只涉及已授权的目标字段、已保留原配置后，按命令提示使用 `--force`；业务范围或目标不清楚时先澄清。

## 子表：先算每行，再汇总

完整字段变更见 [子表同行与主表汇总](field-values.md#子表同行计算与主表汇总的完整变更)。两条公式分别保存为：

- 子表金额：`ROUND(#{numberField_linePrice}*#{numberField_lineQty},2)`。
- 主表合计：`IF(ISEMPTY(#{numberField_lineAmount}),0,SUM(#{numberField_lineAmount}))`。空表返回 0，避免直接汇总空列时没有结果。

将下列内容写入 `table-data.json`。使用真实子表 ID 作为外层键，每行提供自己的单价、数量。计算列由平台重新计算，输入中可以省略：

```json
{
  "tableField_lines":[
    {"numberField_linePrice":12.3,"numberField_lineQty":2},
    {"numberField_linePrice":5,"numberField_lineQty":3}
  ]
}
```

```bash
openyida formula test APP_XXX FORM_XXX --field numberField_lineAmount --data-file table-data.json --expect '[24.6,15]' --json
openyida formula test APP_XXX FORM_XXX --field numberField_total --data-file table-data.json --expect 39.6 --json
```

子表目标返回按输入行顺序排列的数组；主表目标返回一个值。试算合计时，CLI 会先安排计算每行金额，再汇总；查看输出 `plan.bindings` 可以核对顺序。输入空子表时使用 `{"tableField_lines":[]}`，无需编造一行空数据。

检查空表时，把它单独写入样例文件并对主表合计设置 `--expect 0`。平台对空列直接执行 `SUM` 可能不给出字段值；应根据业务需要在公式中明确返回 0，保留空表输入。

## 多组样例：零值、负数、分支边界

把样例保存在任务目录中，修改公式后重跑同一文件。每项都有唯一 `name`、完整 `data` 和 JSON 类型的 `expect`，单次支持 1 至 100 项。

已有金额公式为上面的单价乘数量时，保存 `amount-cases.json`：

```json
[
  {"name":"普通金额","data":{"numberField_price":12.3,"numberField_qty":2},"expect":24.6},
  {"name":"数量为零","data":{"numberField_price":12.3,"numberField_qty":0},"expect":0},
  {"name":"负数","data":{"numberField_price":-2,"numberField_qty":3},"expect":-6},
  {"name":"保留两位","data":{"numberField_price":12.345,"numberField_qty":2},"expect":24.69}
]
```

```bash
openyida formula test APP_XXX FORM_XXX --field numberField_total --cases amount-cases.json --json
```

返回每项的输入计划、平台值、回填值和通过情况；任一项失败，命令返回失败退出码。多层 IF 示例还应给每档各一个样例，并检查边界前后，例如 `59/60/89/90`。空值显式写 `""` 或 `null`；数字零写 `0`。缺少输入字段会停止试算，避免把遗漏误当成空值。

## 日期和成员

日期字段使用 `TIMESTAMP(TODAY())`，并用 `--field` 检查目标字段确实得到毫秒时间戳。`--timezone-offset 480` 表示 UTC+8，单位为分钟、向东为正；默认值为 480，按实际使用地调整。

`TODAY()`、`NOW()` 和当前人员取决于执行时间与登录身份。动态日期应检查日期范围及页面显示，不把每次试算都等同于当天零点。需要固定结果回归时，可用 `TIMESTAMP(DATE(1792252800000))`，期望数字 `1792252800000`，对应 UTC+8 的 2026-10-18 零点。

这里 `DATE(毫秒时间戳)` 把已有时间戳转为日期对象。选择日期函数时查询其实际参数和含义，按宜搭返回的说明填写。

成员字段使用 `USER()`，样例数据可以是 `{}`。结果保持成员对象数组，检查成员 ID。字段开启的单选与值归一化属性也会影响回填，页面最终选择结果继续核对。

## 失败后按输出定位

| 输出或现象 | 含义和处理 |
| --- | --- |
| 缺少样例字段 | 补齐最初输入；子字段放在子表行中，使用真实 ID |
| 循环引用 | 调整“输入 → 中间结果 → 最终结果”的顺序，去掉自己引用自己或相互引用 |
| `field_result_missing` | 平台完成请求却没返回目标值；日期优先核对是否返回毫秒时间戳 |
| `target_conversion_empty` | 平台有值，回填数值或日期时变空；核对公式各分支和目标字段 |
| `target_conversion_partial` | 例如 `"12元"` 只解析出 `12`；让金额公式直接返回数字，单位放在显示设置里 |
| 结果看似一样仍失败 | 比较 JSON 类型：数字 `24.6` 与文本 `"24.6"` 不相同 |
| 接口成功但有字段计算错误 | 命令会报告平台的字段错误；修复后重跑同一组样例 |

本入口执行所选字段及其已存公式依赖，使用纯计算和已确认的上下文读取函数；写数据函数、未知函数以及需要专门预处理的 `EXIST/EQUAL` 会停止。自定义组件子属性、联动取数、跨节点变量等需要额外绑定信息，使用对应配置入口验证。

`checks.targetConversion: modeled` 表示复用了已确认的部分回填规则；`widgetFormatting/submission: not_run` 提醒继续做页面和提交验收。子表当前采用全行重算，未模拟每个页面事件的触发条件。
