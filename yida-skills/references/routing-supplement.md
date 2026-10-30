# 路由补充说明

## 用途

技能路由表保留在 `../SKILL.md`，供人工 fallback 和人审使用。`../skills-index.json` 是机器索引，供能读取索引的工具、构建、校验和评测使用。本文件说明二者如何对齐，并补充索引精排方法和没有独立子技能的 CLI。

## 主入口与机器索引

- `SKILL.md` 写人可读的执行步骤、技能路由表、高频分歧和核心规则。
- `skills-index.json` 写机器可读的 `route_groups`、技能 `category`、`tags`、`aliases`、信号和完成条件。
- 主入口不维护完整子技能清单；完整清单以 `skills-index.json` 为准。
- 两者只在大类目录、`route_groups[].name` 和技能归类上保持一致。

## 路由方法

能读取索引的工具优先按 `skills-index.json` 自动匹配；不能读取索引时，按主入口技能路由表人工 fallback。

先应用技能的显式触发边界，再做信号匹配：`yida-data-card` 只处理用户显式指定的宜搭原生数据卡片及其已明确的后续操作。泛称卡片、指标卡、看板或播报不触发；索引命中关键词不能替代用户选择。

同名卡片按配置归属分流：独立 CARD 资源与页面里的 Canvas/React 展示组件分别处理。页面存在 CARD 引用时，改页面外层仍选页面/UI 技能；只有明确修改源卡片才选 `yida-data-card`。FORM 也可能是原生卡片的数据源，ID 前缀本身不构成选择依据。

如果工具能读取索引，按这个顺序匹配：先用 `route_groups[].signals` 命中 `yida-skills/<area>` 大类；只在该 `category` 下用 skill 的 `description`、`tags`、`aliases`、`positive_signals` 精排；命中 `negative_signals` 的候选降权或剔除；再用“高频分歧”覆盖易混场景；最后调用 `use_skill`。`command_ids` 只用于解释该技能可能调用哪些 CLI，不要替代技能加载；`done_when` 只用于判断完成条件。`category` 是路由目录，不是技能路径，必须保持 `yida-skills/<简名>` 格式。

## 无独立子技能的 CLI

| 意图 | 直接执行 |
| --- | --- |
| 流程表单 AI 审批提示 | `openyida ai-form-setting` |
| 文生文 / 识图通用 AI 能力 | `openyida ai` |
| 批量顺序执行 OpenYida 命令 | `openyida batch` |
