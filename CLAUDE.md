# AGENTS.md

> 本文件面向 AI 编码代理，假设读者对本项目一无所知。

## 项目概述

**pkg** 是从原 Textual/Python 项目（`old/`，见下）迁移而来的终端 TUI 工具，
用于统一管理本机已安装的各种包管理器。迁移目标框架为 **OpenTUI**（Zig 原生
渲染核心 + TypeScript/React 绑定），运行于 **Bun**。

当前为**核心版**：已迁移主界面（已安装列表 + 批量更新/卸载 + 本地过滤 + 仅显示
可更新）、全局搜索、包详情、确认对话框，以及全部 5 个后端（npm/pnpm/bun/winget/scoop）、
i18n（中/英）、配置持久化、快捷键配置。**尚未迁移**：设置界面（顶栏「设置」当前只
弹 toast 提示）、Textual 特有的系统命令面板/主题/截图等。

主要功能：

- 列出各包管理器已安装的**全局**包（"全部"视图聚合所有可用管理器，每行标注来源）
- 查看可更新的包、批量勾选更新、卸载（带确认框 + 命令预览）
- 全局搜索包（同 registry 的管理器只搜一次）、查看包详情、安装包
- 本地过滤框按包名实时过滤当前列表

界面语言默认随系统 locale（zh_CN/en_US），可经配置文件切换。
目标运行平台为桌面终端（开发环境为 Windows）。

## 技术栈

- **语言/运行时**：TypeScript + Bun（`bun run src/index.tsx`）
- **UI 框架**：`@opentui/core` + `@opentui/react`（React 19）。通过 `createCliRenderer`
  创建原生渲染器，`createRoot(renderer).render(<App/>)` 挂载。OpenTUI 渲染器需 native FFI，
  Bun 直接支持；Node.js 需 26.4.0 + `--experimental-ffi`。
- **构建**：无打包步骤，Bun 直接解释运行 TSX；`tsconfig.json` 仅做类型检查（`noEmit`）。
- **类型**：`strict`，但**特意关闭** `noUncheckedIndexedAccess` 与 `noImplicitOverride`
  （原 Python 不带这类检查，迁移期保持等价行为优先；CLI 表格解析大量按索引访问字符，
  开启会徒增噪音）。

## 常用命令

```bash
# 安装依赖
bun install

# 运行（带 watch）
bun dev
# 或直接
bun run src/index.tsx

# 类型检查
bunx tsc --noEmit
```

入口：`src/index.tsx`。

## 架构

```
src/
├── index.tsx              # 入口：createCliRenderer + createRoot(<App/>)
├── App.tsx                # 主应用：ManagerRegistry 运行时状态、useKeyboard 分发、
│                          #   overlay 栈（search/detail/confirm）、toast、表格/顶栏/底栏
├── runtime.ts             # 领域逻辑层（不依赖渲染）：ManagerRegistry、buildInstalledRows、
│                          #   buildSearchGroups(registry 去重)、previewCommands、doUpdateAll/doUninstallAll
├── i18n.ts                # t() 翻译 + 语言检测/切换
├── config.ts              # ~/.config/pkg-tui/config.json 持久化、快捷键/图标/语言 getter
├── locales/{zh_CN,en_US}.json
├── managers/
│   ├── types.ts           # PackageInfo / SearchResult / PackageDetail / OperationResult
│   ├── base.ts            # PackageManager 抽象类 + registerManager/listManagers 注册表
│   ├── _cli.ts            # runCommand(Bun.spawn 参数数组，无 shell)、parseJson、isAvailable
│   ├── npm.ts             # npm + _parseSearchResults/_parsePackageDetail/_makeResult（共享）
│   ├── pnpm.ts            # 复用 npm 解析
│   ├── bun.ts             # 纯文本正则解析；outdated 逐个 view；search/view 复用 npm
│   ├── winget.ts          # 表格按显示宽度切列（中文全角）+ show 键值解析
│   ├── scoop.ts           # ASCII 表头切列 + cat manifest JSON
│   └── index.ts           # import 各后端触发注册 + 统一导出
├── components/
│   ├── PackageTable.tsx   # 自建受控表格（box+text，光标高亮、斑马纹、勾选前缀、滚动窗口）
│   └── ManagerStrip.tsx   # 顶栏：设置/搜索按钮 + 过滤输入 + "全部"+各管理器按钮
└── screens/
    ├── ConfirmDialog.tsx  # 确认框（命令预览 + 确定/取消）
    ├── SearchScreen.tsx   # 搜索（registry 分组并发，i 安装 / v 详情）
    └── DetailScreen.tsx   # 包详情（后台 view，加载态，更新/删除/关闭）
```

### 与原项目（old/）的对应

| 原 Python            | 现 TS                          |
| --------------------- | ------------------------------ |
| `models.py`           | `managers/types.ts`            |
| `managers/base.py`    | `managers/base.ts`             |
| `managers/_cli.py`    | `managers/_cli.ts`（Bun.spawn）|
| `managers/{npm,pnpm,bun,winget,scoop}.py` | 同名 `.ts`      |
| `i18n.py` + `locales/`| `i18n.ts` + `locales/`         |
| `config.py`           | `config.ts`                    |
| `app.py`（主界面+编排）| `App.tsx` + `runtime.ts`       |
| `screens/*_screen.py` | `screens/*` + `components/`    |
| Textual `DataTable`   | 自建 `PackageTable`            |
| Textual `@work` worker| 普通 async + setState/rerender |
| `push_screen/dismiss` | overlay 数组（一次一层）       |

### 运行时要点

- **解耦**：`App.tsx` 只依赖 `PackageManager` 抽象与注册表，不 import 具体后端；
  新增管理器只需实现接口 + `registerManager` + 在 `managers/index.ts` import。
- **领域逻辑在 `runtime.ts`**，不碰 React/渲染，可独立测试与复用。
- **OpenTUI 渲染特性约束**：
  - `<text>` **不支持** `backgroundColor`（用 `bg`），**不支持** ellipsis；超宽用 `truncate`
    + `width`（布局宽度）裁切。
  - `<box>` 单边框用 `border={["bottom"]}` 数组，无 `borderBottom` prop。
  - `<text>` 内可用 `<span>/<b>/<strong>/<em>/<br>` 富文本；`t\`...\`` 模板字面量与
    `fg(color)(text)`、`bold(text)` 均从 `@opentui/core` 导入。
  - `<input>` props：`value/placeholder/focused/onInput/onChange/onSubmit`（`onSubmit`
    因与 React DOM `SubmitEvent` 同名有类型冲突，赋值时用 `as any` 绕过，运行时是 `(value:string)=>void`）。
  - 键盘统一用 `useKeyboard(key => ...)`，`key` 含 `name/ctrl/shift/meta`，有
    `preventDefault()/stopPropagation()`。`name` 归一：Enter→`"return"`，Esc→`"escape"`。
  - **焦点是渲染器的状态，不是组件的 state**：鼠标点击输入框会直接改
    `renderer.currentFocusedRenderable`，而 `filterMode`/`focusOnTable` 这类本地
    state 不会跟着变。全局 `useKeyboard` 若只信本地 state 判断"是否在打字"，字符键
    会**既进输入框又被当快捷键执行**（曾导致过滤框里输入 `opencode` 的 `d` 触发卸载）。
    因此：判断一律用 `src/focus.ts` 的 `isTextInputFocused(renderer)`；输入框加
    `onMouseDown` 把 state 同步回来；退出输入模式要拿 `ref` 显式 `blur()`
    （鼠标聚焦时 `focused` prop 本就是 `false`，React diff 不出变化）。
    回归测试见 `tests/focus-keys.tsx`。
- **状态刷新**：`ManagerRegistry`（`useRef` 单例）内部是 mutable；数据加载后调 `rerender()`
  强制重渲染，`buildInstalledRows`/`buildStripItems` 每次**直接计算**（不能用 `useMemo` 缓存，
  否则 reg 内部变化不会反映）。

### 主要快捷键（主界面）

| 按键（默认，可在 config.json 改） | 功能                 |
| ---------------------------------- | -------------------- |
| `s`                                | 打开搜索             |
| `r`                                | 刷新                 |
| `u`                                | 更新选中（或当前行） |
| `d`                                | 卸载选中（或当前行） |
| `space`                            | 勾选/取消勾选当前行  |
| `f`                                | 仅显示可更新的包     |
| `←` `→`                            | 顶栏按钮间移动焦点   |
| `↑`/`↓`                            | 顶栏 ↔ 表格 切换焦点 |
| `enter`                            | 查看选中包详情       |
| `Ctrl+C`                           | 退出                 |

搜索界面：`i` 安装、`v` 详情、`Esc` 返回。详情/确认：`← →` 切按钮、`Esc` 关闭。

## 如何新增一个包管理器后端

1. 在 `src/managers/` 新建模块，定义 `PackageManager` 子类，实现全部抽象方法：
   `listInstalled / listOutdated / search / view / install / update / uninstall / updateCommand / uninstallCommand`。
2. 设置实例字段 `name`（必填）、`display_name / icon / description / registry`。
3. 文件末尾调用 `registerManager(YourClass)`。
4. 在 `src/managers/index.ts` 加一行 `import "./your_module"`。
5. 子进程调用复用 `_cli.ts` 的 `runCommand/parseJson`；npm 系解析可复用 `npm.ts` 的
   `_parseSearchResults/_parsePackageDetail/_makeResult`。

UI 层（顶栏按钮、全部视图、搜索、确认）会自动识别新管理器，**无需改 App/screens**。

## 安全与注意事项

- 本工具会**真实执行**系统包管理器命令（`npm install -g` 等）；所有破坏性操作（更新/卸载）
  在 UI 中都有确认对话框二次确认，确认框展示将执行的完整命令——改动相关逻辑务必保留。
- 子进程用 `Bun.spawn([path, ...args])` 以**参数数组**执行（无 shell 拼接），包名直接来自
  CLI 输出，不要引入 `shell: true`。
- 无遥测、无网络请求发往 npm registry 之外的地方；registry 地址由用户本机 npm 配置决定。

## about `old/`

`old/` 是迁移前的原 Textual/Python 项目（`pkg_tui`），完整保留作为迁移参照。其中
`old/CLAUDE.md` 描述原项目。新代码在 `src/`，不再依赖 Python。
