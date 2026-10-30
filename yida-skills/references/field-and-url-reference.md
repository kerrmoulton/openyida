# 字段类型与 URL 规则

> 建表单查字段类型、拼应用访问链接时查本文档。（常见问题排障见主 SKILL.md「常见问题」）

## 表单字段类型速查

| 分类 | 类型 | 说明 | 特殊属性 |
|------|------|------|---------|
| **文本** | `TextField` | 单行文本 | — |
| | `TextareaField` | 多行文本 | — |
| **数值** | `NumberField` | 数字 | `precision`（小数位）· `innerAfter`（单位） |
| | `RateField` | 评分 | `count`（星级数） |
| | `SerialNumberField` | 流水号 | `serialNumberRule` |
| **选择** | `RadioField` | 单选 | `options` |
| | `CheckboxField` | 多选 | `options` |
| | `SelectField` | 下拉单选 | `options` / `remoteDataSource` |
| | `MultiSelectField` | 下拉多选 | `options` / `remoteDataSource` |
| | `CountrySelectField` | 国家选择 | `multiple` |
| **日期** | `DateField` | 日期 | `format`（如 `"YYYY-MM-DD"`） |
| | `CascadeDateField` | 级联日期（范围） | `format` |
| **人员·组织·地址** | `EmployeeField` | 成员选择 | `multiple` |
| | `DepartmentSelectField` | 部门选择 | `multiple` |
| | `AddressField` | 地址 | — |
| **附件·媒体** | `AttachmentField` | 附件上传 | — |
| | `ImageField` | 图片上传 | — |
| **结构·关联** | `TableField` | 子表格 | `children`（子字段列表） |
| | `AssociationFormField` | 关联表单 | `associationForm` |

## 宜搭应用 URL 规则

以下是路径核对和页面内链接构造规则（`{base_url}` 来自当前环境）。完整应用交付使用 CLI 成功结果及 `app-entry` 回读的实际地址，不凭模板猜测入口；见[访问态入口契约](../skills/yida-app/references/entry-navigation.md)。

先分清导航控制口径：

| 要控制什么 | 配置/参数 | 适用对象 | 不要怎么做 |
| --- | --- | --- | --- |
| 应用导航隐藏 | `hideAppNav='y'` | 整套应用自绘导航 | 不要因为只有前台自绘菜单就隐藏后台导航 |
| 页面导航隐藏 | 写入 `isRenderNav=false`，回读 `renderNav=false` | 独立前台等已规划页面 | 不要据此自动隐藏应用导航 |
| 本次打开隐藏导航 | URL 参数 `isRenderNav=false` | 原生提交页、详情页 | 不要把 URL 参数当作持久化配置证据 |
| 平台导航排序 | `yida-nav-group` | 常规多页面应用 | 不要在自定义页重复做同级应用导航 |

| 页面类型 | URL 格式 |
|---------|---------|
| 应用首页 | `{base_url}/{appType}/workbench` |
| 表单提交页（直接填写） | `{base_url}/{appType}/submission/{formUuid}` |
| 表单提交页（默认隐藏导航） | `{base_url}/{appType}/submission/{formUuid}?isRenderNav=false` |
| 数据管理页（列表） | `{base_url}/{appType}/workbench/{formUuid}` |
| 数据管理页（iframe 嵌入） | `{base_url}/{appType}/workbench/{formUuid}?iframe=true` |
| 独立自定义页面 | CLI 的 `standaloneUrl`，即 `{base_url}/{appType}/custom/{formUuid}`；需回读确认页面 `renderNav=false` |
| 平台导航内的自定义页面 | CLI 的 `workbenchUrl`，即 `{base_url}/{appType}/workbench/{formUuid}` |
| 表单详情页（抽屉/隐藏导航） | `{base_url}/{appType}/formDetail/{formUuid}?formInstId={formInstId}&navConfig.layout=1180&isRenderNav=false` |
| 表单详情页（编辑态） | `{base_url}/{appType}/formDetail/{formUuid}?formInstId={formInstId}&mode=edit&navConfig.layout=1180&isRenderNav=false` |

同一张表单（相同 `appType/formUuid`）有两类访问入口：`workbench/{formUuid}` 进入包含管理视图的表单工作台，`submission/{formUuid}` 直接进入填写提交页。应根据入口任务选择路由，不能因为目标资源是表单就统一使用 workbench。

例如，管理入口可用 `/{appType}/workbench/{formUuid}?hideLeftNav=true&corpid={corpId}`，提交入口可用 `/{appType}/submission/{formUuid}?corpid={corpId}`。`hideLeftNav=true` 是 workbench 链接的导航显示参数，不会把管理入口变成提交入口；不要把它与应用基础设置 `hideAppNav` 混为一谈。已有链接中的 `corpid`、`hideLeftNav` 和业务参数按用途保留，用 `URLSearchParams` 合并。

> 任意地址可追加 `corpid={corpId}` 自动切到对应组织；无 query 时用 `?corpid=...`，已有 query 时用 `&corpid=...`。

> 自定义页里的新增/提交入口默认使用 `?isRenderNav=false`；已有 query 时合并参数。这只控制本次打开，不证明持久配置已改变。前后台共用表单不为嵌入效果永久隐藏导航；只有计划明确包含页面级持久配置时才执行 `update-form-config` 并回读。URL 参数、写入字段和回读字段的区别见[字段口径](../skills/yida-app/references/entry-navigation.md#区分-url-参数写入字段与回读字段)。

## 页面内自定义导航 URL 参数规则

默认不要在自定义页面中自己绘制应用级侧边导航、顶部导航或同级模块菜单；同应用页面切换优先交给宜搭平台导航和 `yida-nav-group`。

已规划自己的顶部、侧边或导航壳时，先区分范围：仅独立前台自绘菜单，只隐藏该页导航并保留后台平台菜单；只有整套应用自绘应用级导航，才执行：

```bash
openyida update-app <appType> --hide-app-nav
```

用户只要求页面隐藏导航、无导航、全屏无框或 `isRenderNav=false` 时，走页面级隐藏逻辑，不自动隐藏应用导航。

当自定义页自己绘制导航壳、并隐藏宜搭原导航时，导航项不能只保存 `formUuid`，必须保存可合并的 URL 参数：

- 自定义展示页目标：独立页使用回读确认的 `standaloneUrl`；平台导航内容页使用 `workbenchUrl`。不要只凭 display 类型统一使用 `/custom`，也不要为独立前台全局隐藏应用导航。
- 表单管理目标（查询、审核、维护）：使用 `{base_url}/{appType}/workbench/{formUuid}`；在导航壳内容区嵌入时追加 `iframe=true`。整页访问可沿用 `hideLeftNav=true` 等已有显示参数。
- 表单提交目标（填写、报名、申请）：使用 `{base_url}/{appType}/submission/{formUuid}`；在导航壳或抽屉内嵌入时追加 `isRenderNav=false`。管理与提交入口可以绑定同一张表单，使用不同业务名称和入口用途。
- 跨组织访问：在已有 query 后追加 `&corpid={corpId}`；没有 query 时用 `?corpid={corpId}`。
- 业务深链：导航项可带 `tab`、`view`、`dateRange`、`mode` 等白名单参数；拼 URL 时与公共参数合并，不能被 `router.push(formUuid)` 吞掉。

推荐用统一 URL 构造函数处理 `?` / `&`，不要手写多个分支散落在 JSX 里。

## 当前标签跳转与路由模式

链接的 workbench/submission 路径决定入口用途，`hideLeftNav/isRenderNav` 决定导航显示，均不决定是否新开标签。保持自定义导航时更新主内容 iframe；跨真实页面时通过数据桥调用 `router.push(href, params, false, true)`，完整地址必须使用 URL 模式以避免重复拼接应用前缀。数据桥已支持省略第四参时自动识别完整地址，显式 `false` 不会被覆盖。详细说明见 [路由模式与数据桥兜底](../skills/yida-nav-shell/references/nav-shell-patterns.md#路由模式与数据桥兜底)。
