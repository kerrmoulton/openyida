---
name: yida-form-view
description: 宜搭原生数据管理视图配置。读取全部视图、显示列和表格设置，配置字段显隐与顺序、列宽、冻结列、默认筛选，新建表格视图及调整视图顺序。保留表单字段、业务记录和权限。
---

# 原生表单视图

用于原生数据管理页的配置；仅换颜色、边框和密度用 `yida-data-manage-ui`，修改表单字段用 `yida-create-form-page`，查询记录用 `yida-data-management`。

## 执行

1. 按根技能核验登录和 app/form 上下文，复用已有表单。不要创建同名表单或用自定义页面替换原生列表。
2. 执行 `openyida form-view list <appType> <formUuid> --with-config --json`，读取全部视图及 `staticConfig/defaultConfig`。选择返回的真实 `viewUuid`，不要猜测或把 `formUuid` 当作视图 ID。
3. 执行 `openyida form-view inspect <appType> <formUuid> <viewUuid> --json`。消费 `fields[].id/operatorMap`、`config` 和 `configHash`；需要业务字段身份时同时使用 `get-schema --compact --resolve-fields`。操作符大小写与平台返回一致，不猜测 `eq/EQ`。
4. 将本轮最小配置写到项目缓存 JSON 文件；执行 `openyida form-view save <appType> <formUuid> <viewUuid> --config <file> --expected-hash <configHash> --json`。CLI 先备份，再保存并回读；仅 `readbackVerified=true` 为配置成功。
5. 打开真实数据管理页，验证列顺序、宽度、冻结、筛选、横向滚动及记录。个人浏览器视图偏好可能覆盖管理员默认配置，不能仅凭 API 回读宣称浏览器验收通过。

## 配置映射

| 配置 | 原生字段 |
| --- | --- |
| 默认显示列及顺序 | `defaultConfig.showFields`，真实字段 ID 数组；`"all"` 为全部；不能传空数组 |
| 列宽 | `defaultConfig.widths`，字段 ID 到正数像素宽度的对象；`null` 清空宽度设置 |
| 冻结列 | `defaultConfig.lockFieldIds`，已显示字段 ID 数组；`[]` 取消冻结 |
| 默认筛选 | `defaultConfig.filter`，`values/operationValues/conditionType` 原生对象；`{}` 清空 |
| 默认排序 | `defaultConfig.sort`，`[{"id":"真实字段ID","isAsc":"y"}]`；`n` 降序 |
| 可用字段 | `staticConfig.columnFilter`，字段 ID 数组，平台 `['all']` 表示全部；它不是数据权限 |
| 视图数据范围 | `staticConfig.dataRange`，使用现有原生规则结构；`{}` 清空，验收实际查询结果 |

示例（必须替换为 inspect 返回的真实字段 ID）：

```json
{
  "defaultConfig": {
    "showFields": ["textField_REAL", "selectField_REAL"],
    "widths": {"textField_REAL": 280, "selectField_REAL": 160},
    "lockFieldIds": ["textField_REAL"]
  }
}
```

对象递归合并，数组替换；`filter` 和 `dataRange` 整体替换。未指定的配置保留；不要提交从空对象重造的整套设置。服务端自动更新 `latestUpdateTime`，不能把它当成用户配置。

## 多视图

```bash
openyida form-view create <appType> <formUuid> --name "待处理订单" --json
openyida form-view order <appType> <formUuid> --config <order.json> --json
```

create 只新建 table 视图，成功后复用返回 UUID 再配置。order 文件是包含当前全部视图 UUID 的数组（包括 form 视图），每项恰好一次，首项为默认入口。当前写配置仅支持 table，读取保留其他视图类型。

## 失败与恢复

- `FORM_VIEW_CONFLICT`：重新 inspect 后合并本轮修改；平台没有原子条件写入，避免多人同时编辑。
- 平台版本或权限拒绝：保留平台错误，停止写入；不修改版本、授权或额度。
- 写入传输错误/回读不一致：保留 `backupPath`，先 inspect 核对线上结果；不自动重放 create/save。
- save 的备份文件包含原配置 `config.staticConfig/defaultConfig`。恢复时提取这两个对象写入恢复文件，重新 inspect 后使用 `save --replace --expected-hash <当前哈希>`；全量恢复必须提供两个完整配置对象，删除备份后新增的设置；其他资源和记录不在视图备份范围内。
