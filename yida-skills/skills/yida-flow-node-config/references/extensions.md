# 扩展执行

## 什么时候用

调用外部接口、发起其他流程，或复用已有代码/AI 节点时。两套设计器共享部分配置器，具体动作、发起语义与输出仍需分别确认。

## 必填配置

| 节点 | 流程 | 自动化 spec |
| --- | --- | --- |
| 连接器 | 需要真实 `ConnectorNode.connectorRules` 才能透传 | 可直接生成，但需先发现真实 action schema：`connectorId/actionId/assignments` |
| 子流程/发起审批 | 需要真实 `InitiateApprovalNode.initiateApprovalRules` 才能透传 | 可直接生成：`initiateApproval`、目标流程表单、发起人、字段赋值 |
| Groovy/JavaScript | 编译器支持对应组件适配，需要真实节点输入输出及执行配置 | 当前未封装 |
| AI | 编译器支持 `AINode.workFlowRules` 适配，需要真实工作流配置 | 当前未封装 |

自动化连接器动作的 inputs/outputs 必须来自 CLI 平台只读发现或固定已证 preset。先调用 `use_skill("yida-connector")` 查到真实动作；嵌套参数用完整路径，如 `Body.userid`、`Path.unionId`，只有唯一叶子字段才用短名。

## 最小示例

自动化调用已查到的连接器动作；参数名和类型必须按该动作 schema 替换：

```json
{
  "type":"connector",
  "connectorId":"<真实连接器ID>",
  "actionId":"<真实动作ID>",
  "assignments":[{"column":"<真实输入参数路径>","valueType":"literal","value":"实际参数值"}]
}
```

自动化发起目标流程：

```json
{
  "type":"initiateApproval",
  "formUuid":"<真实目标流程formUuid>",
  "initiator":{"type":"current_user"},
  "assignments":[{"column":"<真实申请事项字段ID>","valueType":"literal","value":"自动发起申请"}]
}
```

流程的扩展节点不接受以上 spec。最小输入应从真实组件配置中保留节点类型及其规则对象，按实际动作只修改已知参数；没有真实配置时不生成空 props 或占位代码冒充可用节点。

## 特有限制

- 两套设计器的“发起审批”使用不同配置器。自动化的发起人不是目标流程审批人；审批角色在目标流程内设置。
- 指定自动化发起人时，`initiator.type: select_user` 的 `value` 是包含非空 `id` 和 `type: employee` 的身份 JSON 字符串；格式只在需要时读 [spec 编排](../../yida-integration/references/spec-authoring.md)。
- 官方宜搭 API 的 `systemToken` 使用 `secretBindings` 或 `--connector-system-token-app`。CLI 校验目标后安全绑定，不写入普通 assignment、页面源码或命令文本；不使用 `--connector-inputs` 自行伪造未知 schema。
- 流程原生扩展节点的参数、代码输入输出和 AI 工作流标识都需真实依据。支持序列化适配不代表任意脚本或 AI 任务已运行验证。
- 流程连接器、代码、AI 等节点的规则和示例见 [官方组件节点高级透传](../../yida-process-rule/references/official-component-nodes.md)，包括 `props/processProps/processType`、嵌套子节点及视图与运行参数转换。缺少输入契约、目标不明或参数类型不确定时先补齐事实，不创建替代资源。
