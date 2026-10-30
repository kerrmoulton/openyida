# token、选择器与局部改写

先在真实页面检查 DOM、Computed Style 和变量来源，再选修改位置。下列线索来自宜搭数据管理组件与实验室验证，不是跨版本保证；表格可能使用虚拟 Grid 或旧版 `.next-table`，只处理实际命中的实现。未命中时回到 DOM 找消费点，不追加猜测选择器。

## 1. 作用域先于样式

- 有平台导航：可用 `body:has(.next-selected[data-formuuid="FORM-实际ID"]) .vc-yida-form-manage` 定位 manager，再限定 `.new-data-manage` 或其直属 `.next-tabs.views-tab`。页面切换时规则随选中项退出；需实际验证刷新、切页及多个挂载视图。
- 隐藏导航/iframe：在该文档内用 `.vc-yida-form-manage:has(#newDataManageTable [data-field-id="实际字段ID"])` 定位，也可用已验证的表头 `data-column-key`。字段来自 schema 和 DOM；列被隐藏后定位仍要成立，优先用多个可见业务字段作证据。iframe 隔离，不改父文档。
- 只强调一列：在 manager/table 范围内再用 `[data-column-key="实际字段ID"]` 和 `.DataCellWrapper[data-field-id="实际字段ID"][role="gridcell"]`，不能按第几列、记录标题或哈希 class 定位。
- 原生选择器不是 Canvas 根节点；自定义页使用自有根 class 与主题 Provider，不全局注入样式。应用壳变化按用户授权另设页级生效范围，不因改列表颜色而写全应用变量。

## 2. 平台 token 与消费位置

在目标作用域定义 token。以下列的是已经存在的消费线索，值应来自当前应用主题和此次视觉目标，不是固定色板。

| 目标 | token 线索 | 消费与注意事项 |
| --- | --- | --- |
| 画布/面板 | `--pod-page-bg-color`、`--pod-card-bg-color` | 不一定覆盖管理内容的直接 background；检查 computed style 再局部补充 |
| 表头底色 | `--table-header-bg`，旧表格回退 `--table-th-bg` | HeaderCell、HeaderRight、选择列表头和固定占位；组件显式传入的底色可能优先于变量 |
| 单元格底色 | `--table-cell-bg`、`--pod-table-cell-color`，旧表格回退 `--table-row-bg` | Grid Cell/SingleRow 与数据管理组件默认底色；要检查固定行和交互态是否被独立绘制 |
| 外框/内线 | `--table-border`、`--table-cell-border`、旧版 `--table-normal-border-color` | 控制颜色，不等于控制横竖线的方向或粗细；方向用局部 border CSS |
| 表格圆角 | `--pod-table-border-radius` | GridView/布局容器；检查内部裁切，不通过 overflow 隐藏操作或滚动条 |
| 文字 | `--color-text1-4`、`--color-text1-3`、`--color-text1-10` | 内部标签可能直接消费变量；深色表头要在表头子树局部成对调整，不能把正文全改白 |
| 品牌交互 | `--color-brand1-1/2/3/5/6/9/10` | 常见品牌阶梯线索；按实际按钮、链接、勾选和分页消费点成套处理 normal/hover/active/disabled，不把全套变量机械赋同色 |
| 边线/填充 | `--color-line1-1/2`、`--color-fill1-1/2/3` | 页签、分隔、弱底色和状态；不能只改一个 token 就声称所有状态已同步 |
| 输入筛选 | `--input-bg-color`、`--input-border-color`、`--input-hover-border-color`、`--input-focus-border-color` | 查看当前搜索/筛选组件是否消费；焦点可见性保留 |

`--pod-*` / 既有组件变量是平台消费契约；`--lab-native-*` 只是旧配方声明且由该配方 CSS 消费的内部变量，普通应用未加载消费者时不会生效。手写方案可以定义少量本地语义变量，但须同时写消费规则，不能把新变量宣传为平台 token。

## 3. token 不足时改哪些 CSS

以下选择器均须加上第 1 节的真实页面作用域。

| 区域 | 已观察到的定位线索 | 可调整的装饰属性 |
| --- | --- | --- |
| 页签 | manager 直属 `.next-tabs.views-tab`，`[role="tablist"]`、`[role="tab"]`、`[aria-selected="true"]` | 背景、下划线、字重、内层间距、圆角；不要给全宽导航壳反复套空框 |
| 内容容器 | `.new-data-manage .data-manage-content` | 背景、边框、阴影、圆角、外部留白 |
| 工具区 | `.data-manage-operaion`（平台现有拼写）、`.operation-left`、`.operation-right` | 分组间距、分隔、底色；保留响应式布局和原事件 |
| 按钮 | 工具区内 `.next-btn-primary`、`.next-btn-normal`、`.next-btn-simple`、`.operation-action` | 对比、字重、圆角、工具按钮内边距；排除 disabled/aria-disabled，危险按钮单独处理 |
| 表头 | `#newDataManageTable [data-role="header-cell"][data-column-key]` | 背景、文本 token、字重、分隔线；不能改宽度/定位来掩盖错位 |
| 表头空白及固定占位 | `.leftHeaderPane` 与其同级表头区域，`.right-fixed-pane` 外壳 | 现场核对兄弟节点，补齐表头背景/底线；固定外壳跨越表头时保持透明，由表头和正文各自绘制，不能一层正文色盖住表头 |
| 行与字段 | `[role="row"][aria-rowindex]`、`.DataCellWrapper[data-field-id][role="gridcell"]` | 底色、文字、边线；隔行使用真实行索引，虚拟 DOM 的 nth-child 不等于数据奇偶 |
| 原生 SelectField 标签 | 字段单元格内 `[data-componentname="SelectField"]` 的实际预览节点 | 只给内层标签设底色/圆角/小间距，不撑高虚拟单元格 |
| 分页与行操作 | `.next-pagination`、`.notable-yida-action-column-btns` | 选中/禁用/链接层级，不能统一覆盖删除危险色 |

### 局部强调的写法示意

这是手写方案的最小片段，不是可直接上传的完整主题；真实使用时替换 ID，并确认内层文字消费点。颜色来自当前应用主题，可按目标重新设计。

```css
/* 仅当前页：本地语义变量由下方两条规则实际消费 */
body:has(.next-selected[data-formuuid="FORM-实际ID"]) .new-data-manage {
  --dm-focus-bg: var(--color-brand1-1, #eef2f5);
  --dm-focus-ink: var(--color-text1-4, #28323d);
}
body:has(.next-selected[data-formuuid="FORM-实际ID"]) .new-data-manage
  [data-role="header-cell"][data-column-key="textField_实际ID"],
body:has(.next-selected[data-formuuid="FORM-实际ID"]) .new-data-manage
  .DataCellWrapper[data-field-id="textField_实际ID"][role="gridcell"] {
  background: var(--dm-focus-bg);
  color: var(--dm-focus-ink);
  font-weight: 600;
}
```

若已有直接 background 或内层 token 覆盖此片段，先找到来源，只在最小目标上提高优先级；不要全局堆 `!important`。此例不包含交互态补丁，按下一节补齐并验证，不能当完成方案直接发布。

## 4. 状态矩阵与布局边界

- 正常、`:hover`、行 `[aria-selected="true"]`、单元格 `[data-in-selected-area="true"]` 的实际绘制层分别检查；列强调不能盖住选中态。焦点可见，禁用不伪装成可点击。
- 只保留横线时，去掉目标单元格左右边线；检查伪元素、选择列表头内层重复底线和固定列分隔。不要把删除全部边框当作万能修复。
- 深表头浅正文是独立层级：表头文字、图标和复选框使用表头的颜色，正文使用正文颜色；横滚到最右仍连续。
- 禁止装饰 CSS 改虚拟行的 height/min-height/padding、top、transform、position、滚动容器计算高度或固定列宽。要改变密度，先确认组件支持的配置入口并验证行/操作同步。
- 状态条件着色需要真实业务规则及渲染能力；CSS 没有通用按文本内容匹配的能力，不按记录 ID 或截图行号给值染色。
- 浮层/抽屉可能挂在页面作用域外，不扩大到所有全局弹层；核实挂载边界与可用主题配置，保留原打开方式。

完成后对比本轮 scoped diff、邻页、显示列、排序、横滚、窄容器和原有操作。CLI guide 是实施线索，不是已扫描当前页或已验证效果的证明。
