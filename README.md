# pkg

[English](README.md) | [简体中文](docs/README.zh-CN.md)

A terminal TUI built on [OpenTUI](https://opentui.org) (React bindings) that manages all package managers on your machine — npm / pnpm / bun / winget / scoop / cargo / choco / uv — in one place.

![screenshot](https://files.seeusercontent.com/2026/08/02/Mth7/image-20260802091230377.png)

## Features

- List global packages installed by each package manager ("All" view aggregates every manager, labeled by source)
- Batch update / uninstall with a confirmation dialog + full command preview
- Global package search (same-registry managers are searched only once), package details, install
- Local filter box, show-updatable-only filter

## Installation

### Recommended: via Bun/npm (package is only 56KB)

```bash
bun i -g @caolib/pkg-tui && pkg      # or npm i -g @caolib/pkg-tui
# Run without installing:
bunx @caolib/pkg-tui
```

Requires [Bun](https://bun.sh).

<details>
<summary><b>Alternative: standalone executable</b> (~110MB, no runtime needed)</summary>

<p>Download the executable for your platform from <a href="https://github.com/caolib/pkg/releases">GitHub Releases</a>:</p>

<table>
<thead>
<tr><th>Platform</th><th>File</th></tr>
</thead>
<tbody>
<tr><td>Windows x64</td><td><code>pkg-tui-x86_64-pc-windows-msvc.exe</code></td></tr>
<tr><td>Linux x64</td><td><code>pkg-tui-x86_64-unknown-linux-gnu</code></td></tr>
<tr><td>macOS arm64</td><td><code>pkg-tui-aarch64-apple-darwin</code></td></tr>
</tbody>
</table>

<p>One-liner install on Windows PowerShell:</p>

<pre><code>irm https://github.com/caolib/pkg/releases/latest/download/pkg-tui-x86_64-pc-windows-msvc.exe -o ~\pkg-tui.exe</code></pre>

<p>Put <code>pkg-tui</code> in your PATH and you're done.</p>

</details>

## Run from source

```bash
bun install
bun dev          # equivalent to bun run src/index.tsx
```

Build the standalone executable: `bun run build` (outputs to `dist/`, requires Bun ≥ 1.3.14).

Type check: `bunx tsc --noEmit`

## Keybindings

`s` search · `r` refresh · `u` update · `d` uninstall · `space` toggle selection · `f` show updatable only · `enter` details · `Ctrl+C` quit

Mouse: click a table row to select, double-click for details.

See `CLAUDE.md` for development notes.
