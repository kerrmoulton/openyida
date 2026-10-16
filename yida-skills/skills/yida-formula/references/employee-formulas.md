# 人员组件默认值公式

范围仅为 `EmployeeField` 的默认值公式，不适用于自定义校验、集成自动化、流程表达式或部门字段。2026-10-16 从宜搭原生设计器函数菜单核验，包含折叠的“其它函数”：

| 分类 | 函数（保留大小写） |
| --- | --- |
| 人员获取 | `DirectorBuilder`、`EMPLOYEE`、`ESIGNUSER`、`USER`、`UserBuilder` |
| 集合 | `DIFFERENCESET`、`INTERSECTIONSET`、`SUBSET`、`UNIONSET` |
| 其它 | `GetArrayItem`、`GetObjectField` |

列表表示函数在编辑器中可用，不表示任意参数组合、嵌套或返回类型都能赋给人员字段。不得加入 `IF`、`ISEMPTY` 等通用函数做空值包装。人员模型、通讯录权限、组织主管关系仍需平台运行验证。

获取指定成员一级主管的官方写法（替换为真实字段 ID）：

```text
DirectorBuilder(GetArrayItem(#{employeeField_actual},1),1)
```

`DirectorBuilder` 的空来源可能代表当前登录人；不得把空客户经理计算出的登录人主管当作客户经理主管。空来源保护要单独设计和验证，不能通过不支持的 `IF/ISEMPTY` 包装解决。

Schema 的 `formula`、`complexValue.formula` 保存可执行表达式；不能将公式编辑器复制出的 `{"text":...,"marks":...,"isCmData":true}` JSON 字符串直接存入这两个属性。

CLI 检查：

```bash
openyida formula evaluate 'DirectorBuilder(GetArrayItem(#{employeeField_actual},1),1)' --component EmployeeField --schema schema.json --json --strict
```

返回 `componentProfile.allowedFunctions` 可读取已核验列表。`create-form` 保存 Schema 前也会检查人员默认值公式，拒绝不在此列表内的函数。若平台新增函数，先在编辑器核验，再更新 `lib/formula/component-profiles.js` 和本参考；不要把其他控件的目录直接并入人员列表。

其他组件尚无专用允许列表，保留通用静态检查，后续遇到实际差异再补 profile。

官方参考：

- [获取指定成员主管](https://docs.aliwork.com/docs/yida_subject/_5/ghkfio8hy0aiweu2)
- [构造器函数](https://docs.aliwork.com/docs/yida_support/wtwabe/cnzrgo/gvtpe4/sdyd0ed5wbf8wi7x)
