# 原生多组件卡片配置与验收

`data-card save --config` 接受 `{ "charts": [...], "filters": [...] }`。原有 `{ "indicators": [...] }` 继续可用。两种格式不能混用；每次追加组件，卡片内现有与新增图表合计不得超过五个。修改已有组件优先导出并编辑完整 Schema，不要重复追加同一配置。

## 支持范围

| type | 原生组件 | 配置角色 |
| --- | --- | --- |
| indicator | 基础指标卡 | kpi、可选 helpKpi；单组件可有多个指标 |
| bar | 柱状图 | xField、yField、可选 groupField |
| line | 折线图 | xField、yField、可选 groupField |
| pie | 饼图 | xField、yField |
| table | 基础表格 | columnFields |
| combo | 柱线混合图 | xField、leftYFields、rightYFields |
| gauge | 仪表盘 | valueField、可选 assitValueField、range |
| funnel | 漏斗图 | xField、yField |
| calendarheatmap | 日历热力图 | 日期 xField、数值 yField |

每个图表还包含 `title` 和真实 `formUuid`。`w` 为 1–6 的栅格宽度；表格默认 6，其他默认 3，可显式调整。`h` 为正整数行高，当前范围 1–100。指标组件可设 `columns: 1..4`；仪表盘可设 `range: { "min": 0, "max": 100 }`，刻度必须与指标单位一致，不能把普通数量误称为达成率。未列出的组件、任意脚本表达式或设置键会被拒绝，不静默替换图表。

字段配置为 `{ "fieldId": "真实字段ID", "aggregate": "SUM", "label": "销售额" }`。CLI 读取真实表单字段校验身份和类型；当前支持文本、多行文本、流水号、数字、单选、下拉单选和日期，子表及多选聚合不在生成范围。

- 数字度量可用 COUNT、SUM、AVG、MIN、MAX。文本及分类字段只支持 COUNT 或作为维度；维度使用 NONE。
- 日期字段可设 `timeGranularity: YEAR|MONTH|DAY|HOUR|MINUTE|SECOND`，默认 DAY。不要把毫秒时间戳当数值求和，或把日期字符串字段当原生日期。
- COUNT 统计所选字段的非空值，不等于总记录数；零与负数是有效数值。用必填业务编号计订单数，用可空字段 COUNT 计已填数量，空值不能补成零来凑数。
- 饼图和漏斗需要检查数值与业务语义：负金额可在指标和明细中正常展示，不应取绝对值凑占比；状态分布也不等于有先后顺序的业务转化链路。
- 下拉字段存在原始 ID 与报表 `_value` 表示的差别。只读回 Schema 不足以确认字段可查询，必须执行 probe；遇到元数据错误保留原卡片，不能换字段、换账号或新建同名卡片掩盖失败。
- 简化配置当前没有数字精度、千分位、货币单位和自定义日期显示格式的 DSL。AVG 可能显示长小数，表格日期可能为紧凑编码；这些是显示能力缺口，不要改原始金额、日期或伪造数据来美化。完整原生 Schema 可保留已经核实的格式配置。

## 多图与筛选示例

以下 ID 均为占位，必须先通过 get-schema 获取真实值：

```json
{
  "charts": [
    {
      "type": "indicator", "title": "订单经营指标", "formUuid": "FORM-真实ID", "columns": 2,
      "kpi": [
        { "fieldId": "numberField_真实金额", "aggregate": "SUM", "label": "销售合计" },
        { "fieldId": "textField_真实编号", "aggregate": "COUNT", "label": "订单数" }
      ]
    },
    {
      "type": "line", "title": "每日销售趋势", "formUuid": "FORM-真实ID",
      "xField": { "fieldId": "dateField_真实日期", "aggregate": "NONE", "timeGranularity": "DAY" },
      "yField": [{ "fieldId": "numberField_真实金额", "aggregate": "SUM" }]
    }
  ],
  "filters": [{
    "type": "select", "title": "区域", "formUuid": "FORM-真实ID",
    "fieldId": "selectField_真实区域", "linkTo": [0, 1]
  }]
}
```

筛选只支持本卡片内的下拉筛选，可连接文本或单选字段。`linkTo` 是本次 charts 的索引；省略时连接同一表单的新增图表，不会修改既有图表。跨表单即使字段同名，也不能把同一个筛选直接连接过去；应分别配置筛选和明确作用范围。时间/区间筛选尚未进入生成 DSL。已有筛选头部不能自动追加新筛选，需读出并编辑完整配置，保护原联动关系。

## 必须完成的验收

1. CLI 创建或读取、生成配置、保存、发布；保存和发布分别回读。不要用浏览器补配置后当作 CLI 已支持。
2. `openyida data-card probe APP_XXX CARD-xxx --published --json` 逐组件查询原生 CARD 运行时，核对返回的 data/meta 和真实数值。`runtimeQueryVerified` 只证明这些查询成功，不证明视觉效果或筛选正确。
3. 浏览器查看每种组件，逐块滚入可见区域并等待加载。平台会延迟加载屏幕外组件；初始“暂无数据”或筛选后暂留旧数据不能直接判错。
4. 测试筛选前、筛选后和重置，核对指标、分类图、趋势及表格的记录范围；复杂卡片需检查下方组件是否加载更新，不能只验顶部指标。
5. 检查 PC/窄屏布局、长字段名、空值、零、负数、日期、数值单位和格式。数据查询成功但图表不渲染、字段不可编辑或显示语义错误，均不能当作完整验收。
6. 至少覆盖六组件超限、非法聚合、子表字段、未知组件、错误筛选作用域及旧摘要冲突的失败路径；失败不修改配额、权益、应用标记或业务数据。

## 产品规则来源

- [官方卡片搭建](https://docs.aliwork.com/docs/yida_support/_11/xm7x0w/yvp9hw/cpkmxvpgchx339qq/nosysc2swtkkph3p)：单卡五个图表、卡内筛选、保存与发布语义。服务端限制仍是最终判定。
- [官方数据卡片](https://docs.aliwork.com/docs/yida_support/_11/xm7x0w/yvp9hw/cpkmxvpgchx339qq)：卡片资源权益和管理角色；报表指标组件可用不代表有创建数据卡片的权益。

发布不等于门户挂载或播报配置；当前命令不会投放、开启定时播报或发送测试消息。
