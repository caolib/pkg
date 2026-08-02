/**
 * uv (Python) 包管理器后端实现。
 *
 * 管理 `uv tool install` 安装的全局 CLI 工具（相当于 pipx）。
 *
 * uv CLI 没有 search / info / outdated 子命令（官方多年未提供；PyPI 的搜索
 * API 也全部不可用），故：
 *   - search 返回空列表、view 抛错明确提示不支持
 *   - listOutdated 逐个用 `uv pip install --dry-run --system --no-deps <name>`
 *     解析最新版本（同 bun 的逐个 view 方案；--no-deps 只解析顶层包）。
 *     注意该命令的 `+ name==version` 结果行在 **stderr** 上。
 * 安装/升级/卸载走 `uv tool` 子命令。
 */

import { t } from "../i18n";
import type { OperationResult, PackageDetail, PackageInfo, SearchResult } from "./types";
import { isAvailableAsync, ManagerError, runCommand } from "./_cli";
import { PackageManager, registerManager } from "./base";
import { _makeResult } from "./npm";

// uv tool list 输出形如:
//   markitdown v0.1.5
//   - markitdown
const _TOOL_LINE = /^(\S+)\s+v([^\s]+)$/;

// uv pip install --dry-run 结果行（在 stderr）: ` + markitdown==0.1.7`
const _RESOLVED_LINE = /^\s*[+-]\s+([\w.-]+)==([^\s]+)$/;

/** 解析 dry-run 输出中顶层包的最新版本。 */
function _parseResolved(text: string, name: string): string {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(_RESOLVED_LINE);
    if (m && m[1] === name) return m[2];
  }
  return "";
}

class UvPackageManager extends PackageManager {
  /** uv 用 PyPI，与其它管理器不同源，registry 留 null。 */
  name = "uv";
  display_name = "uv (Python)";
  icon = "🐍";
  description = "Python 包管理器（Astral），管理全局安装的 CLI 工具。";

  async isAvailable(): Promise<boolean> {
    return isAvailableAsync("uv");
  }

  async listInstalled(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("uv", ["tool", "list"]);
    const packages: PackageInfo[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(_TOOL_LINE);
      if (m) {
        packages.push({ name: m[1], version: m[2], manager: this.name });
      }
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return packages;
  }

  /** uv 无 outdated 命令，逐个 dry-run 解析最新版本对比。 */
  async listOutdated(): Promise<PackageInfo[]> {
    const installed = await this.listInstalled();
    if (installed.length === 0) return [];
    const outdated: PackageInfo[] = [];
    for (const pkg of installed) {
      try {
        // 结果行在 stderr，故解析 stderr
        const { stderr } = await runCommand("uv", [
          "pip",
          "install",
          "--dry-run",
          "--system",
          "--no-deps",
          pkg.name,
        ]);
        const latest = _parseResolved(stderr, pkg.name);
        if (latest && latest !== pkg.version) {
          outdated.push({
            name: pkg.name,
            version: pkg.version,
            latest_version: latest,
            manager: this.name,
          });
        }
      } catch {
        // dry-run 解析失败（网络/无系统 Python 等）跳过该包
      }
    }
    outdated.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return outdated;
  }

  /** uv 无 search 子命令，不支持搜索。 */
  async search(_query: string): Promise<SearchResult[]> {
    return [];
  }

  /** uv 无 info 子命令，不支持查看详情。 */
  async view(_packageName: string): Promise<PackageDetail> {
    throw new ManagerError(t("error.view_unsupported", { manager: "uv" }));
  }

  async install(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("uv", ["tool", "install", packageName], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "install");
  }

  async update(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("uv", ["tool", "upgrade", packageName], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "update");
  }

  async uninstall(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand(
      "uv",
      ["tool", "uninstall", packageName],
      { log: true },
    );
    return _makeResult(stdout, stderr, exitCode, packageName, "uninstall");
  }

  installCommand(packageName: string): string {
    return `uv tool install ${packageName}`;
  }

  updateCommand(packageNames: string[]): string {
    return `uv tool upgrade ${packageNames.join(" ")}`;
  }

  uninstallCommand(packageNames: string[]): string {
    return `uv tool uninstall ${packageNames.join(" ")}`;
  }
}

registerManager(UvPackageManager);
