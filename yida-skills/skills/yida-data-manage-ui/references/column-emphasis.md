# 列级强调

用户说“突出客户名称列”“金额列更醒目”“状态列改成标签”时，先用 get-schema 和真实 DOM 将列名映射到字段 ID。优先在现有主题中做字段级最小改写，不改字段类型、数值格式、数据、权限或动作。定位、token 与状态写法见 [实施映射](token-and-css.md)。

- 默认强调一到两列，沿用已确认的页面风格；名称列可用浅底色、强表头、加粗文字。默认不加左侧竖线，也不伪装成可点击链接。

## 可选配方快捷方式

只有当前页已采用生成器配方且希望沿用时，才使用以下参数；手写方案无需 style ID。

- `--emphasize-field <actualId>` 可重复；`--tag-field <selectFieldId>` 可重复，仅用于已核实的原生 SelectField 预览结构。两种角色不要用在同一字段。目标 ID 也用于隐藏导航时定位表格；命令不联网核实字段是否存在，必须先读真实字段。
- 标签保留原文字，统一底色。逾期、超预算等条件强调需要已确认的业务规则及承载能力；不得按行号、记录 ID、固定文本快照给状态染色，不伪造 CSS 文本匹配能力。复杂规则走已验证的原生配置或获准的自定义页。

```bash
openyida data-manage-style generate --app APP_ID --form FORM-ID --style <当前配方ID> --base-css before/theme.css --output emphasized.css --emphasize-field textField_actualName --tag-field selectField_actualStatus --json
```

`--style` 使用该页当前已确认的配方；它会重建该 app/form 的整个受管样式块，不是对第三方主题任意叠加。保留既有 `--focus`、`--follow-shell` 和字段参数，避免只加列强调时重置已有选择。需要移除列强调时，基于最新快照重新生成同页配方并省略对应参数；块外手写样式不会自动清除。

手写方案维护本轮字段级 CSS 区块即可，不执行整页配方重生成。发布沿用主技能的完整主题备份、差异检查、回读和恢复流程。实际检查表头文字与排序图标、正常/悬浮/行选中/区域选中、横滚、显示列与空值；保持列宽、虚拟行高和原有交互。非文本复杂字段只保证外层强调，不声称其内部 renderer 已适配。
