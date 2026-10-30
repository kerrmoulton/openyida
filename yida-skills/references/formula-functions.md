# 公式函数速查：名称、参数与示例

先看要得到什么结果，再选函数。参数以当前组织查询结果为准：

```bash
openyida formula functions APP_XXX --name ROUND --context form --json
```

`required` 是必填参数类型，`optional` 是可选参数类型，`variadic` 表示可继续添加参数，`result` 是结果类型。函数清单会随平台更新，本页提供常用例子。

公式函数名按可用列表逐字填写，大小写保持不变；`ROUND` 与 `Round`、`UserBuilder` 与 `USERBUILDER` 是不同名称。只组合目标配置提供的函数，不自行改造函数名或添加自定义公式函数。CLI 对大小写不符和列表外的调用报错；更新元数据后按新列表检查。这条规则针对公式语法中的函数调用，页面 JavaScript 自定义函数另按代码规则处理。

本页公式里的字段 ID 是示例。使用前从目标表单 Schema 的组件 `props.fieldId` 取得真实值并逐项替换；新字段创建后再取 ID。`UUID()` 生成业务编号，不能用来生成表单 `formUuid` 或组件字段 ID。

## 完整分类索引

以下列出 CLI 内置参考清单中的 108 个名称，便于按用途查找；它是参考索引，不表示当前组织或每个编辑器都开放全部函数。先找函数，再用上面的命令查询参数和当前配置的可用范围。大小写按表保留。

| 类别 | 函数名 |
| --- | --- |
| 数值 | `ABS`、`ADD`、`AVERAGE`、`CEILING`、`FIXED`、`FLOOR`、`INT`、`LARGE`、`LOG`、`MAX`、`MIN`、`MOD`、`POWER`、`PRODUCT`、`ROUND`、`SMALL`、`SQRT`、`SUM`、`SUMPRODUCT` |
| 文本 | `CONCATENATE`、`LEFT`、`LEN`、`LOWER`、`MID`、`PINYINHEADCHAR`、`REPLACE`、`REPT`、`RIGHT`、`RMBFORMAT`、`SEARCH`、`SPLIT`、`TEXT`、`TRIM`、`UPPER`、`UUID`、`VALUE` |
| 判断与校验 | `AND`、`ARRAYREPEATED`、`EQ`、`EXACT`、`FALSE`、`GE`、`GT`、`HASEMPTYTEXT`、`IF`、`ISEMPTY`、`ISNULL`、`LE`、`LT`、`NE`、`NOT`、`NUMBERCOMPARE`、`OR`、`TIMECOMPARE`、`TRUE`、`XOR` |
| 日期与时间 | `CASCADEDATEINTERVAL`、`CASCADEDATEINTERVALV2`、`DATE`、`DATEDELTA`、`DAY`、`DAYBEGIN`、`DAYEND`、`DAYS`、`DAYS360`、`HOUR`、`ISOWEEKNUM`、`MINUTE`、`MONTH`、`NETWORKDAYS`、`NOW`、`SECOND`、`SYSTIME`、`TIME`、`TIMESTAMP`、`TODAY`、`WEEKNUM`、`WORKDAY`、`YEAR`、`YEARBEGIN`、`YEAREND` |
| 人员与部门 | `DEPTNAME`、`DIRECTOR`、`DeptBuilder`、`DirectorBuilder`、`EMPLOYEE`、`GETUSERNAME`、`LOGINUSER`、`LOGINUSERWORKNO`、`USER`、`USERFIELD`、`UserBuilder` |
| 集合与取值 | `ARRAYGET`、`DIFFERENCESET`、`GetArrayItem`、`GetObjectField`、`INTERSECTIONSET`、`SUBSET`、`UNIONSET` |
| 表单查询 | `COUNT`、`EXIST`、`QUERYEQ`；需要目标表单、字段及查询上下文 |
| 数据动作与专用能力 | `DELETE`、`ESIGNUSER`、`INSERT`、`SETSERIALNO`、`UPDATE`、`UPSERT`；结合业务动作、签章或流水号配置使用 |

查询和写入函数要保留其业务入口的完整配置；字段试算不执行数据写入。`EXIST` 等依赖原生预处理的函数，需要从原生校验入口验证。

## 常用参数写法

下表里的“文本、数字、日期”等是参数说明，实际填写字段引用或常量。方括号表示可选参数，省略号表示可继续添加参数；这些说明符号不写入公式。字段 Schema 的三个属性、字段令牌与 JSON 引号规则见统一 `yida-formula` 入口。

| 函数写法 | 作用与结果 |
| --- | --- |
| `ROUND(数字, 小数位数)` | 舍入为数字；`ROUND(12.345, 2)` 得到 12.35 |
| `SUM(数字, ...)`、`AVERAGE(数字, ...)` | 求和、平均；子表整列输入由字段绑定提供 |
| `MAX(数字1, 数字2, ...)`、`MIN(数字1, 数字2, ...)` | 最大值、最小值 |
| `INT(数字)`、`ABS(数字)`、`SQRT(数字)` | 向下取整、绝对值、平方根 |
| `MOD(数字, 除数)`、`POWER(底数, 指数)` | 取余、乘幂；除数要非零 |
| `PRODUCT(数字1, 数字2 [, 数字3 ...])`、`SUMPRODUCT(数组1, 数组2)` | 连乘、两列对应相乘再求和；参数上限按查询签名填写 |
| `IF(条件, 满足时的值, 不满足时的值)` | 返回所选分支；两个分支按目标类型填写 |
| `AND(条件1, 条件2, ...)`、`OR(条件1, 条件2, ...)`、`NOT(条件)` | 同时满足、任一满足、取反，结果是真或假 |
| `EQ(a, b)`、`NE(a, b)`、`GT(a, b)`、`GE(a, b)`、`LT(a, b)`、`LE(a, b)` | 相等、不等、大于、大于等于、小于、小于等于；两边使用兼容类型 |
| `ISEMPTY(值)`、`ISNULL(值)` | 判断空值；字符串、数组及未填字段按实际绑定验证，零值单独考虑 |
| `CONCATENATE(文本, ...)`、`LEN(文本)` | 拼接文本、文本长度 |
| `LEFT(文本 [, 个数])`、`RIGHT(文本 [, 个数])`、`MID(文本, 起点, 个数)` | 截取文本；例如 `MID("ABCDE", 2, 2)` 得到 `"BC"` |
| `TRIM(文本)`、`UPPER(文本)`、`LOWER(文本)` | 清理首尾空格、转大写、转小写 |
| `REPLACE(文本, 起点, 个数, 新文本)`、`SPLIT(文本, 分隔符)` | 替换字符、拆分为数组 |
| `TEXT(值 [, 格式])`、`VALUE(数字文本)`、`RMBFORMAT(数字 [, 精度])` | 格式化文本、转数字、人民币文本；结果类型分别保留 |
| `UUID()` | 生成字符串编号 |
| `TODAY()`、`NOW()`、`TIMESTAMP(日期对象)`、`DATE(时间戳)` | 今天、现在、日期转时间戳、时间戳转日期；不要照搬其他工具的同名函数参数 |
| `YEAR(日期)`、`MONTH(日期)`、`DAY(日期)` | 提取年、月、日 |
| `DAYS(结束日期, 开始日期)`、`DATEDELTA(日期, 增加天数)` | 相隔天数、日期增减；日期对象与组件时间戳按需要转换 |
| `NETWORKDAYS(开始时间戳, 结束时间戳 [, 假期设置])` | 工作日数量；假期设置格式按目标配置查询 |
| `CASCADEDATEINTERVAL(日期区间数组)`、`TIMECOMPARE(时间戳a, 时间戳b)` | 区间相隔天数、判断 a 是否晚于 b |
| `USER([主管层级])`、`GETUSERNAME()`、`LOGINUSERWORKNO()` | 成员数组、当前人昵称、当前人员工 UserID；`USER()` 用于当前人，主管用法先查层级说明 |
| `DEPTNAME(人员ID或数组)`、`DIRECTOR(主管层级)` | 部门名称、当前人对应层级主管名称；成员对象与名称文本分别使用 |
| `UserBuilder(人员ID或数组)`、`DirectorBuilder(人员或部门ID, 层级 [, 类型])`、`DeptBuilder([人员ID或数组 [, 类型]])` | 构造人员或部门对象数组；类型枚举按配置查询 |
| `ARRAYGET(数组, 序号)`、`ARRAYREPEATED(值或数组)`、`EXACT(文本1, 文本2)` | 取指定项、判断重复、区分大小写比较文本；`ARRAYGET` 常用序号从 1 开始 |
| `UNIONSET(数组1, 数组2 [, 数组3])`、`INTERSECTIONSET(数组1, 数组2)`、`DIFFERENCESET(数组1, 数组2)`、`SUBSET(数组1, 数组2)` | 并集、交集、差集、第二个集合是否为第一个的子集 |

## 数值和判断

| 目的 | 公式示例 |
| --- | --- |
| 金额保留两位小数 | `ROUND(#{numberField_total}, 2)` |
| 多个数字相加 | `SUM(1, 2, 3)` |
| 求平均值 | `AVERAGE(1, 2, 3)` |
| 向下取整 | `INT(#{numberField_total})` |
| 绝对值 | `ABS(#{numberField_diff})` |
| 取余 | `MOD(#{numberField_count}, 7)` |
| 大于、大于等于 | `GT(#{numberField_total}, 100)`、`GE(#{numberField_total}, 100)` |
| 小于、小于等于 | `LT(#{numberField_total}, 100)`、`LE(#{numberField_total}, 100)` |
| 相等 | `EQ(#{textField_status}, "通过")` |
| 不相等 | `NE(#{textField_status}, "作废")` |
| 按条件返回不同值 | `IF(GT(#{numberField_total},100), "高", "低")` |
| 多个条件同时满足 | `AND(GE(#{numberField_age},18), LE(#{numberField_age},60))` |
| 任一条件满足 | `OR(EQ(#{textField_status},"通过"), EQ(#{textField_status},"免审"))` |
| 空备注显示默认文本 | 在另一个输出字段配置 `IF(ISEMPTY(#{textField_remark}), "无备注", #{textField_remark})`，避免当前字段引用自身 |

## 文本

| 目的 | 公式示例 |
| --- | --- |
| 拼接姓名和编号 | `CONCATENATE(#{textField_name}, "-", #{textField_code})` |
| 截取前四位、后四位 | `LEFT(#{textField_code}, 4)`、`RIGHT(#{textField_code}, 4)` |
| 文本长度 | `LEN(#{textField_content})` |
| 去掉首尾空格 | `TRIM(#{textField_content})` |
| 大写、小写 | `UPPER(#{textField_code})`、`LOWER(#{textField_code})` |
| 数字文本转数字 | `VALUE(#{textField_amount})` |
| 手机号中间四位打码 | `REPLACE(#{textField_phone}, 4, 4, "****")` |
| 按逗号分割后取第一项 | `ARRAYGET(SPLIT(#{textField_tags}, ","), 1)` |

## 日期、人员和子表

| 目的 | 公式示例或做法 |
| --- | --- |
| 今天 | `TODAY()` |
| 取年份、月份、日 | `YEAR(#{dateField_start})`、`MONTH(#{dateField_start})`、`DAY(#{dateField_start})` |
| 两个日期相隔天数 | `DAYS(#{dateField_end}, #{dateField_start})` |
| 日期加 90 天 | `DATEDELTA(#{dateField_start}, 90)` |
| 日期区间的相隔天数 | `CASCADEDATEINTERVAL(#{cascadeDateField_period})` |
| 结束时间晚于开始时间 | `TIMECOMPARE(#{dateField_end}, #{dateField_start})` |
| 当前登录人填入成员字段 | `USER()` |
| 当前登录人昵称填入文本字段 | `GETUSERNAME()` |
| 当前登录人的第一级主管名称 | `DIRECTOR(1)` |
| 汇总子表金额列 | 在主表字段中配置 `SUM(#{numberField_lineAmount})` |
| 子表当前行金额 | 在子表金额字段配置 `ROUND(#{numberField_linePrice} * #{numberField_lineQty}, 2)` |
| 子表两列对应相乘后求和 | `SUMPRODUCT(#{numberField_lineQty}, #{numberField_linePrice})` |

子表使用子字段自己的 ID。主表汇总、子表当前行计算是不同用途，保存后用两行不同数值检查结果。

日期函数可能需要日期对象或时间戳；先查询参数，需要转换时使用 `DATE` 或 `TIMESTAMP`，再带真实样例试算。人员函数依赖登录人和组织信息，以目标组织实际结果为准。

## 集合与校验

| 目的 | 公式示例或说明 |
| --- | --- |
| 合并两个多选集合 | `UNIONSET(#{checkboxField_a}, #{checkboxField_b})` |
| 两集合共同选项 | `INTERSECTIONSET(#{checkboxField_a}, #{checkboxField_b})` |
| 从已有集合扣除选项 | `DIFFERENCESET(#{checkboxField_all}, #{checkboxField_selected})` |
| 严格比较文本 | `EXACT(#{textField_a}, #{textField_b})` |
| 检查一列值是否重复 | `ARRAYREPEATED(#{textField_lineCode})`，按原生校验输入确认 |
| 检查已有表单记录是否包含该字段值 | `EXIST(#{textField_code})`，由原生校验编辑器预处理，并带入表单上下文 |

`EXIST` 用于已有记录查询，不是“某值是否在任意集合里”。`COUNT` 的元数据说明是统计指定表单提交的数据总数，也不能直接当作子表行数函数。

## 其他常用计算

| 目的 | 公式示例 |
| --- | --- |
| 最大、最小值 | `MAX(#{numberField_a}, #{numberField_b})`、`MIN(#{numberField_a}, #{numberField_b})` |
| 多个数字相乘 | `PRODUCT(#{numberField_price}, #{numberField_qty})` |
| 平方、平方根 | `POWER(#{numberField_base}, 2)`、`SQRT(#{numberField_area})` |
| 条件取反 | `NOT(ISEMPTY(#{textField_name}))` |
| 金额格式化为文本 | `TEXT(#{numberField_total}, "0.00")` |
| 人民币大写 | `RMBFORMAT(#{numberField_total})` |
| 生成编号字符串 | `UUID()` |
| 截取中间字符 | `MID(#{textField_code}, 3, 4)` |
| 当前时间、日期转时间戳 | `NOW()`、`TIMESTAMP(TODAY())` |
| 工作日天数 | `NETWORKDAYS(#{dateField_start}, #{dateField_end})` |
| 当前登录人的部门名称 | `DEPTNAME(LOGINUSERWORKNO())` |

这些例子以普通字段和校验为基础。调用前查询参数；具体可选函数由目标配置提供，自动化等输入可能没有其中某些函数。

## 按输入方式核对

使用 `formula check --contract field-value/validation-rule/business-action/node-expression` 选择相应的公式原文检查。原 `--context form/validation/business/automation` 是兼容别名，不代表已执行对应业务。

同一种函数写法可以在多个设计器共用；字段令牌、保存对象和实际执行的数据另看 `yida-formula`。数据集表达式和 JavaScript 使用自己的函数与检查入口。签名查询、静态诊断和实际运行分别提供不同证据，见 `yida-formula-evaluate`。

遇到嵌套 IF、AND/OR/NOT、除零处理或复杂校验时，读取 [带完整配置和预期结果的示例](../skills/yida-formula/references/nested-examples.md)，按对应小节改字段和常量。
