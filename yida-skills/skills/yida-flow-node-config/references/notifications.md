# 通知节点

## 什么时候用

向成员或角色发送消息，或者使用已有邮件/卡片节点时。通知接收人与审批处理人是两种用途，选择同一角色也不代表执行审批。

## 必填配置

| 节点 | 流程 | 自动化 spec |
| --- | --- | --- |
| 消息 | 可直接生成：`SendMessageNode.sendMessageRules` | 可直接生成：`sendMessage` |
| 邮件 | 需要已有真实 `SendEmailNode.sendEmailRules` 才能透传 | 当前未封装 |
| 发送/更新卡片 | 需要已有真实卡片组件与规则才能透传 | 当前未封装 |

普通消息使用 `messageType: NORMAL`，填写标题、正文和至少一类接收对象：

| 对象 | 参数 |
| --- | --- |
| 成员 | `toUsers: [{userId, userName}]` |
| 角色 | `toRoles: [{roleCode, roleName}]` |
| 表单成员字段 | `userFields: ["<真实成员字段ID>"]` |

对象可组合。角色 ID 来自目标组织；消息使用 `roleCode/roleName`，人工处理使用 `id/name/roleType`，不要混用。

## 最小示例

自动化 spec 中的消息节点：

```json
{
  "type":"sendMessage",
  "name":"通知财务",
  "messageType":"NORMAL",
  "title":"新的申请",
  "content":"请查看申请详情",
  "toRoles":[{"roleCode":"<真实角色ID>","roleName":"财务"}]
}
```

流程定义中的对应节点：

```json
{
  "componentName":"SendMessageNode",
  "name":"通知财务",
  "sendMessageRules":{
    "messageType":"NORMAL",
    "messageInfo":{"title":"新的申请","content":"请查看申请详情","buttons":[]},
    "appType":"<目标appType>",
    "toRoles":[{"roleCode":"<真实角色ID>","roleName":"财务"}],
    "toUsers":[],
    "userFields":[]
  }
}
```

## 特有限制

- 标题/正文引用字段时用 `#{fieldId-ComponentType}#`，详见 [条件与变量](conditions-variables.md)。按钮链接须指向真实目标，不从示例猜资源 ID。
- 上述直接生成能力只覆盖普通成员/角色/成员字段消息。群消息、机器人及其他复杂消息来源需已有真实配置，不能只改 `messageType`。
- 邮件需真实收件地址来源、正文等配置；卡片需真实模板、发送或更新标识及参数，不能把普通消息结构放到邮件/卡片节点。
- 平台有邮件或卡片配置器，不代表自动化 spec 已支持。当前入口未封装时报告缺口，不能塞进任意 props 绕过。
- 分别报告配置保存和消息送达结果；只有实际送达证据才能宣称通知成功。
