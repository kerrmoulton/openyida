# 原生柱状图动态隐藏零值

## 启用前提

- 用户明确要求隐藏数值 0；默认关闭。只说“空值不显示”时不要将空值等同于 0。
- 隐藏数字、隐藏分类、隐藏图例是三个独立选择。范围不明确时通过 `ask_human` 确认，用户已经明确选择时不重复询问。
- 已核实当前应用、原生报表及图表 `cid`。支持 `bar`／`YoushuGroupedBarChart`，其他类型在写入前报错。
- 已有自定义 `afterFetch` 时拒绝覆盖；只能管理 CLI 自身生成的隐藏函数或默认恒等函数。

## 创建／追加示例

在实际图表配置中增加布尔值开关。以下字段 ID 是占位符，必须替换为当前数据源真实字段：

```json
{
  "type": "bar",
  "title": "巡检结果",
  "cubeCode": "FORM_REPLACE",
  "xField": { "fieldCode": "textField_department", "dataType": "STRING" },
  "yField": [
    { "fieldCode": "numberField_reception", "aliasName": "门迎接待", "dataType": "NUMBER", "aggregateType": "SUM" },
    { "fieldCode": "numberField_hygiene", "aliasName": "设备卫生", "dataType": "NUMBER", "aggregateType": "SUM" }
  ],
  "hideZeroValues": true,
  "hideZeroCategories": false,
  "hideZeroLegends": false
}
```

该配置可用于 `create-report` 和 `append-chart`。三个开关默认均为 false；后两个开关只有在 hideZeroValues=true 时才可开启。仅输入布尔值 `true`／`false`，不接受字符串 `"true"`、数字 1 或 null。

上例实现“零售一、二部虽然都是 0，仍在分类轴上展示，只去掉 0 标签及提示项”。已有图表可通过 `--hide-zero-categories false --hide-zero-legends false` 明确切回该范围；configure 中省略的分类／图例开关保留已有值。

## 行为和边界

| 当前聚合结果 | 显示结果 |
| --- | --- |
| 某分类为 `0, 1` | 仅显示 1 的标签和提示项，保留分类 |
| 某分类为 `0, null` | 默认保留分类轴名称；仅 hideZeroCategories=true 时隐藏分类 |
| 某指标在当前所有分类均为 0 或空 | 默认保留图例；仅 hideZeroLegends=true 时隐藏图例 |
| 某指标为 `0, 2` | 保留该指标全局图例，零值所在分类不显示该提示项 |
| 后续查询该指标由全零变为非零 | 自动恢复指标和图例 |
| 负数、极小非零数 | 保留，不按精度或正负过滤 |

只处理当前返回的聚合数据。`COUNT` 的结果本身为 0 才隐藏；不能通过此开关把“值为 0 的原始记录”从计数中排除。若正负值求和为 0，该聚合结果也会隐藏。缓存刷新和数据同步延迟仍遵循宜搭原生报表机制，CLI 不改变缓存设置。

不要对宽表多个指标同时添加 `指标 > 0` 的 AND 条件：那会丢掉“某指标为 0、其他指标非零”的整条分类，并会错误排除负值。此功能保留服务端聚合结果，通过原生“返回数据处理”钩子生成展示数据；不进行表单分页拉取或前端重新聚合。

钩子将零值和空值转为图表可跳过的 null；仅启用分类隐藏时过滤全零分类行，仅启用图例隐藏时从每次查询的新 metadata 中移除全零指标的 yField 角色。字段绑定始终保留，后续查询可以恢复。原生数据 API 返回的原始聚合数据不因此改变；其他自定义页面消费报表接口时需自行处理展示。

## 配置与验证

1. `report inspect` 读取真实 `cid` 和三个开关（true／false；已有自定义钩子时为 null，不能判断其行为）；`report configure ... --hide-zero-values true --dry-run --json` 只读预检。
2. 正式配置只保存一次，使用服务器 revision 防止覆盖并发编辑，严格回读整个 Schema，再查询所选图表。
3. `readbackVerified` 与 `runtimeQueryVerified` 分别表示配置回读和数据查询成功，不等同于浏览器展示验收。
4. 浏览器验收覆盖混合零／非零、保留全零分类但隐藏 0、隐藏全零分类、按开关保留／隐藏全零指标图例、后续恢复非零。
5. 用户明确要求关闭时使用 `--hide-zero-values false`。重复设置相同状态不保存。

`REPORT_CONFIGURE_SAVE_FAILED` 表示保存结果未确认；`REPORT_CONFIGURE_READBACK_FAILED`／`REPORT_CONFIGURE_QUERY_FAILED` 表示已写入但验证未完成。读取结构化 `details` 中的目标、`retrySafe`、`sideEffectState`、`nextStep`，先检查同一报表，禁止自动重放或新建替代报表。
