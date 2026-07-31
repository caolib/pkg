/**
 * bun 包管理器后端实现。
 *
 * bun 的 CLI 对 JSON 支持有限：bun pm ls -g 输出纯文本需正则解析；
 * 没有内置 outdated / search。由于 bun 用与 npm 相同的 registry，
 * search / view 通过直接调 npm 实现；outdated 通过逐个 view 对比版本。
 * 对应原 Python 项目的 managers/bun.py。
 */

import { t } from "../i18n"
import type {
  OperationResult,
  PackageDetail,
  PackageInfo,
  SearchResult,
} from "./types"
import { isAvailableAsync, ManagerError, parseJson, runCommand } from "./_cli"
import { PackageManager, registerManager } from "./base"
import { _makeResult, _parsePackageDetail, _parseSearchResults } from "./npm"

// bun pm ls -g 输出形如:
//   C:\path\to\global\node_modules (13)
//   └── pkg-name@1.2.3
//   ├── pkg-a@1.0.0
//   └── pkg-b@2.0.0
const _BUN_PKG_LINE = /^[├└]──\s+(.+?)@(.+)$/

class BunPackageManager extends PackageManager {
  name = "bun"
  display_name = "bun"
  description = "快速、全能的 JavaScript 运行时和包管理器。"
  icon = "🥟"
  registry = "npm"

  async isAvailable(): Promise<boolean> {
    return isAvailableAsync("bun")
  }

  async listInstalled(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("bun", ["pm", "ls", "-g"])
    const packages: PackageInfo[] = []
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim()
      const m = line.match(_BUN_PKG_LINE)
      if (m) {
        const name = m[1].trim()
        const version = m[2].trim()
        packages.push({ name, version, manager: this.name })
      }
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    return packages
  }

  /** bun 无内置 outdated 命令，通过逐个 view 已安装包来对比。 */
  async listOutdated(): Promise<PackageInfo[]> {
    const installed = await this.listInstalled()
    if (installed.length === 0) return []
    const outdated: PackageInfo[] = []
    for (const pkg of installed) {
      try {
        const detail = await this.view(pkg.name)
        const latest = detail.latest_version
        if (latest && latest !== pkg.version) {
          outdated.push({
            name: pkg.name,
            version: pkg.version,
            latest_version: latest,
            manager: this.name,
          })
        }
      } catch {
        continue
      }
    }
    outdated.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    return outdated
  }

  async search(query: string): Promise<SearchResult[]> {
    // bun 共享 npm registry，直接复用 npm search
    const { stdout } = await runCommand("npm", ["search", query, "--json"])
    const data = parseJson(stdout)
    if (!Array.isArray(data)) return []
    return _parseSearchResults(data)
  }

  async view(packageName: string): Promise<PackageDetail> {
    // bun 共享 npm registry，直接复用 npm view
    const { stdout, exitCode } = await runCommand("npm", [
      "view",
      packageName,
      "--json",
    ])
    if (exitCode !== 0) {
      throw new ManagerError(t("error.view_failed", { cmd: "view", package: packageName }))
    }
    const data = parseJson(stdout)
    if (!data || typeof data !== "object") {
      throw new ManagerError(t("error.view_not_object", { cmd: "view", package: packageName }))
    }
    return _parsePackageDetail(data, packageName)
  }

  async install(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("bun", [
      "add",
      "-g",
      packageName,
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "install")
  }

  async update(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("bun", [
      "update",
      "-g",
      packageName,
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "update")
  }

  async uninstall(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("bun", [
      "remove",
      "-g",
      packageName,
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "uninstall")
  }

  updateCommand(packageNames: string[]): string {
    return `bun update -g ${packageNames.join(" ")}`
  }

  uninstallCommand(packageNames: string[]): string {
    return `bun remove -g ${packageNames.join(" ")}`
  }
}

registerManager(BunPackageManager)
