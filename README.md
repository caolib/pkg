# pkg

基于 [OpenTUI](https://opentui.org)（React 绑定）的终端 TUI，统一管理本机各种包管理器
（npm / pnpm / bun / winget / scoop / cargo）。从原 Textual/Python 项目迁移而来（见 `old/`）。

## 功能

- 列出各包管理器已安装的全局包（"全部"视图聚合，标注来源管理器）
- 批量勾选更新 / 卸载（带确认框 + 命令预览）
- 全局搜索包（同 registry 只搜一次）、查看详情、安装
- 本地过滤框、仅显示可更新

## 运行

```bash
bun install
bun dev          # 或 bun run src/index.tsx
```

类型检查：`bunx tsc --noEmit`

## 快捷键

`s` 搜索 · `r` 刷新 · `u` 更新 · `d` 卸载 · `space` 勾选 · `f` 仅显示可更新 · `enter` 详情 · `Ctrl+C` 退出

鼠标：单击表格行选中，双击查看详情。

详见 `CLAUDE.md`。
