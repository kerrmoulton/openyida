# 官方组件节点高级透传

在流程表单中配置连接器、数据、消息、代码、AI 等官方组件节点时使用。OpenYida 采用“真实组件 props 透传＋processJson 适配”：CLI 生成节点顺序、连线和运行类型，保留设计器配置，再转换为对应的运行参数。

业务参数必须来自已有流程、真实设计器配置或已验证接口。可以复用这些配置新增节点或修改已知参数；不能仅凭节点名称猜测完整规则。节点类别及共用配置见 `use_skill("yida-flow-node-config")`。

## 支持的组件与配置字段

下表列出 CLI 可透传的组件、运行类型和规则字段。透传前取得对应的真实配置；普通消息也可按通用技能的通知格式配置。

| `componentName` / `type` | `processJson.type` | 典型配置字段 |
| --- | --- | --- |
| `ConnectorNode / connector` | `innerConnector/thirdConnector/httpConnector/faasConnector` | `connectorRules` |
| `GroovyNode / groovy` | `CodeExecutor` | `groovy` |
| `JavaScriptNode / javascript` | `CodeExecutor` | `JavaScript` |
| `GetSingleDataNode / getSingleData` | `dataRetrieve` | `getData` |
| `GetBatchDataNode / getBatchData` | `dataRetrieve` | `getData` |
| `AddDataNode / addData` | `dataCreate` | `addDataRules` |
| `UpdateDataNode / updateData` | `dataUpdate` | `updateDataRules` |
| `DeleteDataNode / deleteData` | `dataDelete` | `deleteData` |
| `SendMessageNode / sendMessage` | `sendMessage` | `sendMessageRules` |
| `SendEmailNode / sendEmail` | `sendEmail` | `sendEmailRules` |
| `InitiateApprovalNode / subProcess` | `initiateApproval` | `initiateApprovalRules` |
| `SendCardNode / CardNode` | `sendCard` | `sendCardRules / cardRules` |
| `UpdateCardNode / CardUpdateNode` | `updateCard` | `updateCardRules / cardUpdateRules` |
| `CycleContainer / foreach` | `foreach` | `cycleContainerRules`，兼容 `cycleRules/foreachRules` |
| `AINode / ai` | `AIExecutor` | `workFlowRules` |

## 如何使用真实配置

1. 从目标流程已有配置或已验证接口取得组件及其完整业务规则，缺少完整配置时停止，不编造业务规则。
2. 使用对应 `componentName` 或编译器已支持的别名；保留实际 `props` 或同名规则对象。
3. 只修改已知参数，保留其引用、输入输出 schema 及业务设置。没有参数依据时，明确报告缺少的配置，不填空对象。
4. 交给 `configure-process` 编译完整流程并保存；它不是单节点 patch。

## 连接器节点示例

参数 Schema 与运行时实参的表示形式需要分别核对，源字段类型不能代替目标消费契约。配置表达式前读 [运行时类型边界](runtime-values.md)。

原生 `connectorRules.inputs` 数组是编辑器的参数 Schema，不是运行参数。运行配置必须由分组规则转换为 `props.inputs.assignments`（例如 `Query → userid`），不能把 Schema 数组展开成对象，也不能直接打平为没有 `column` 的编辑器规则。工厂详情、测试或 `invokeService` 成功均不能证明应用流程设计器可加载动作；保存入口会先只读检查该应用的 `connector/getAction.json`，失败时必须停止，不能绕过预检继续保存或发布。

以下展示规则对象的放置方式。连接器、动作、鉴权连接及参数路径须以真实 action schema 为准，示例 ID 不能直接提交。

```json
{
  "type": "connector",
  "name": "调用连接器",
  "connectorRules": {
    "connectorId": "<真实连接器ID>",
    "actionId": "<真实动作ID>",
    "connector": { "mode": 1 },
    "inputs": {
      "assignments": [
        { "column": "subject", "valueType": "literal", "value": "流程通知", "assignments": [] },
        { "column": "creatorId", "valueType": "processVar", "value": "form_inst_modifier", "assignments": [] }
      ]
    }
  }
}
```

`subject/creatorId` 仅示范参数路径，须由真实动作确认；`form_inst_modifier` 也须是当前流程可用的变量。`connector.mode` 映射：`1 → innerConnector`、`3 → thirdConnector`、`5 → httpConnector`、`9 → faasConnector`。

保存时，`connectorRules.inputs` 和连接器标识会转换到 `processJson.props.inputs`；鉴权连接取自 `connectorRules.connectionId` 或 `connection`。只有接口证据表明运行类型不同，才传 `processType`（兼容 `processNodeType`）覆盖。

上例为内置连接器的兼容参数形式，不能作为 HTTP 原生编辑器的 Schema。HTTP 节点（mode 5）需保留真实动作的 `inputs` 数组和独立的 `rules`，例如以下结构片段；标识、字段及完整元数据仍须从实际动作回读：

```json
{
  "connectorRules": {
    "connectorId": "<真实HTTP连接器标识>",
    "actionId": "<真实动作标识>",
    "connectionId": 123,
    "connector": { "mode": 5 },
    "inputs": [{ "name": "Query", "paramType": "Object", "childList": [
      { "name": "userid", "componentName": "TextField" }
    ] }],
    "rules": [{ "name": "Query", "id": "Query", "rules": [
      { "name": "userid", "id": "Query%userid", "valueType": "column",
        "value": "#{textField_example}",
        "__source": "#{textField_example}",
        "__display": "用户标识" }
    ] }]
  }
}
```

示例中的字段 ID、参数名和公式须按实际接口及表单配置替换，不代表固定业务映射。

## 数据／消息／代码节点示例

下面是节点结构片段，说明每类规则放在哪里。查询条件、代码输入输出、消息对象等须从真实配置中补齐或保留；不能用片段覆盖已有完整规则。

```json
{
  "nodes": [
    {
      "componentName": "GetSingleDataNode",
      "name": "查询记录",
      "getData": {
        "sourceId": "<真实源表单ID>",
        "quantity": 1,
        "assignments": []
      }
    },
    {
      "componentName": "JavaScriptNode",
      "name": "执行脚本",
      "JavaScript": {
        "inputs": [],
        "scriptType": "JavaScript",
        "action": { "code": "return inputs;" },
        "outputs": []
      }
    },
    {
      "componentName": "SendMessageNode",
      "name": "发送通知",
      "sendMessageRules": {
        "messageType": "NORMAL",
        "appType": "<目标appType>",
        "messageInfo": { "title": "流程通知", "content": "请及时处理" },
        "toUsers": [
          { "userId": "<真实userId>", "userName": "<真实姓名>" }
        ]
      }
    }
  ]
}
```

`getData` 转为运行层的查询参数，`quantity` 转为字符串；`JavaScript/groovy` 转为 `inputs/action/scriptType/outputsSchema`；`sendMessageRules` 转为消息运行参数。代码的执行环境和输入输出仍按真实节点配置确定，编译通过不代表脚本已执行。

## 透传规则

- 代码节点的 `inputs` 是数组，不能写成连接器运行参数的 `{ "assignments": [] }`。缺省输入会编译为 `[]`，JavaScript 的原生 `scriptType` 为 `JavaScript`；不合法的结构在任何远程写入前报错。
- 节点公式使用 automation 上下文进行校验，不沿用人员组件专用函数。通过 `__source` 保留编辑器引用（例如 `#{lookup//errcode}`），运行式转换为 `#{lookup}.errcode`；不改动字符串字面量内的相似文本。不要手工拼接两份不同来源的执行式和显示式。
- 新增高级节点须通过共享流程编译器和保存入口。保存、回读一致只证明持久化；未检查原生界面或真实流程运行时，不得声称已验证可编辑或流转成功。

- `props` 保留在 `viewJson` 节点中；缺少的 `name/nodeName/description` 由 CLI 补齐。也可把表中规则对象放在节点顶层，CLI 仅在 `props` 未配置同名项时补入；`viewProps` 最后覆盖视图参数。
- `processJson.props` 按组件转换规则生成，并移除 `name/nodeName/description/title` 等视图字段。连接器、代码、取数、新增数据和 AI 各有转换，不能直接把视图 props 当作运行参数。
- `processProps` 最后覆盖同名运行参数，属于浅合并：传入 `inputs` 会替换整个 `inputs`。使用前保留完整的原参数；它不会同时更新 `viewJson.props`。
- `processType/processNodeType` 只覆盖运行类型，不能让未知组件变为受支持组件；不认识的节点类型直接报错，不静默跳过。
- 官方组件可用 `children/childNodes` 嵌套子节点，常用于 `CycleContainer`；循环范围、当前项引用及子节点规则必须保留真实配置。
- 设计器分支由 `ConditionContainer + ConditionNode/ParallelNode` 表达，不是独立的 `BranchNode` 序列化组件。普通条件和并行分支使用 `route/parallel` DSL。
- 这些规则通过 `configure-process` 编译并保存完整流程图；该命令不是单节点 patch，已有流程的非目标节点与设置也须保留。

## 与自动化 spec 的边界

自动化 spec 只接受当前 builder 明确支持的节点类型，不接受任意原生 props。即使平台的两套设计器共用配置器，也不能将本表所有组件交给 `integration create --spec`。具体支持与缺口以通用技能各类别表为准。

编译通过与平台运行通过分别陈述；未知节点类型会报错，不应通过换类型或删节点来掩盖缺口。
