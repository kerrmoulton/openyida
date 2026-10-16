## EmployeeField 设置默认值为当前登录人

若配置人员默认值公式，先读 [人员公式允许范围](../../yida-formula/references/employee-formulas.md)。通用 `IF/ISEMPTY` 不在人员默认值公式列表中；构造器函数不能统一转大写。

宜搭 EmployeeField 设置默认值为当前登录人，需要添加以下三个属性：

```json
{
  "valueType": "variable",
  "complexValue": {
    "complexType": "formula",
    "formula": "USER()",
    "value": []
  },
  "variable": {
    "type": "user"
  }
}
```
