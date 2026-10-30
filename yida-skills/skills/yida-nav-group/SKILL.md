---
name: yida-nav-group
description: 宜搭应用左侧导航管理。查询导航树，新建、重命名或删除分组，重命名页面，移动或排序表单、页面和外链，隐藏或显示导航项，以及设置图标。
---

# 应用导航分组

## 严格要求

- 操作前必须已知 `appType`；不要编造。
- 移动页面前先执行 `openyida nav-group list <appType>` 确认 `navUuid` / `formUuid` 和目标分组。
- 完整应用首次生成后，基于 PRD 的导航顺序决定根导航顺序，页面实现交付顺序和资源创建顺序不直接等同于导航顺序。
- **完整应用排序时机**：等待本轮全部页面开发、发布及资源创建完成，再统一执行一次排序；逐页发布不使用 `--auto-nav-order`。用户单独要求调整已有导航时直接按本次要求执行。
- **PRD 导航优先**：PRD 写明页面/表单清单顺序时，使用 `openyida nav-group order <appType> <页面/表单...>`；PRD 只写宽泛分组或缺少导航顺序时，使用 `openyida nav-group auto-order <appType>` 或发布命令的 `--auto-nav-order` 兜底。两种排序互斥，同一 Run 只执行一次，不生成逐项 `move` 循环。
- **兜底自动排序优先级**：门户/首页/工作台入口 > 自定义展示页面 > 流程表单 > 普通表单。这是工具兜底顺序，不替代 PRD 导航顺序。
- **默认原则：面向决策者的总览/驾驶舱看板作为应用门面靠前，数据录入/明细表单在其后。** 仅适用于已确认的管理概览需求，不自动创建首页，也不将独立访客首页混入管理端。判断某个看板是否靠前，看它是不是主要「查看/决策」入口：
  - 有独立总览首页看板时：`总览首页看板 → 专题看板 → 核心业务表单 → 明细/配置表单`。
  - 没有独立首页、专题看板本身就是主要决策视图时（如「双11看板/618看板」面向运营主管只读查看）：这些**专题看板靠前**，数据录入/明细表单在后。
- "不要无脑把看板全置顶"针对的是：当存在明确操作旅程（先录入后查看）、且看板只是次要报表时，按旅程排；不要把与主流程无关的次要看板也塞最前。多数带看板的应用，决策看板应先于录入表单。
- 删除分组默认只删除空分组；非空分组必须先移动子项，除非用户明确要求 `--force`。
- 分组节点是 `navType: "NAV"`，普通页面是 `navType: "PAGE"`，外链是 `navType: "LINK"`，系统节点不要移动或删除。

前后台双入口的排序以 [访问态入口契约](../yida-app/references/entry-navigation.md) 的管理菜单为准；auto-order 不理解业务身份，不能用于双入口的管理菜单决策。隐藏项同时影响共享平台菜单，不是按角色隐藏，也不是权限拒绝。

## 命令

### 查询导航树

```bash
openyida nav-group list <appType>
openyida nav-group list <appType> --flat
```

输出为 JSON。树形结果中 `type=group` 的节点即分组；`navUuid` 是后续重命名、删除、移动的稳定标识。

### 创建分组

```bash
openyida nav-group create <appType> "分组名" [--icon auto|<iconName>]
openyida nav-group create <appType> "子分组名" --parent <groupNavUuid>
```

分组只能创建在根目录或一级分组下。默认根据分组标题选择业务图标，复用页面/表单导航的图标库和语义匹配，例如客户、财务、项目、看板分组分别匹配对应业务图标；不要为所有分组统一指定文件夹，也不为追求差异随机换图标。同一语义允许复用同一图标。

通常省略 `--icon` 或传 `auto`；明确需要某个图标时可传合法的平台图标名。平台导航图标与页面内容的 Lucide/Ant Design 组件是两套协议，不能传组件名、emoji 或应用图标的 `xian-*%%color`。

创建后 CLI 唯一定位本次新增节点，保留导航节点字段更新图标，并回读验证；结果中的 `group.icon`、`iconSource`、`readbackVerified` 用于核对。若返回 `NAV_GROUP_CREATE_INCOMPLETE`，先执行 `nextStep` 查询，不重试 create；分组可能已创建，仅图标尚未完成。更新 OpenYida 不会自动修改已有分组，重命名保留原图标。

### 重命名分组或页面

```bash
openyida nav-group rename <appType> <navUuid|formUuid|name> "新名称"
openyida nav-group rename <appType> <formUuid> "新页面名称" --en "English name"
```

同名节点可能歧义，分组优先使用 `navUuid`，页面优先使用 `formUuid`。页面改名会更新页面本身的标题，因此左侧导航和页面管理中的名称会同步变化；页面内容中自行编写的标题不会随之修改。未提供 `--en` 时保留页面已有英文名称；没有英文名称时使用新名称。

### 移动页面或分组

```bash
openyida nav-group move <appType> <formUuid|navUuid|name> --to <groupNavUuid|groupName|root>
openyida nav-group move <appType> <formUuid> --to <groupNavUuid> --before <siblingNavUuid>
openyida nav-group move <appType> <formUuid> --to root --after <siblingNavUuid>
```

目标分组必须通过 `--to` 传入，不能作为第三个位置参数。

常见场景：把新建表单放入已有分组：

```bash
openyida nav-group list APP_XXX --flat
openyida nav-group move APP_XXX FORM_XXX --to NAV_XXX
```

### 按业务顺序整理根导航

```bash
openyida nav-group order <appType> <formUuid|navUuid|name> [more items...]
openyida nav-group auto-order <appType>
```

`order` 会把列出的导航项按给定顺序移动到根导航靠前位置，未列出的系统导航、表单、页面、分组保持相对顺序并跟在后面。适合消费 `yida-design` 的 `prd.md` 导航顺序，一次性整理用户入口。

`auto-order` 会读取当前根导航并按默认优先级排序：门户/首页/工作台入口 > 自定义展示页面 > 流程表单 > 普通表单；系统导航保持在系统区域，未识别分组和其他项排在后面。适合 PRD 没有明确页面清单时做轻量兜底。

`order` 和 `auto-order` 写前会比较完整导航结构；顺序已正确时返回 `changed=false` 且不写入。写入后只有完整回读一致才成功，并返回 `readbackVerified=true`。结果不确定时不要重试，只执行返回的 `nextStep` 查询当前导航。

示例 A：电商销售系统只有「销售数据表单 + 双11看板 + 618看板」，看板是运营主管的主要决策视图，把看板作为门面靠前、录入表单在后：

```bash
openyida nav-group order APP_XXX 双11看板 618看板 销售数据
```

示例 B：应用另有独立「首页总览看板」，且双11/618 只是次要专题、主流程是先在订单/商品表录入再看板，则按旅程排、不要把每个专题看板都塞最前：

```bash
openyida nav-group order APP_XXX 首页总览看板 订单表 商品表 客户表 双11看板 618看板
```

### 删除分组

```bash
openyida nav-group delete <appType> <groupNavUuid>
```

非空分组会报错，先把子页面移动到其他分组或 `root`。

### 隐藏 / 显示导航项

```bash
openyida nav-group hide <appType> <navUuid|formUuid|name>
openyida nav-group show <appType> <navUuid|formUuid|name>
```

隐藏会同时设置 PC 与移动端导航隐藏。

### 设置菜单图标

```bash
openyida nav-group set-icon <appType> <formUuid|navUuid|name> <iconName>
openyida nav-group set-icon <appType> <formUuid|navUuid|name> default
```

`iconName` 必须是宜搭菜单图标库中的标识，不是 CSS 类名，也不是其他前端图标库的名称。命令写入后会回读并核验 `icon` 字段；`default` 清空自定义图标，恢复平台默认图标。先用 `openyida nav-group list <appType> --flat --raw` 核对目标节点和现有图标值。

## 接口事实

- 查询：`/dingtalk/web/{appType}/query/formnav/getFormNavigationListByOrder.json`
- 创建：`/dingtalk/web/{appType}/query/formnav/saveFormNavigation.json`
- 重命名分组：`/dingtalk/web/{appType}/query/formnav/updateNavigationTitle.json`
- 保存页面标题多语言词条：`/{appType}/query/appI18n/createOrUpdateI18nItem.json`
- 重命名页面：`/dingtalk/web/{appType}/query/formdesign/updateFormTitle.json`
- 移动排序：`/dingtalk/web/{appType}/query/formnav/updateFormNavigationOrderNew.json`
- 删除：`/dingtalk/web/{appType}/query/formnav/deleteFormNavigation.json`

`ROOT` 分组的后端标识是 `NAV-SYSTEM-PARENT-UUID`，命令中可用 `root` 代替。
