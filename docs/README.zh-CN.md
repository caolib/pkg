# pkg

[English](../README.md) | [简体中文](README.zh-CN.md)

基于 [OpenTUI](https://opentui.org)（React 绑定）的终端 TUI，统一管理本机各种包管理器
（npm / pnpm / bun / winget / scoop / cargo / choco / uv）。

![截图](https://files.seeusercontent.com/2026/08/02/Mth7/image-20260802091230377.png)

## 功能

- 列出各包管理器已安装的全局包（"全部"视图聚合，标注来源管理器）
- 批量勾选更新 / 卸载（带确认框 + 命令预览）
- 全局搜索包（同 registry 只搜一次）、查看详情、安装
- 本地过滤框、仅显示可更新

## 安装（正式版）

### 推荐：通过 Bun/npm（包仅 56KB）

```bash
bun i -g @caolib/pkg-tui && pkg      # 或 npm i -g @caolib/pkg-tui
# 不想安装直接跑：
bunx @caolib/pkg-tui
```

需要已安装 [Bun](https://bun.sh)。

<details>
<summary><b>备选：单文件可执行程序</b>（约 110MB，无需任何运行时）</summary>

<p>到 <a href="https://github.com/caolib/pkg/releases">GitHub Releases</a> 下载对应平台的可执行文件：</p>

<table>
<thead>
<tr><th>平台</th><th>文件</th></tr>
</thead>
<tbody>
<tr><td>Windows x64</td><td><code>pkg-tui-x86_64-pc-windows-msvc.exe</code></td></tr>
<tr><td>Linux x64</td><td><code>pkg-tui-x86_64-unknown-linux-gnu</code></td></tr>
<tr><td>macOS arm64</td><td><code>pkg-tui-aarch64-apple-darwin</code></td></tr>
</tbody>
</table>

<p>Windows PowerShell 一键安装：</p>

<pre><code>irm https://github.com/caolib/pkg/releases/latest/download/pkg-tui-x86_64-pc-windows-msvc.exe -o ~\pkg-tui.exe</code></pre>

<p>下载后把 <code>pkg-tui</code> 加入 PATH 即可直接运行。</p>

</details>

## 从源码运行

```bash
bun install
bun dev          # 即 bun run src/index.tsx
```

构建单文件可执行程序：`bun run build`（输出到 `dist/`，要求 Bun ≥ 1.3.14）。

类型检查：`bunx tsc --noEmit`

## 快捷键

`s` 搜索 · `r` 刷新 · `u` 更新 · `d` 卸载 · `space` 勾选 · `f` 仅显示可更新 · `enter` 详情 · `Ctrl+C` 退出

鼠标：单击表格行选中，双击查看详情。

## 开发

详见根目录 `CLAUDE.md`（中文开发文档，面向 AI 编码代理与开发者）。
