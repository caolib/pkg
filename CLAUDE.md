# AGENTS.md

> 本文件面向 AI 编码代理，假设读者对本项目一无所知。

## 项目概述

**pkg** 是从原 Textual/Python 项目（`old/`，见下）迁移而来的终端 TUI 工具，
用于统一管理本机已安装的各种包管理器。迁移目标框架为 **OpenTUI**（Zig 原生
渲染核心 + TypeScript/React 绑定），运行于 **Bun**。

当前为**核心版**：已迁移主界面（已安装列表 + 批量更新/卸载 + 本地过滤 + 仅显示
可更新）、全局搜索、包详情、确认对话框、设置界面（快捷键/图标/语言，写回
`~/.config/pkg-tui/config.json`），以及全部 7 个后端（npm/pnpm/bun/winget/scoop/cargo/choco）、
i18n（中/英）、配置持久化、快捷键配置。

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

# 测试（bun:test，tests/*.test.tsx）
bun test

# 类型检查
bunx tsc --noEmit

# Lint（Biome，~25ms 全量）
bun run lint          # 仅检查，不改代码
bun run check         # 检查 + 安全自动修
bun run format        # 格式化全部源码（--write）

# 只跑不依赖渲染器的纯逻辑测试（快，~40ms）
bun test tests/date.test.ts tests/search-groups.test.ts
```

入口：`src/index.tsx`。

### 关于 Biome

`biome.json` 用 `recommended` 规则集，但迁移期下调了一批噪声规则为 warn（不阻塞 `lint`）：
`noExplicitAny`（CLI JSON 解析大量 `as any`，迁移期保留）、`useExhaustiveDependencies`
（OpenTUI useEffect 多为渲染器副作用，自动补依赖有风险，勿自动改）、`noArrayIndexKey`
（命令/列等非 ID 数据刻意用下标 key）、`noControlCharactersInRegex`（winget/scoop 切列依赖
ANSI 控制符正则，业务必需）、`noAssignInExpressions`（`obj[k] ??= []` 惯用法）、
以及 `a11y/*`（终端 UI 非_web，不适用）。`noUnusedImports` 保持 error 级守门。
改 `biome.json` 时注意勿把这些升级回 error——否则 `bun run lint` 会被迁移期代码阻塞。

## 架构

```
src/
├── index.tsx              # 入口：createCliRenderer + createRoot(<App/>)
├── App.tsx                # 主应用：ManagerRegistry 运行时状态、useKeyboard 分发、
│                          #   overlay 栈（search/detail/confirm）、toast、表格/顶栏/底栏
├── runtime.ts             # 领域逻辑层（不依赖渲染）：ManagerRegistry、buildInstalledRows、
│                          #   buildSearchGroups(registry 去重)、previewCommands、doUpdateAll/doUninstallAll
├── focus.ts               # isTextInputFocused(renderer)：判断渲染器焦点是否在文本输入框
│                          #   （本地 state 不可信，见运行时要点）
├── i18n.ts                # t() 翻译 + 语言检测/切换
├── config.ts              # ~/.config/pkg-tui/config.json 持久化、快捷键/图标/语言 getter
├── date.ts                # formatRelativeTime 相对时间（i18n，zh/en；解析失败原样返回）
├── width.ts               # dispWidthStr 显示宽度（CJK 全角/emoji 计 2 列）
├── terminal-colors.ts     # getTerminalBackground 终端默认背景色（跟随主页背景）；getTerminalBackgroundSync 同步读缓存
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
│   ├── cargo.ts           # install --list 正则解析；outdated 逐个 info；search/info 显式走 crates.io（镜像源无搜索 API）
│   ├── choco.ts           # --limit-output 管道分隔解析；info 键值解析（0 packages found 判失败）
│   └── index.ts           # import 各后端触发注册 + 统一导出
├── components/
│   ├── PackageTable.tsx   # 自建受控表格（box+text，光标行高亮、鼠标悬浮高亮、勾选前缀、滚动窗口、columnGap 列间隔、横向滚动 scrollX）
│   ├── LoadingIndicator.tsx # 全局加载指示器（单方向扫描 + 色衰减动画，setInterval 推帧）
│   ├── ModalBackdrop.tsx  # 模态背景容器（overlay 实底盖住主页；ConfirmDialog/
│   │                      #   DetailScreen/SettingsScreen 共用，终端背景色见 terminal-colors）
│   └── ManagerStrip.tsx   # 顶栏：设置/搜索按钮 + 过滤输入 + "全部"+各管理器按钮
└── screens/
    ├── ConfirmDialog.tsx  # 确认框（命令预览 + 确定/取消）
    ├── SearchScreen.tsx   # 搜索（registry 分组并发，i 安装 / v 详情；失败来源在状态栏标注）
    ├── DetailScreen.tsx   # 包详情（后台 view，加载态，更新/删除/关闭）
    └── SettingsScreen.tsx # 设置（快捷键/图标/语言，保存回 config.json；自建列表交互
                           #   同 PackageTable，见设置界面鼠标行为段落与 settings-screen-mouse 测试）
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
| 原设置 screen（若有）| `screens/SettingsScreen.tsx`  |
| —（迁移时新增）       | `focus.ts`、`components/ModalBackdrop.tsx`（OpenTUI 无 Textual 模态/焦点原语，迁移时补） |
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
    回归测试见 `tests/focus-keys.test.tsx`（`bun test` 运行全部）。
  - **顶栏 ← → 导航到过滤框时 input 连带聚焦**（`focused={filterMode || filterFocused}`，
    用于显示光标，与原 Python 项目一致）：此时 `filterMode=false` 但渲染器焦点在 input，
    全局 `useKeyboard` 的顶栏分支必须**先于** `isTextInputFocused` 判断执行——OpenTUI
    的全局 keyHandler（`renderer.keyInput`，React `useKeyboard` 绑定处）先于聚焦的
    renderable 处理按键，对 ← → /↓ /Esc/Enter `preventDefault()` 后 input 不会吞掉
    导航键；未处理的字符键则落进 input 直接输入过滤框。
  - **`PackageTable` 用法须全局一致**：所有用到 `PackageTable` 的界面（主页已安装表格、
    搜索结果表格等）都必须保持**相同的交互行为**——鼠标滚轮上下移动光标行
    （`onScrollMove` 回写 `cursor`）、单击选中行、双击触发 `onRowDoubleClick`、
    列宽 `autoFitWidths` + `columnGap`、横向溢出时 `scrollX`。新增界面用 `PackageTable`
    时直接复用这套回调，不要省略 `onScrollMove`（否则滚轮在表格上无反应，与主页割裂）。
    这条是"整体风格一致"规范，改动 PackageTable 默认行为或任一界面的回调均需同步另一处。
  - **设置界面（`SettingsScreen`）的鼠标行为与列表滚动窗口**：设置界面的自建列表与
    `PackageTable` 交互一致——单击行 = 选中并激活（`onMouseDown` + `stopPropagation`，
    同 ConfirmDialog 按钮）、悬浮行高亮（`hover` state，光标 > 悬浮 > 透明）、滚轮在
    行区内移动光标（`onMouseScroll` + `VSCROLL_STEP=3`）。**行区盒子必须给显式
    `height`**：模态框 `maxHeight="85%"` 会让 Yoga 压缩内容，行区实际高度 ≠ 终端高
    ×85% − 固定开销（小终端下连配置路径行都会被压扁，行内容被裁掉）；显式
    `height={listRows}`（`min(rows.length, max(2, floor(h*0.85) - ROWS_OVERHEAD))`，
    `ROWS_OVERHEAD=9`：内边距2+标题1+行区上边距1+配置路径3+底栏2）后 Yoga 不再收缩
    行区，窗口与盒子严格一致。极矮终端（h≤12）下固定内容放不下，边距/配置路径被
    压扁属可接受退化。测试见 `tests/settings-screen-mouse.test.tsx`：小终端 height=10
    行区 2 行，滚动到底窗口停在 (o)/完成（(a) 放不下），点击"完成"关闭回传结果。
  - **鼠标事件测试的 stdin 解析器时序**：OpenTUI 的 StdinParser 是异步的且对连发
    事件（mockMouse 背靠背 emit）会丢失（解析器等待态 + 20ms 超时窗口依赖时钟），
    `mockMouse.scroll/click` 后不能立即断言——必须多轮 `tick() + renderOnce()`（约 10
    轮）消化，事件逐条处理；测试里每次事件后都要 pump，否则偶发丢事件导致断言失败
    （曾表现为"滚动一次后窗口不动"的假故障）。
  - **加载状态统一用 `LoadingIndicator`**：所有需要显示"加载中"的地方都应使用
    `src/components/LoadingIndicator.tsx`（单方向扫描 + 尾部色衰减动画），不要再写
    静态 `<text>加载中...</text>`。已接入：主页 `loadingHint` 空表占位、详情屏
    `state.status==="loading"`、搜索屏状态栏（搜索中）与 `PackageTable.emptyHint`（加载态）。
    动画靠 `setInterval` 推帧 + React state 重绘，卸载清计时器；`PackageTable.emptyHint`
    已放宽为 `ReactNode` 以容纳它。新增加载场景一律复用此组件，保证全局风格一致。
  - **`scrollX` 模式的空白行修复**：OpenTUI ScrollBox 在内容未横向溢出时，横向滚动条
    本应隐藏，但首布局仍为它预留 1 行（visible 切到 false 后布局未刷新），导致表格
    底部多一行空白。`PackageTable` 的 `useEffect` 在内容 `onSizeChange` 时调
    `horizontalScrollBar.resetVisibilityControl()` 重算可见性并重排，回收该预留行。
     故 `scrollX` 表格的 `visibleRows` 按"无预留"算（搜索界面用 `height - 3`，主页
     无 `scrollX` 用 `height - 4` 顶栏1+底栏1+表头1+paddingTop1）。
  - **不画竖直滚动条**：PackageTable 的纵向滚动是光标驱动的窗口（`windowStart`），
    不是 ScrollBox 平移，故不复用 ScrollBox 原生 `scrollY`，也没有自绘滚动条——
    长列表靠滚轮快速滚动（每档 `VSCROLL_STEP=3` 行，经 `onScrollMove`）与键盘。
    主页和搜索界面共用此机制。
  - **搜索"全部"并发 + 失败可见**：`SearchScreen.doSearch` 用 `Promise.allSettled` 并发
    各 registry 代表（`buildSearchGroups`：同 registry 只搜一次，npm 系用 npm；不同
    registry 如 scoop/winget 各自独立）。任一来源 search 抛错**不能静默吞掉**——要在
    状态栏用 `search.status_partial_failed`（`（部分来源搜索失败：{names}）`）标注，
    否则用户会误以为"全部"没搜某个管理器（曾误判 scoop 未被搜索）。
  - **overlay 背景跟随终端**：`SearchScreen` 等 overlay 用 `terminal-colors.ts` 的
    `getTerminalBackground` 取终端默认背景色（主页根容器透明，overlay 必须实底盖住）。
    为避免"先渲染一帧 FALLBACK 深色再切到真实背景"的闪烁，`App` 启动时即调
    `getTerminalBackground(renderer)` 预填**模块级缓存**，overlay 挂载时用
    `getTerminalBackgroundSync()` 同步读缓存初始化。新增 overlay 时同样走这套。
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
| `↑`（表格首行）/ `↓`（顶栏）        | 顶栏 ↔ 表格 切换焦点 |
| `←` `→`（顶栏聚焦时）              | 顶栏按钮间移动焦点（含设置/搜索/过滤框） |
| `enter`（顶栏聚焦时）              | 激活顶栏按钮          |
| `←` `→`（表格聚焦时）              | 切换当前管理器视图     |
| `enter`                            | 查看选中包详情       |
| `alt+s`                            | 打开设置             |
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
