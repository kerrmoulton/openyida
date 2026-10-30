# 人工处理节点

## 什么时候用

需要人审批、补充资料、办理或接收抄送时。人工节点属于流程；集成自动化通过“发起审批”调用目标流程，不直接添加这些节点。

## 必填配置

| 节点 | `type` | 人员参数 | 其他差异 |
| --- | --- | --- | --- |
| 审批 | `approval` | `approver` | `multiApproverType` 控制多人处理方式 |
| 办理/填写 | `operator` | `executor`，兼容 `approver` | 与审批共用选人和字段权限配置 |
| 抄送 | `carbon` | `receiver`，兼容 `approver` | 不配置加签/转交按钮 |
| 旧版多人审批环节 | `multiApproval` | `approver` | 节点的 `mode: all/or/oneByOne` 必填 |

以上可直接生成配置；每个节点提供 `name` 和人员来源。人员、角色与主管的格式只读 [人员选择](actors.md)；需要编辑字段再读 [字段权限](fields.md)，需要按钮再读 [操作按钮](actions.md)。

## 最小示例

指定成员办理，并让其填写处理结果：

```json
{
  "type":"operator",
  "name":"资料补充",
  "executor":{"type":"user","users":[{"id":"<真实userId>","name":"负责人"}]},
  "formConfig":{"behaviorList":[
    {"fieldId":"<真实处理结果字段ID>","fieldBehavior":"NORMAL"},
    {"fieldId":"<真实金额字段ID>","fieldBehavior":"READONLY"}
  ]}
}
```

### 节点属性与别名

| 属性 | 必填 | 说明 |
| --- | --- | --- |
| `type` | 是 | 使用上表的节点类型 |
| `name` | 是 | 节点名称；同一流程不能重复，跳转规则按此名称查找目标 |
| 人员参数 | 是 | 审批／多人审批用 `approver`，办理用 `executor`，抄送用 `receiver` |
| `description` | 否 | 节点描述 |
| `formConfig` | 否 | 当前节点的字段权限 |
| `actions` | 否 | 处理按钮；不适用于抄送 |
| `routeRules` | 否 | 跳转规则，见 [流转控制](control.md) |

| 支持的写法 | 归一化节点 |
| --- | --- |
| `approval / ApprovalNode` | 审批 |
| `operator / executor / OperatorNode` | 办理 |
| `multiApproval / MultiApprovalNode` | 旧版多人审批组件 |
| `carbon / cc / CarbonNode` | 抄送 |

新配置优先使用上方节点表中的简化写法。

### 多人审批示例

```json
{
  "type": "multiApproval",
  "name": "多人会审",
  "mode": "all",
  "approver": {
    "type": "user",
    "users": [
      { "id": "<真实userId_A>", "name": "审批人 A" },
      { "id": "<真实userId_B>", "name": "审批人 B" }
    ]
  }
}
```

`mode` 必填且只用 `all/or/oneByOne`。CLI 生成运行层的 `mode: multi / multiApprove / multiRules` 与设计器的 `MultiApprovalNode / multiApproverRules`；原始多人规则的内外层不能混写。

## 特有限制

- 新建会签、或签或依次审批，优先使用 `approval` 的 `approver.multiApproverType`。`MultiApprovalNode` 是旧版环节兼容能力，不是多人审批的唯一做法。
- “指定角色”是选人方式，“条件模式”是按条件选不同人员。条件选人使用 [人员选择中的条件选人](actors.md#按条件选人)，不要只改 `mode` 或用条件分支替代。
- 原始 `approverConfig/approver.processProps/approver.approverRules` 仅在有真实配置时使用；运行配置与设计器规则分别核对。接口人、连接器选人、权限矩阵等特殊来源不能只凭名称编造参数。
- 抄送与办理用途不同；抄送对象不能据此获得办理能力。旧版多人环节的内外两层规则由 CLI 编译，不手写空人员列表。
