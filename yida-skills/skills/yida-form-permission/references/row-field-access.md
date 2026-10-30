# 成员、数据范围与字段权限

## 选择配置维度

| 用户要配置什么 | 使用什么 |
| --- | --- |
| 哪些人适用本权限组 | `--members`、`--roles`、`--all-members`，或引用已有矩阵 |
| 能访问哪些记录 | `--data-permission`：全部、本人创建、部门范围或完整自定义条件 |
| 能执行哪些操作 | `--action-permission`：查看、编辑、删除等操作 |
| 能查看或编辑哪些字段 | `--field-permission` 完整配置，或 `--field-access` 逐字段配置 |

四个维度分别确定，不能由角色名称推断数据范围或字段权限。不同权限组可能叠加，先查询所有相关组，检查是否有其他组扩大访问范围。

## 数据范围

`--data-permission` 支持主技能列出的范围类型，以及完整 `rule`、`customDepartmentData`、`formulaData`。修改自定义条件时，从平台已有配置取得条件结构，按用户要求调整真实字段、比较值和条件组合。常用字段条件使用 `--conditions-file`，完整平台结构使用 `--data-permission`。下面分别说明。

仅当需求是“某个主表成员字段包含当前登录人”时，使用快捷参数 `--owner-field <fieldId>`。字段必须是实际存在的主表成员字段；它会替换本组数据范围，只支持 VIEW，不能与 `--data-permission` 同传。平台在访问时确定当前登录人。

不要把这个快捷条件用于其他数据范围，也不要用创建人、固定人员 ID 或固定业务字段代替用户要求的筛选条件。

## 按字段组合数据范围

例如：能查看“负责人是我”的数据，或“属于我的部门且金额不小于 0”的数据。用 `--conditions-file` 表达组合条件：

```bash
openyida save-permission APP_XXX FORM_XXX --create --name 部门业务数据 --all-members --conditions-file .cache/openyida/task/conditions.json --dry-run
```

```json
{
  "logic": "OR",
  "rules": [
    {
      "field": "<真实成员字段ID>",
      "op": "contain",
      "variable": "currentUser"
    },
    {
      "logic": "AND",
      "rules": [
        {
          "field": "<真实部门字段ID>",
          "op": "belong",
          "variable": "currentDepartments"
        },
        {
          "field": "<真实数字字段ID>",
          "op": "gte",
          "value": 0
        }
      ]
    }
  ]
}
```

### 一条条件怎么写

| 项目 | 说明 |
| --- | --- |
| `field` | 从表单读取的真实字段 ID |
| `op` | 比较方式，见下表 |
| `value` | 固定值，例如金额 `0` 或状态文本 |
| `variable: currentUser` | 当前访问者，仅用于成员字段 |
| `variable: currentDepartments` | 当前访问者所在部门，仅用于部门字段 |
| `logic: AND` | 同一组条件全部满足 |
| `logic: OR` | 同一组条件满足任意一条 |

固定值和当前用户、部门变量二选一。变量在访问时由平台确定，不写成管理员的固定 ID。每组 `rules` 至少有一条，可以嵌套组合。

### 按字段选择比较方式

| 字段 | 可用的 `op` |
| --- | --- |
| 数字、日期 | `eq/ne/gt/gte/lt/lte`：等于、不等于、大于、大于等于、小于、小于等于 |
| 文本 | `eq/ne/like/contain` |
| 单选 | `eq/ne/in` |
| 多选、成员 | `contain/inany` |
| 部门 | 多选方式及 `belong`，后者包含下级部门 |

数字使用有限数字，日期使用毫秒时间戳；成员和部门的固定值使用真实 ID 字符串数组；普通文本和选项使用字符串，多选也可用字符串数组。

### 保存与验证

先用 `--dry-run` 查看差异，核对后保存。更新已有组时指定 `--package-uuid`；原成员和排除规则需完整可读。`--conditions-file` 适用于 VIEW，与 `--owner-field/--data-permission` 互斥。

上方 JSON 写入 `conditions.json` 后，若只修改已有权限组的数据范围，直接指定查询得到的组 UUID：

```bash
openyida save-permission APP_XXX FORM_XXX --package-uuid PACKAGE_XXX --conditions-file .cache/openyida/task/conditions.json --dry-run
```

预览核对目标组、原成员保留和新数据范围后，去掉 `--dry-run` 保存；此场景无需再传 `--all-members`。使用普通账号核对上方示例的结果：

| 记录情况 | 能否查看 |
| --- | --- |
| 负责人是当前用户，金额为 -1 | 能；外层 OR 的第一组已满足 |
| 负责人不是当前用户，属于当前用户部门，金额为 0 | 能；第二组的两个条件都满足 |
| 负责人不是当前用户，属于当前用户部门，金额为 -1 | 本组不授予访问；再核对其他权限组是否额外授权 |

条件最多 100 个规则或组、10 层，当前使用主表字段；CLI 会在写入前检查字段、操作符、空组和未知参数。普通条件不依赖 OA 矩阵。其他权限组仍可能叠加授权，保存后用普通用户分别测试允许和拒绝访问；管理员查数成功不能证明数据隔离正确。

## 成员与角色

`--members <userId,...>` 替换 PERSONS 条目，`--roles <roleId,...>` 替换 ROLE 条目；其他成员类型与排除条目保留。使用目标组织已有的真实 ID，CLI 不创建角色或调整角色内部成员。

`--roles` 不与 `--members/--all-members/--matrix` 混用。替换成员时检查完整 before/after；CLI 要求确认移除项时，经用户确认后加 `--confirm-member-replace`。部门和参数成员当前只能保留，不能新增。

## 字段权限

`--field-access <fieldId:view|edit|hidden|encrypt>` 可重复，分别表示只读、可编辑、隐藏、加密。

- 首次转为自定义字段权限时，必须用 `--field-default` 指定其余字段权限。它不等于保留表单原有的动态显隐规则，应逐项核对预览。
- 已有 CUSTOM 字段权限时，只传要修改的字段；不传 `--field-default`，其他字段保留。
- 字段可编辑还要求操作权限允许 `OPERATE_EDIT`。
- 子表列可编辑时，所属子表也须显式设置为 `edit`。

更新已有权限组并预览单个字段变化：

```bash
openyida save-permission <appType> <formUuid> --package-uuid <packageUuid> \
  --field-access <真实字段ID>:hidden --dry-run
```

所有 ID 从实际查询结果取得。`--dry-run` 只展示 before/after，返回 `remoteWrites: 0`；使用 `--owner-field` 时，`otherPackagesToReview` 另列其他待复核权限组。核对并确认后去掉 `--dry-run` 保存。

## 引用已有矩阵

普通成员或角色权限组不要求 OA 矩阵。引用矩阵前查询可用性：

```bash
openyida get-permission <appType> <formUuid> --check-matrix --json
```

`matrixAvailability.management` 表示组织矩阵管理入口，`usage` 表示当前应用能否使用矩阵：

| 结果 | 处理 |
| --- | --- |
| `available` | 可以继续；`purchaseVerified: false`，不据此宣称已购买 |
| `unavailable` | 告知当前不可用，请管理员核对或开通 OA 增强权益包；提供[官方说明](https://docs.aliwork.com/docs/yida_support/_15/ifpp7g/rxz494bh83kecq29) |
| `unknown` | 展示查询错误，停止矩阵配置；不要断言缺少权益 |

`save-permission --matrix` 只引用真实已有矩阵，保存前检查当前应用的使用能力；不可用或未知时停止写入。维护矩阵本体时读取 [权限组和矩阵管理](management.md#组织矩阵管理)，先核对组织权限和引用关系。不得修改用户版本、权益或额度，也不得伪造可用性结果。
