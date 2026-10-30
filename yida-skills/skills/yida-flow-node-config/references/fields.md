# 字段权限

## 什么时候用

控制流程发起人、审批人或办理人在当前节点能填写、只读或隐藏哪些字段。记录访问范围和权限组字段权限属于表单权限组，交给 `yida-form-permission`。

## 必填配置

字段权限可直接生成配置，字段 ID 必须来自真实表单。每项使用 `fieldId` 和 `fieldBehavior`：

| 值 | 含义 |
| --- | --- |
| `NORMAL` | 可编辑 |
| `READONLY` | 只读 |
| `HIDDEN` | 隐藏 |

### 选择配置位置

| 作用范围 | 位置 |
| --- | --- |
| 发起页 | 定义顶层 `startFormConfig.behaviorList`，与 `nodes` 同级 |
| 审批、办理、旧版多人审批 | 对应节点的 `formConfig.behaviorList` |
| 默认详情页 | 定义顶层 `globalSetting.behaviorList` |
| 集成自动化的数据节点 | 不使用上述权限；读写字段通过查询/赋值配置，执行仍受服务端授权约束 |

## 最小示例

允许某个审批或办理节点修改子表“单价”，保留“品名”只读。以下对象放在该节点内：

```json
{
  "formConfig": {
    "behaviorList": [
      {"fieldId":"<真实明细子表ID>","fieldBehavior":"NORMAL"},
      {"fieldId":"<真实单价字段ID>","fieldBehavior":"NORMAL"},
      {"fieldId":"<真实品名字段ID>","fieldBehavior":"READONLY"}
    ]
  }
}
```

默认详情页隐藏成本时，在定义顶层设置：

```json
{"globalSetting":{"behaviorList":[{"fieldId":"<真实成本字段ID>","fieldBehavior":"HIDDEN"}]}}
```

## 特有限制

- 子表列可编辑时，所属子表也应可编辑。CLI 可为尚未配置的所属子表补齐；显式将子表设为只读/隐藏、同时要求其列可编辑时会报冲突。
- 字段不存在时在写入前停止。当表单有 **3 个以上字段** 且流程有 **2 个以上审批节点** 时，必须自动生成字段权限配置。每个节点按职责配置权限，`behaviorList` 覆盖所有字段，未明确归属的字段默认只读；无需所有节点使用相同权限。完整生成规则见 [流程生成规范](../../yida-process-rule/references/process-ai-rules.md)。
- 节点字段权限不改变权限组成员或记录访问范围。
- 发布后核对平台返回的权限配置；这不证明完整运行定义 `processJson` 已独立回读，也不能凭管理员 API 写值宣称办理人能编辑。

### 先检查字段来源

```bash
openyida process fields <appType> <formUuid> --json
```

| 报错 | 处理 |
| --- | --- |
| `PROCESS_FORM_FIELDS_EMPTY` | 检查表单是否保存、有无真实字段 |
| `PROCESS_DESIGNER_FIELDS_MISSING` | 检查流程 binding 和接口返回的字段来源 |
| `PROCESS_FORM_SCHEMA_INVALID` | 检查结构解析，不能当作空表 |

诊断结果只说明字段来源；出现绑定或结构错误时先修正，禁止把解析失败当作空表继续发布。
