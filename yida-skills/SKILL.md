---
name: openyida
description: >
  宜搭 AI 应用开发总入口技能。通过有 AI Coding 能力的智能体（悟空/Claude/Open Code 等）+ 宜搭低代码平台，实现一句话生成完整应用。
  包含应用创建、表单设计、自定义页面开发、页面发布、登录态管理等完整开发流程。
  当用户提到"宜搭"、"yida"、"低代码"、"创建应用"、"创建表单"、"发布页面"、"搭建"、"系统"等关键词时，使用此技能；以下情况不要触发：只是讨论通用前端/后端代码、非宜搭平台产品、或只需要解释概念而不操作宜搭资源。
---

# 宜搭 AI 应用开发指南

通过有 AI Coding 能力的智能体（悟空/Claude/Open Code 等）+ 宜搭低代码平台，实现一句话生成完整应用。所有操作通过 **`openyida`** CLI 统一执行，命令自动读取 `.cache/cookies.json`，Cookie 失效时自动触发登录，无需手动登录。

---

## 宿主能力适配

- 如果当前宿主提供 `use_skill` / `search_skills`：必须通过 `use_skill("<技能名>", "<本阶段目的>")` 加载主技能和子技能，禁止用 `Read` / `read_file` / `cat` 读取 `SKILL.md` 路径；`use_skill` 会稳定返回技能内容和可读取的辅助文件列表。
- `skills-index.json` 仅供 yida-agent 或同构宿主做机器可读发现；不支持该索引的宿主忽略它，不要把它当作运行前置条件。
- 如果当前宿主没有 `use_skill` / `search_skills`：按本文的技能路由表选定技能名，再按技能包相对路径逐个读取当前阶段唯一必要的 `SKILL.md`；禁止并发批量读取多个 `SKILL.md`；禁止预读未来阶段技能。
- `references/`、`scripts/`、`assets/` 等辅助文件只能在已加载对应技能后按需读取。

---

## 第一步：环境与登录态检测（必做必读，先于一切操作）

> ⚡ **前置门槛**：确认 openyida 已安装、Node/npm 依赖达标、登录态就绪。**未通过只读验证前，禁止创建应用/页面/表单或发布等任何真实资源操作。**

**怎么做**：跑 `openyida env --json`（能跑 = 已安装，输出含 AI 工具 / project / 登录态）和 `openyida login --check-only --json`（只读登录态），再据结果对症处理：

| 检测结果 | 处理 |
|---------|------|
| 命令跑不了（`command not found`） | openyida 未安装 → `npm install -g openyida` |
| Node/npm 版本不达标 | 先升级 Node（≥16）再装/升级 openyida |
| `login.loggedIn` 为 false | 未登录 → `openyida login`（指定入口带 URL 或 flag） |
| `active.projectRootExists` 为 false | 无工作目录 → `openyida copy` 初始化 |

**👉 完整命令解读、悟空降级、Codex handoff 等特殊分支 → [references/setup-and-env.md](references/setup-and-env.md)（必读）。**

---

## 第二步：意图路由（先判断「全量搭建」还是「单一任务」）

> ⚡ **环境就绪后，先判断用户诉求属于哪一类，再走对应路线**：从零搭一个完整应用，还是对已有资源做单点改动。选错会导致多余步骤或回退；歧义时简短确认一次即可。

| 用户诉求信号 | 判定 | 走哪条路线 |
|------------|------|-----------|
| 创建/搭建/做一个 + 应用/系统/管理系统；或明确表达从零开始 | **全量搭建** | 走 [完整开发流程](#完整开发流程全量搭建)，从 Step 1 顺序执行 |
| 对已有应用/表单/页面的单点操作（加字段、查改数据、配公式、建报表、改权限、发布、美化…） | **单一 / 增量任务** | 到 [技能路由](#技能路由单一--增量任务) 选定 **1 个**，加载对应子技能执行，不回退流程 |

---

## 完整开发流程（全量搭建）

> 📌 仅当第二步判定为「全量搭建」时进入；单一/增量任务请跳「技能路由」。
> 在支持 `use_skill` 的宿主中，先加载 `yida-app` 流程编排技能；进入每个阶段前，再加载该阶段唯一需要的子技能，不要预读未来阶段技能。

```
[Step 1] 创建应用 → openyida create-app          → 获得 appType
              ↓
[Step 2] 需求分析 → 写入 prd/<项目名>.md
              ↓      （必须含 MVP 边界、角色权限、核心旅程、状态机、数据约束、验收标准）
              ↓
[Step 3]（按需）创建/更新表单 → openyida create-form → 获得 formUuid + fieldId（表单）
              ↓
[Step 4] 创建自定义页面 → openyida create-page    → 获得 formUuid（看板用 --mode dashboard）
              ↓
[Step 5] 编写自定义页面代码 → 先按「自定义页面选路」定链路（**默认 Code Canvas yida-canvas-custom-page**，含开放 API 读数据页；仅强依赖原生实例数据桥的页回退 native yida-custom-page）
              ↓  （首次生成面向用户的页必做：先用 yida-page-uiux 产出「视觉方向决策块」，避免统一灰白圆角的 AI 味模板脸，再交所选链路落地）
              ↓
[Step 6] 发布页面 → openyida publish
              ↓
[Step 7]（含看板/多页面时必做）整理导航顺序 → openyida nav-group order
              ↓      （总览/驾驶舱看板作为门面靠前，数据录入/明细表单在后）
              ↓
[Step 8]（有表单时默认执行）灌入示例数据 → openyida data create form
              ↓      （2-3 条覆盖关键维度的记录，让看板首屏有真实数据；DateField 用 13 位毫秒时间戳，灌后 query 抽查非空）
              ↓
[Step 9]（按需）配置公开访问 → openyida verify-short-url / save-share-config
              ↓
[Step 10] 输出访问链接，用系统浏览器打开
```

> **Step 5 先定视觉方向（首次生成面向用户页必做）**：写 JSX 前调用 `use_skill("yida-page-uiux", "确定自定义页面视觉方向并产出决策块")` 锁定视觉方向（页面类型判定 → 意图解码 → 差异化决策 → 去 AI 味自检），产出「视觉方向决策块」，再交所选链路（默认 `yida-canvas-custom-page`，回退 `yida-custom-page`）按 `design-system.md` token 落地。跳过此步会直接套用统一灰白圆角模板，生成有 AI 味的平庸页面。
>
> **Step 7 导航整理（含看板/多页面时必做）**：首次生成完整应用后，必须基于业务信息架构重排导航，不能保留创建时的默认顺序。默认原则：面向决策者的**总览/驾驶舱看板作为应用门面靠前**，数据录入/明细表单在其后；同级多个专题看板按业务优先级排，不要把所有页面无脑堆最前。进入本阶段前调用 `use_skill("yida-nav-group", "整理应用导航顺序")`。
>
> **Step 8 灌入示例数据（有表单时默认执行）**：新建应用的表单默认无数据，看板会空。导航整理完成后，默认向核心表单灌入 **2-3 条**覆盖关键维度（如不同活动/渠道/日期）的示例记录，让看板首屏可展示真实聚合效果。`DateField`/`CascadeDateField` 必须用 13 位毫秒时间戳；灌后执行 `openyida data query` 抽查至少 1 条，确认字段值非空。进入本阶段前调用 `use_skill("yida-data-management", "写入和抽查示例数据")`。

---

## 技能路由（单一 / 增量任务）

> 选定 **1 个**最匹配的项执行。表**按业务域分组**，每组内既可能是 skill 也可能是 CLI：
> - 行名为 `yida-xxx` / `sls-log-workbench` / `large-file-write` 的是 **skill** → 在支持 `use_skill` 的宿主中调用 `use_skill("<技能名>", "<本次目的>")` 加载后执行；
> - 行名为 `openyida xxx` 并标 **`CLI`** 的**无 SKILL.md** → 识别到诉求直接执行命令、**不要当 skill 去 read**。
>
> 按分组 +「何时选择」内联区别对号入座即可。

> ⚠️ **同类易错先分清**：改字段结构→`create-form-page`｜只读 Schema→`get-schema`｜改数据记录→`data-management`｜详情页美化→`form-detail`；自定义页视觉方向/去AI味→`page-uiux`(定方向)｜token/组件实现→`custom-page`(design-system)；加导航先分清→平台左侧菜单分组/排序→`nav-group`｜页面隐藏应用导航后页面内自绘导航壳→`nav-shell`（必须隐藏原导航，并让导航项 URL 带 `isRenderNav=false` 等参数）；字段实时校验→`formula`｜提交后编排→`integration`｜跨表高级函数→`business-rule`；从零建流程→`create-process`｜改已有流程→`process-rule`；权限按层级：组织→`corp-manager`／应用→`app-permission`／表单→`form-permission`／页面分享→`page-config`；**自定义页面选路见下方专表**。

> 🧭 **自定义页面选路（默认 Code Canvas，按顺序命中即停）**：
> 1. **默认 → Code Canvas** `yida-canvas-custom-page`：现代 React 交互 / hooks 状态 / 可视化 / AI 生成 / 需崩溃隔离，**以及只需通过开放 API（HTTP）读取宜搭数据的页面**（Canvas 自写 fetch 即可拿数据）；
> 2. 仅当页面强依赖**原生实例数据桥**——表单内字段双向绑定 `this.$(fieldId)`、`this.utils.yida.*`、`dataSourceMap`、提交流程 / 设计器数据源深度耦合，且用开放 API 重写代价过高 → 回退 **native** `yida-custom-page`；
> 3. 已有普通 `.oyd.jsx` 要迁到 Canvas → `yida-canvas-upgrade`。
>
> 依据（源码核实）：Canvas 代码在宿主页真实 `window` 中 `new Function` 执行，但物料只透传 `code/runtimeCode/importedModules/pageType`，**无 `this` 上下文、无 `dataSourceMap`**，`this.utils.yida.*` 不可用；宿主 window 全局（`__yida_plugin_runtime__` 插件系统、`__VcDeepYidaUtils__`）均非表单数据桥，也无 `window.Deep` 字段组件。Canvas 读宜搭数据 = 在 `YidaComp` 内自写 HTTP 调开放 API。只有需要免费 `this` 实例桥的页才留 native。

| 分组 | 加载目标 | 何时选择（关键区别已内联） |
|------|------|--------------------------|
| **应用与登录** | 加载子技能 `yida-app` | 从零搭建整个应用（多步骤全流程编排） |
| | 加载子技能 `yida-create-app` | 只需创建应用、拿 appType |
| | 加载子技能 `yida-login` | 手动触发登录（通常自动触发） |
| | 加载子技能 `yida-logout` | 切换账号或组织 |
| **页面与表单** | 加载子技能 `yida-create-page` | 创建空白自定义页面拿 formUuid，后续写 JSX |
| | 加载子技能 `yida-create-form-page` | 创建/更新表单、增删改**字段结构**（普通表单，无审批） |
| | 加载子技能 `yida-create-process` | 从零建**带审批**流程表单（表单还不存在，一步到位） |
| | 加载子技能 `yida-page-uiux` | 写自定义页面 UI 前先定视觉方向、去 AI 味（工作台/看板/列表/详情/官网落地页；产出决策块，不写代码；canvas / native 两链路通用） |
| | 加载子技能 `yida-canvas-custom-page` | **自定义页面默认链路**：现代 React 交互 / hooks / 可视化 / AI 页，含只需开放 API HTTP 读数据的页（Code Canvas，`runtimeCode` + `importedModules`，真 React18 + 崩溃隔离） |
| | 加载子技能 `yida-custom-page` | 回退项：仅当强依赖原生实例数据桥（`this.$(fieldId)` 双向绑定 / `this.utils.yida.*` / `dataSourceMap` / 提交流程深度耦合）时才用（native `.oyd.jsx` 链路） |
| | 加载子技能 `yida-canvas-upgrade` | 将已有普通 `.oyd.jsx` / `Jsx` 页面升级迁移到 Code Canvas / `YidaCodeCanvas` 链路 |
| | 加载子技能 `yida-nav-shell` | 自定义页**隐藏应用导航**（`isRenderNav=false`，沉浸/门户/大屏/分享）后，页面内用 JSX 自绘侧边/顶部/浮动/标签导航壳；发布后要配置隐藏原导航，跨页导航项要拼完整 URL 并合并 `isRenderNav=false` / `corpid` / 业务参数（**区别** `yida-nav-group` 平台左侧菜单分组：那是真实导航树，本项是页面内自建导航） |
| | 加载子技能 `yida-publish-page` | JSX 写完后编译并发布 |
| | 加载子技能 `yida-openyida-publish-guard` | 发布已有自定义页面前检查线上设计器状态，避免本地旧源码覆盖用户在线改动 |
| | 加载子技能 `yida-table-form` | Excel 式表格批量录入提交 |
| | 加载子技能 `yida-ppt-slider` | 全屏幻灯片页面（分享/路演/培训/演示） |
| | `openyida aggregate-table` `CLI` | 聚合表 / 虚拟视图（virtualView）：`list` 列出 · `create-empty` 建空白（返回设计器 URL）· `preview` 预览不保存 · `publish` 发布配置 |
| **数据可视化** | 加载子技能 `yida-report` | 普通报表/统计，开箱即用（原生 16 组件） |
| | 加载子技能 `yida-chart` | 更美观/定制化/数据大屏（ECharts） |
| | 加载子技能 `yida-dashboard` | 完整看板 / 驾驶舱产品化交付 |
| **连接器** | 加载子技能 `yida-connector` | 创建/管理连接器、配鉴权 |
| | 加载子技能 `yida-connector-safe-actions` | 连接器已有，从 API 代码生成执行动作 |
| | 加载子技能 `yida-data-source-connectors` | 自定义页面中通过数据源调用连接器 |
| **数据与公式** | 加载子技能 `yida-data-management` | 增删改查**数据记录**，不动字段结构 |
| | 加载子技能 `yida-get-schema` | **只读**查 Schema / 字段 ID，不改结构 |
| | 加载子技能 `yida-formula` | 配在**字段属性**上的实时计算/默认值/校验 |
| | 加载子技能 `yida-formula-evaluate` | 公式语法与字段引用静态检查 |
| | 加载子技能 `yida-business-rule` | 提交后**跨表**高级函数 INSERT/UPDATE/DELETE |
| **流程与自动化** | 加载子技能 `yida-process-rule` | **改已有**流程节点/分支/字段权限（表单已存在） |
| | 加载子技能 `yida-integration` | 提交后**逻辑编排**（图形化自动化流，推荐） |
| | 加载子技能 `yida-agent-center` | 流程代理（在职/离职代理人） |
| | `openyida ai-form-setting` `CLI` | 流程表单 AI 审批提示：`models` 查模型 · `fields` 查可插入字段（TEXT/IMAGE/ATTACHMENT）· `get` 查配置 |
| **权限与访问** | 加载子技能 `yida-corp-manager` | **组织级**权限（平台/子管理员、通讯录，影响整个组织） |
| | 加载子技能 `yida-app-permission` | **单应用级**权限（应用管理员/开发成员） |
| | 加载子技能 `yida-form-permission` | **单表单级**权限（权限组/数据范围） |
| | 加载子技能 `yida-page-config` | **页面级**：公开访问 / 组织内分享 |
| **应用配置与平台** | 加载子技能 `yida-nav-group` | 应用**左侧菜单**分组/排序（真实导航树；页面内自绘导航壳见 `yida-nav-shell`） |
| | 加载子技能 `yida-form-detail` | 只注 **CSS** 美化详情页，不改字段 |
| | 加载子技能 `yida-density` | 列表/表格信息密度选择 |
| | 加载子技能 `yida-i18n` | 应用多语言 / 国际化 |
| | 加载子技能 `yida-basic-info` | 组织版本/容量/域名/额度查询 |
| | 加载子技能 `yida-corp-efficiency` | 企业效能 / 低代码学习成果 |
| **辅助工具** | 加载子技能 `yida-flash-note-to-prd` | 会议纪要/闪记转 PRD |
| | 加载子技能 `yida-export-conversation` | 导出当前对话为 Markdown |
| | 加载子技能 `yida-voc` | 整理故障/需求反馈材料 |
| | 加载子技能 `sls-log-workbench` | SLS 平台问题日志查询 |
| | 加载子技能 `yida-db-seq-fix` | PostgreSQL 主键冲突 / Sequence 修复 |
| | 加载子技能 `large-file-write` | 可靠写入 100+ 行大文件 |
| | `openyida ai` `CLI` | 调用宜搭 AI 通用能力：文生文（文本生成）/ 识图（图片识别） |
| | `openyida batch` `CLI` | 批量顺序执行多条 OpenYida 命令（读 tasks 文件，支持 `--json --quiet`） |

---

## 核心规则

### 致命规则（FATAL，违反即失败/报错）

1. **技能加载唯一入口**：执行任何子技能前，支持 `use_skill` 的宿主必须调用 `use_skill("<技能名>", "<本阶段目的>")` 加载对应技能；不要用 `Read` / `read_file` / `cat` 读取 SKILL.md 路径，不凭记忆猜参数格式。
2. **corpId 一致性检查**：创建页面前对比 prd 与 `.cache/cookies.json` 的 corpId，不一致必须询问用户（重新登录 or 当前组织新建）。
3. **发布前本地校验**：自定义页面发布前跑 `openyida check-page` + `openyida compile`；JSON 配置写盘后先解析校验，再调用平台命令。
4. **命令输入文件禁止 shell 写入**：当 OpenYida 命令需要 JSON/YAML/CSV/config/script 文件参数时，先使用当前 agent 运行时提供的结构化文件写入工具（如 create_file / Write / file edit tool）创建文件，再把路径传给命令；禁止用 shell heredoc、`cat`/`echo`/`printf`/`tee` 加输出重定向，或把命令 stdout 重定向成业务文件。

### 重要规则（IMPORTANT，影响质量/性能/可维护性）

1. **按阶段加载必要技能**：按意图选 1 个主技能；完整应用按阶段加载当下唯一需要的子技能，禁止并发批量读取多个 `SKILL.md` 或预读未来阶段技能。
2. **优先复用缓存**：`appType`/`formUuid`/`fieldId` 优先从 `.cache/<项目名>-schema.json` 读，缺失再 `get-schema`。
3. **模板优先**：复杂产物先用 `openyida sample` 或现有示例生成骨架，再做最小改动。
4. **配置承载优先于代码**：字段/公式/联动/报表/审批/集成交给对应技能，自定义页面只做展示与胶水。
5. **数据性能优先**：统计聚合用 `yida-report` 服务端聚合，不在前端拉全量后自行聚合。
6. **避免无效重试**：失败先查登录态/组织/参数/字段 ID，无修改不连续重试超 1 次。
7. **配置分两处存**：业务语义 → `prd/<项目名>.md`；Schema ID → `.cache/<项目名>-schema.json`（prd 不记 ID）。
8. **临时文件入 project `.cache/`**：OpenYida 业务中间文件写入 `<projectRoot>/.cache/openyida/<项目名或任务名>/`；Schema ID 映射仍写 `<projectRoot>/.cache/<项目名>-schema.json`。从 workspace 根执行命令时使用 `project/.cache/...`，从 project 工作目录内执行时使用 `.cache/...`；不要写仓库根目录或系统临时目录。
9. **报表美化先问方案**：用户说"优化/美化报表"时先问选原生报表(`yida-report`)还是 ECharts(`yida-chart`)。
10. **按 schema 证据选技能**：先看 `formType`、组件树、`dataSource.online`；`receipt/process/report` 分别落到表单/流程/报表技能。
11. **官方示例范式优先**：蒸馏官方示例时先理解脱敏 schema 承载方式，不凭截图/标题/视觉判断。

> 📖 每条规则的完整说明、PRD 质量门槛、临时文件路径规范、报表美化话术 → [references/development-rules.md](references/development-rules.md)

---

## 常见问题

| 问题 | 处理 |
|------|------|
| 发布提示登录失效 | 先 `openyida login`，再 `openyida publish <源文件> <appType> <formUuid> --health-check` |
| 查已有表单的字段 ID | `openyida get-schema <appType> <formUuid>`，从 Schema 读各字段 `fieldId`（详见 `yida-get-schema`） |
| 更新已有表单字段 | 用 `create-form` 的 update 模式：`openyida create-form update <appType> <formUuid> '[{"action":"add","field":{"type":"TextField","label":"新字段"}}]'`（详见 `yida-create-form-page`） |
| 发布提示 corpId 不匹配 | 问用户：当前组织新建应用发布，或 `openyida logout` 后重新登录到正确组织 |

---

## 参考文件

| 文档 | 覆盖范围 | 何时阅读 |
|------|---------|---------|
| [环境准备与登录检测](references/setup-and-env.md) | 环境依赖、env 解读、多环境登录、悟空降级、Codex handoff、project 初始化 | 环境异常或登录问题时 |
| [核心规则详解](references/development-rules.md) | 成功率清单、PRD 门槛、临时文件、报表美化、corpId | 编写 PRD / 规范执行前 |
| [字段类型 / URL 规则](references/field-and-url-reference.md) | 表单字段类型速查、应用 URL 拼接规则 | 建表单 / 拼访问链接时 |
| [宜搭 API](references/yida-api.md) | 宜搭 API 完整参数 | 调用 API 前 |
| [公式函数库](references/formula-functions.md) | 公式函数速查 | 编写公式前 |
| [官方示例 Schema 范式](references/official-example-schema-patterns.md) | 脱敏 schema 承载范式 | 蒸馏官方示例时 |
| [查询条件构造](references/query-condition-guide.md) | 数据查询条件写法 | 数据查询/筛选时 |
| [报表字段配置](references/report-field-config-guide.md) | 报表字段配置规范 | 配置报表时 |
| [版本功能差异](references/edition-features-guide.md) | 各版本能力差异 | 版本能力查询时 |
| [模型 API](references/model-api.md) | AI 模型接口 | 调用宜搭 AI 模型时 |
