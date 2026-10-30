# 数据卡片投放与播报

`publish` 发布设计草稿，投放页的播报配置是另一份资源。投放相关能力使用同一个 `data-card` 命令：

本说明仅适用于用户已经显式选择的宜搭原生数据卡片。不能仅凭“投放、数据播报、发送到群”等泛称触发本能力；明确选择原生卡片也不等于授权实际发送。

```bash
openyida data-card release-get APP_XXX CARD-xxx --out release-config.json --json
openyida data-card release-check APP_XXX CARD-xxx --json
openyida data-card refs APP_XXX CARD-xxx --page 1 --size 20 --json
```

结果的 `urls.releaseUrl` 是目标应用、卡片对应的投放页。`release-get` 返回 `releaseHash`、`releaseConfig` 和原始响应；尚未配置时 `releaseConfig=null`，不要猜接收人。`refs` 对应门户使用记录，不会挂载或移除门户组件。`release-check` 核对已发布状态和服务端播报权益，不启动任务。

## 保存、启用和关闭

先确认用户实际需要的接收组织、人员或群、时间与重复规则。人员使用该组织真实用户 ID，群使用平台群选择器返回的会话 ID；不根据姓名、群名臆造。可通过已有通讯录或群查询能力核实。最多十人、一个群，至少有一项非空。下面仅展示结构，替换示例值后再执行：

```json
{
  "enableCardRelease": false,
  "schedule": {
    "startDate": "2026-12-01 09:00",
    "repeat": "DAILY",
    "maxCount": 30
  },
  "workIds": [{ "id": "真实组织用户ID", "name": "接收人" }],
  "groupIds": [],
  "jumpUrl": "https://example.com/business",
  "messageText": "经营数据播报"
}
```

```bash
openyida data-card release-save APP_XXX CARD-xxx --config release-config.json --expected-hash <releaseHash> --json
```

`enableCardRelease=false` 保存为关闭状态，不注册播报。启用时设为 `true`，还必须传 `--allow-send`；它表示允许注册会实际发送数据的定时播报。Agent 应在用户明确要求启用、且接收范围和时间均已确认后执行，不能把“开发投放功能”当作给真实人员发消息的授权。查看或预览无需该参数。

```bash
openyida data-card release-save APP_XXX CARD-xxx --config enabled-release.json --expected-hash <最新releaseHash> --allow-send --json
```

关闭既有播报：用 `release-get --out` 导出配置，只把 `enableCardRelease` 改为 `false`，保留时间和接收人，用本次 `releaseHash` 保存。服务端停用已有定时任务；不要清空发送范围，原生接口仍要求范围非空。初次创建配置要求卡片已经发布。

- 首次发送使用 `Asia/Shanghai` 的 `YYYY-MM-DD HH:mm`，从明天起、一年以内，07:00–23:59。不要复制示例中的过期日期。既有配置关闭时允许保留过去的首次时间。
- `repeat` 支持 `DAILY/WORKDAY/LEGAL_WORKDAY/WEEKLY/BI_WEEKLY/MONTHLY/LAST_DAY_PER_MONTH/LAST_WORKDAY_PER_MONTH/LAST_LEGAL_WORKDAY_PER_MONTH/YEARLY`，具体可用性服从平台。没有小时、自定义和一次性规则。
- 结束条件二选一：`maxCount` 为 1–200；或 `endDate`，同样时间格式，晚于首次发送且在一年内。
- `release-get` 导出的 `repeatRule` 是原生结构，可直接回存；它和简化 `schedule` 二选一。CLI 从当前配置获取 UUID，不接受调用方指定其他配置 UUID。
- `jumpUrl` 使用无账号密码的绝对 HTTP(S) 地址；跳转链接和提示语各不超过 100 字符。
- `--expected-hash` 使用 **releaseHash**，不是设计草稿的 schemaHash。写前备份并二次读取，写后核对全部可写配置；摘要检查没有服务端原子锁，不能保证无并发覆盖。
- 写请求不自动重放。超时或保存后回读失败时先重新 `release-get`，确认现状再重试；平台可能已改变定时任务。
- 原生 `getCardPushConfig` 在已有配置时可能初始化酷应用。若保存返回 UUID 后回读报“创建酷应用失败/illegal parameter”，结果为失败并保留 `writeAccepted=true/readbackVerified=false` 和 UUID；不要再次保存或宣称配置未落库，应由管理员检查应用的酷应用初始化条件。关闭配置也可能遇到这一平台问题。

## 群投放和门户范围

`scheduled=true` 只证明播报配置已启用。`groupInstallationRequired=true` 时，使用返回的 `coolAppCode` 和 `urls.releaseUrl`，到钉钉客户端确认向该群安装酷应用；CLI 当前不代替客户端安装，也不把保存配置宣称为安装完成。已有安装情况仍需在客户端核实。

门户通过原生“数据卡片”组件消费已发布卡片，单门户最多五个数据卡片组件。当前 CLI 提供使用记录查询和投放入口，**尚未自动创建或修改门户中的数据卡片组件**；不要用浏览器手工挂载后声称 CLI 已支持自动投放门户。

## 测试发送与验证

仅在用户明确要求测试发送时执行：

```bash
openyida data-card release-test APP_XXX CARD-xxx --allow-send --json
```

测试配置文件可选，只接受 `jumpUrl`、`messageText`，不能覆盖接收人。原生接口实际向当前操作人异步发送一次快照，不会向配置中的群或其他人员测试。受管搭建任务禁止自动执行此发送操作，明确授权后通过直接 CLI 执行。`accepted=true` 是任务受理，`deliveryVerified=false` 不代表已经收到；需要当前操作人在钉钉确认。不要因尚未收到而连续重复调用。

配置保存、启用、关闭和测试均使用已发布卡片；保存设计草稿不会自动更新发布版。播报数据是每天快照，通常反映前一天数据，以最后一次保存人的数据视角生成，不是实时数据，也不是接收者重新按自身权限查询的数据。确认接收范围时需要考虑该视角。

平台拒绝权限、版本或播报额度时保留错误码并停止；创建卡片的权益不等于启用播报的权益，不修改版本、额度或应用标记。保存配置与测试发送不会自动改变卡片设计或门户布局。

验收分别记录配置回读、开关状态、权益检查、门户引用和实际消息接收证据。未实际启用或发送时明确标记“未验证定时触发/送达”，不能用单测或 HTTP 成功替代。

产品规则来源：[官方卡片投放说明](https://docs.aliwork.com/docs/yida_support/_11/xm7x0w/yvp9hw/cpkmxvpgchx339qq/sv1c236glf4ok4nx)。服务端实际权限、权益和校验结果仍是最终判定。
