---
name: yida-schema-render
description: >
  宜搭自定义页面 SchemaRender 技能。用于通过 JSON Schema 声明式生成标准数据列表、详情卡片、表单面板、统计面板和操作栏，
  减少手写 JSX。适用于用户要求“用 Schema 生成页面”“配置式列表/详情/表单/统计”“yida-schema-render”等场景。
---

# yida-schema-render

## 目标

用声明式 JSON Schema 生成可发布的宜搭自定义页面。标准化部分交给 `SchemaRender`，个性化区域仍可继续手写 JSX。

当前 OpenYida CLI 生成的是**内联运行时页面**，无需外部 CDN 即可跑通；独立 runtime 包名为 `@openyida/schema-render`，源码仓库为 `git@github.com:openyida/schema-render.git`，拿到 `g.alicdn.com` 地址后再切换为外部加载。

## 何时使用

- 用户要做数据列表、详情页、录入表单、轻量统计卡片、批量操作栏
- 用户明确提到 Schema、配置式页面、`SchemaRender`、少写 JSX
- 页面主要由表单字段驱动，只有少量个性化交互

不适用：

- 大屏、复杂图表、强视觉编排：优先 `yida-dashboard` 或 `yida-chart`
- 大数据聚合：优先 `yida-report`，不要在前端拉全量明细聚合
- 完全自由交互页面：优先 `yida-custom-page`

## 执行流程

1. 确认 `appType`、目标数据表单 `formUuid` 和字段 ID；不确定时先用 `openyida get-schema <appType> <formUuid>`。
2. 在 `.cache/openyida/schema-render/<页面名>.json` 写入 Schema 配置。
3. 先生成本地预览：

```bash
openyida schema-render preview .cache/openyida/schema-render/customer-list.json
```

4. 生成自定义页面源码并编译：

```bash
openyida schema-render generate --schema .cache/openyida/schema-render/customer-list.json --output project/pages/src/ --compile
```

也可以从最小参数生成脚手架：

```bash
openyida schema-render generate APP_XXX FORM-YYY --type DataList --output project/pages/src/ --compile
```

5. 发布前继续执行常规检查：

```bash
openyida check-page project/pages/src/schema-render-data-list.oyd.jsx
openyida compile project/pages/src/schema-render-data-list.oyd.jsx
openyida publish project/pages/src/schema-render-data-list.oyd.jsx APP_XXX PAGE_FORM_UUID
```

> 发布参数里的 `PAGE_FORM_UUID` 必须是自定义展示页面的 `formUuid`，不是数据表单的 `formUuid`。

## 支持类型

| type | 说明 | 主要配置 |
|------|------|----------|
| `DataList` | 筛选器 + 表格 + 分页 | `dataSource`、`filters`、`columns`、`actions`、`pagination` |
| `DetailCard` | 详情卡片 | `dataSource`、`formInstId`、`fields` |
| `FormPanel` | 可提交表单面板 | `dataSource`、`fields`、`submit` |
| `StatBoard` | 轻量统计面板 | `dataSource`、`metrics`、`filters` |
| `ActionBar` | 操作按钮组 | `actions` |

详细字段定义见 [schema-types.md](references/schema-types.md)。

## 示例模板

通过 sample 命令复制示例：

```bash
openyida sample yida-schema-render data-list --output .cache/openyida/schema-render/customer-list.json
openyida sample yida-schema-render detail-card --output .cache/openyida/schema-render/customer-detail.json
openyida sample yida-schema-render form-panel --output .cache/openyida/schema-render/customer-form.json
openyida sample yida-schema-render stat-board --output .cache/openyida/schema-render/customer-stats.json
openyida sample yida-schema-render action-bar --output .cache/openyida/schema-render/actions.json
```

常见配置见 [schema-examples.md](references/schema-examples.md)。

## 规则

- 不要编造 `appType`、`formUuid`、`fieldId`；字段 ID 必须来自 `get-schema`、缓存或用户提供的 Schema。
- `DataList.pagination.pageSize` 和 `StatBoard.pagination.pageSize` 不得超过 100。
- `StatBoard` 只适合轻量预览聚合；正式经营指标优先用 `yida-report` 服务端聚合。
- 需要自定义行操作时，在 `actions[].handler` 填页面内 `export function` 名称，生成后再补对应函数。
- Schema 文件属于临时配置，优先放在 `.cache/openyida/schema-render/`；需要长期维护的页面源码放在 `project/pages/src/`。
