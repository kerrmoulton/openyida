# 批量取数、新增和子表多行复制

通过 `integration create --spec` 配置。批量查询用 `dataRetrieve`，批量新增用 `dataCreate`，不需要添加循环节点。

| 要做什么 | 配置 |
|----------|------|
| 获取多条数据 | `retrieveType: "batch"`，必填 `quantity` |
| 获取全部匹配范围 | `filterType: "all"`；仍最多取 `quantity` 条 |
| 按条件取多条 | `filterType: "condition"`，填写 `conditions` |
| 按源数据逐行新增 | `createType: "batch"`，`batchSource` 指向上游批量查询节点的别名 |
| 写入已有记录的子表 | `insertType: "sub_table"`，`source` 指向目标记录节点，`subFormUuid` 填目标子表 ID |

省略 `retrieveType` 或 `createType` 时仍为单条模式。也可用 `type: "GetBatchDataNode"` 表示批量查询。

## 示例：报价明细复制到新订单明细

先用 `get-schema --field-map-json` 获取源表和目标表的真实字段 ID。下面用 `getSelf` 读取本次报价单，取出其明细，创建一张订单，再逐行写入订单明细：

```json
{
  "events": ["insert"],
  "nodes": [
    { "id": "quote", "type": "getSelf" },
    {
      "id": "lines",
      "type": "dataRetrieve",
      "retrieveType": "batch",
      "originalType": "sub_table",
      "source": "quote",
      "subSourceId": "tableField_quoteLines",
      "filterType": "all",
      "quantity": 100
    },
    {
      "id": "order",
      "type": "dataCreate",
      "formUuid": "FORM_ORDER",
      "assignments": [
        { "column": "textField_orderName", "valueType": "literal", "value": "报价转订单" }
      ]
    },
    {
      "id": "copyLines",
      "type": "dataCreate",
      "createType": "batch",
      "insertType": "sub_table",
      "source": "order",
      "subFormUuid": "tableField_orderLines",
      "batchSource": "lines",
      "assignments": [
        { "column": "textField_product", "valueType": "processVar", "value": "${lines}.textField_quoteProduct" },
        { "column": "numberField_quantity", "valueType": "processVar", "value": "${lines}.numberField_quoteQuantity" }
      ]
    }
  ]
}
```

所有表单和字段 ID 都要替换成实际查询结果。字段赋值中的 `${lines}.字段ID` 表示当前源行；CLI 负责转换为平台的批量引用格式。固定值用 `literal`，公式用 `column`，如 `${lines}.numberField_quoteQuantity * 2`。

`source: "order"` 决定写入哪张订单，`batchSource: "lines"` 决定复制哪些行，两者不能混用。目标记录可来自 `getSelf`、获取单条主表数据，或新增单条普通表单数据；不能把多条记录作为同一个目标子表。

```bash
openyida integration create <appType> <源formUuid> "报价明细转订单" \
  --spec .cache/openyida/<任务名>/integration/batch-data.json
```

默认保存草稿。需要启用时按主技能的发布流程加 `--publish`。新订单的目标表必须是普通表单；当前 CLI 不支持批量发起流程表单。

## 限制与验证

- `quantity` 是本次查询上限，不代表自动分页取完。按实际行数设置；超过平台允许的条数时以服务端返回为准，CLI 不修改版本权益。
- 来源必须在当前执行分支的上游。CLI 在写入前核对源字段和目标子表，拒绝跨分支、目标不唯一及字段不属于该子表的配置。
- 发布回读会检查批量模式、来源、查询条数和目标配置。配置一致仍需实际触发，核对目标行数及每列值；源行超过 `quantity` 时不能宣称已整表复制。
- 写入结果未知时先查询，不能直接重试，避免重复生成订单或明细。已有自动化的 `integration update` 限制保持原样。
- 追加单行仍可用原来的 `dataCreate + insertType: "sub_table"`；按条件取一行仍用单条 `dataRetrieve`。
