# custom-page-solutions - 宜搭自定义页面写法陷阱与原生链路自动化

## 背景

宜搭「自定义页面」运行在一个受限的运行时里：页面代码不是标准 React 组件，而是一组顶层
`export function`（`renderJsx` / `didMount` / 业务方法）被平台挂载为组件实例方法。很多在普通
React 里天经地义的写法（受控 `input`、`useState`、`this.setState({业务字段})`、原生 `<select>`）
在宜搭里会**静默失效**——不报错，但页面不渲染、事件不触发、样式不生效。

OpenYida 用一条纯 JS 编译链路把这些陷阱「能自动修的自动修、不能自动修的准确提示」：

```
page.oyd.jsx
  → page-compat.js   （fixYidaSource：AST 自动修复 + 运行时契约注入 + Tailwind 按需注入）
  → page-linter.js   （lintYidaSource：AST + 行级校验，error 阻断 / warning 提示）
  → page-compiler.js （Babel + UglifyJS 编译压缩）
  → publish.js       （注册 schema 数据源并发布）
```

本文汇总「12.4 自定义页面开发」问题清单、两类典型误区的根因，以及 custom-page 规范，
并给出每条规范对应的 lint / autofix 规则。

---

## 一、问题清单（现象 → 解决方案 → 链路支持）

| # | 问题 | 现象 | 正确解决方案 | 链路支持 |
|---|------|------|--------------|----------|
| 1 | `pageSize` 超限 | 数据请求返回异常 / 被平台截断 | 推荐 `pageSize: 50`（性能最佳），最大 100 | linter：`>100` error `page-size-limit`；`51~100` warning `page-size-recommend`。compat：缺省补 50、`>100` 钳到 100 |
| 2 | 受控 `input value={}` | 输入框无法编辑 | 用 `defaultValue` 而非 `value` | linter：error `controlled-input` |
| 3 | 原生 `<select>` | 样式不一致、移动端兼容差 | 改用宜搭 `SelectField`，或 `div+button+onClick` 自定义下拉 | linter：warning `native-select-ui`（文案引导 SelectField） |
| 4 | `{['线索','在谈'].map()}` | 被误报为 ES6 计算属性、编译中断 | 写法本身合法；根因是行级正则误报，已修复 | linter：删除行级正则，改由 AST `ObjectProperty` 权威判定 |
| 5 | `String.padStart()` | 静默失败、无输出 | 用三元运算符手写补齐 | linter：warning `pad-method` |
| 6 | JSX 事件绑定丢 `this` | 点击回调里 `this` 为 undefined | 用箭头函数包裹：`onClick={e => self.fn(e)}` | compat：`fixEventHandlers` 自动改写；linter：error `event-function` |
| 7 | `renderJsx` 内直接用 `this` | 闭包中 `this` 指向丢失 | 开头必须 `var self = this;`，闭包内用 `self` | compat：`fixSelfBinding` 幂等插入；linter：warning `self-binding-missing` |
| 8 | ECharts 图表不渲染 | 容器未挂载即 `init` | `setTimeout(function(){ echarts.init(...) }, 300)` | linter：warning `echarts-dom-ready` |
| 9 | Tailwind 样式不生效 | 原子类无效果 | `didMount` 中先 `ensureTailwind()` 注入 CDN | compat：按需 `injectTailwindRuntime`（仅命中原子类时注入，不覆盖手写 didMount） |

---

## 二、两类典型误区的根因

### 误区 A：`this.setState({业务字段})` 不触发重渲染

普通 React 靠 `setState` 更新任意 state 触发重渲染；宜搭自定义页面不是这样。

关键事实：`publish.js`（约 151–164 行）把
`timestampDataSource = { name: 'timestamp', type: VALUE }` **注册进 schema 的 `online` /
`list` 数据源数组**，`publish.js`（约 292 行）也据此识别。也就是说 `timestamp` 不是随意字段，
而是被 schema 注册的数据源——只有写它才会被平台识别为「状态变化」并重渲染。

因此运行时契约里 `forceUpdate()` 固定写：

```js
export function forceUpdate() {
  this.setState({ timestamp: new Date().getTime() });
}
```

**正解**：业务态写入 `_customState`，通过 `setCustomState()` / `forceUpdate()` 触发重渲染，
不要直接 `this.setState({业务字段})`。链路对此仅做**引导**（warning `setState-non-timestamp`），
不做字段重命名 autofix——因为盲目改字段名会破坏 schema 数据源耦合。

> 例外：`timestamp` 与 modern-authoring 兼容运行时的 `__openYidaCompatState` 是受控契约字段，
> 写入它们不会触发该 warning。

### 误区 B：`{['线索','在谈'].map()}` 被误报为计算属性

历史上 `page-linter.js` 用行级正则 `/\{\s*\[/` 粗暴判定 ES6 计算属性，会把 JSX 里合法的
`{['线索','在谈'].map(...)}` 误判为「计算属性」错误并阻断编译。

真正权威的计算属性检测由 AST 访问器 `ObjectProperty` 完成，它只对真正的 `{ [key]: value }`
计算属性键触发，不会误伤 JSX 数组字面量。本次已**删除冗余且有害的行级正则**，只保留 AST 判定：

- `{['线索','在谈'].map(...)}` → 不报错 ✅
- `var o = { [k]: 1 }` → 仍报 `computed-property` error ✅

---

## 三、custom-page 规范

### 10 条强制规则

1. 页面以顶层 `export function renderJsx()` 返回 JSX，不用 `export default`。
2. `renderJsx` 开头必须 `var self = this;`，闭包/回调内引用 `self` 而非 `this`。
3. 不使用 React Hooks（`useState`/`useEffect`/…）与 `import React`。
4. 输入框用 `defaultValue`，不要用受控 `value={}`。
5. JSX 事件用箭头函数包裹：`onClick={e => self.fn(e)}`，不要直接传 `this.fn`。
6. 业务态写入 `_customState`，用 `setCustomState()` / `forceUpdate()` 重渲染；`this.setState`
   仅用于 `timestamp` 契约字段。
7. 数据请求 `pageSize` 推荐 50、最大 100，优先 10/20/50。
8. 下拉优先宜搭 `SelectField`；确需自定义时用 `div+button+onClick`，不用原生 `<select>`。
9. ECharts 在容器挂载后初始化：`setTimeout(function(){ echarts.init(...) }, 300)`。
10. Tailwind 原子类需在 `didMount` 中 `ensureTailwind()` 先注入 CDN 后使用。

### 必须包含的基础结构

```js
// 运行时契约（compat 层会自动补全缺失项）
var _customState = {};
export function getCustomState(key) { /* ... */ }
export function setCustomState(newState) { /* 写 _customState + this.setState({timestamp}) */ }
export function forceUpdate() { this.setState({ timestamp: new Date().getTime() }); }
export function didMount() {}
export function didUnmount() {}

export function renderJsx() {
  var self = this;                 // 规则 2：必须
  return <div>{/* ... 引用 self.xxx */}</div>;
}
```

### 数据 API 调用范式

```js
export function loadRows() {
  var self = this;
  this.utils.yida.searchFormDatas({
    formUuid: 'FORM_XXX',
    pageSize: 50,                  // 推荐 50，最大 100
    currentPage: 1,
  }).then(function(res) {
    self.setCustomState({ rows: res.data });   // 业务态走 _customState
  }).catch(function(err) {
    console.error(err);            // 必须 catch，避免未捕获异常
  });
}
```

### ECharts 加载方式

```js
export function renderChart() {
  var self = this;
  setTimeout(function() {          // 规则 9：等容器挂载
    var chart = echarts.init(document.getElementById('chart'));
    chart.setOption(self.buildOption());
  }, 300);
}
```

---

## 四、规则 → 规范映射（哪些自动修、哪些仅提示）

| 规则名 | 级别 | 层 | 行为 | 对应规范 |
|--------|------|-----|------|----------|
| `event-function` / `event-direct-method` | error / autofix | linter / compat | 事件绑定丢 this → 箭头函数包裹（自动修） | 规则 5 |
| `array-callback-function` | error / autofix | linter / compat | 数组回调 `function` → 箭头函数 | 规则 5 |
| `controlled-input` | error | linter | 受控 `value={}` → 提示改 `defaultValue` | 规则 4 |
| `computed-property` | error | linter | 真·计算属性键 `{ [k]: v }`（AST 判定，不误伤数组） | 误区 B |
| `page-size-limit` | error | linter | `pageSize > 100` 阻断 | 规则 7 |
| `page-size-recommend` | warning | linter | `pageSize 51~100` 引导用 50 | 规则 7 |
| `self-binding-missing` | warning | linter | `renderJsx` 用 this 未声明 self（提示） | 规则 2 |
| `self-binding-inserted` | autofix | compat | 幂等插入 `var self = this;`（自动修，不改写残留 this） | 规则 2 |
| `setState-non-timestamp` | warning | linter | `setState({业务字段})` → 引导 `forceUpdate()`/`setCustomState()` | 规则 6 / 误区 A |
| `echarts-dom-ready` | warning | linter | `echarts.init` 无 `setTimeout` 守卫（提示） | 规则 9 |
| `native-select-ui` | warning | linter | 原生 `<select>` → 引导宜搭 `SelectField` | 规则 8 |
| `pad-method` | warning | linter | `padStart/padEnd` 静默失败 → 三元手写 | 问题 5 |
| `tailwind-injected` / `tailwind-didmount-hook` | autofix | compat | 命中原子类时按需注入 CDN 加载器，仅追加到空 `didMount` | 规则 10 |
| `pagesize-default-inserted` / `pagesize-clamped` | autofix | compat | 分页对象缺 `pageSize` 补 50；`>100` 钳到 100 | 规则 7 |
| `render-timestamp` | autofix | compat | 各 return 分支注入隐藏 timestamp 依赖 | 误区 A |

> 逐行豁免：任一 lint 规则可用 `// openyida-lint-disable-next-line <rule>` 或
> `// openyida-lint-disable-line <rule>` 关闭。
