/**
 * pnpm 包管理器后端实现。
 *
 * pnpm 与 npm 共享 npm registry，因此 search / view / outdated 的输出格式
 * 与 npm 基本一致，直接复用 npm 模块中的解析函数。
 * 主要差异：pnpm list -g --json 返回数组而非对象。
 * 对应原 Python 项目的 managers/pnpm.py。
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

class PnpmPackageManager extends PackageManager {
  name = "pnpm"
  display_name = "pnpm (Performant npm)"
  description = "快速、磁盘高效的 Node.js 包管理器。"
  icon = "●"
  registry = "npm"

  async isAvailable(): Promise<boolean> {
    return isAvailableAsync("pnpm")
  }

  async listInstalled(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("pnpm", [
      "list",
      "-g",
      "--json",
      "--depth",
      "0",
    ])
    const data = parseJson(stdout)
    // pnpm list -g --json 返回一个数组，取第一个元素的 dependencies
    let deps: Record<string, any>
    if (Array.isArray(data) && data.length > 0) {
      deps = data[0]?.dependencies ?? {}
    } else if (data && typeof data === "object") {
      deps = data.dependencies ?? {}
    } else {
      deps = {}
    }

    const packages: PackageInfo[] = []
    for (const [name, info] of Object.entries(deps)) {
      if (!info || typeof info !== "object") continue
      const version = (info as any).version ?? ""
      if (version === "invalid" || version === "missing" || version === "extraneous") continue
      packages.push({
        name,
        version,
        location: (info as any).path ?? "",
        manager: this.name,
      })
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    return packages
  }

  async listOutdated(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("pnpm", ["outdated", "-g", "--json"])
    const data = parseJson(stdout)
    const packages: PackageInfo[] = []
    if (!data || typeof data !== "object") return packages
    for (const [name, info] of Object.entries(data)) {
      if (!info || typeof info !== "object") continue
      packages.push({
        name,
        version: (info as any).current ?? "",
        latest_version: (info as any).latest ?? null,
        wanted_version: (info as any).wanted ?? null,
        manager: this.name,
      })
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    return packages
  }

  async search(query: string): Promise<SearchResult[]> {
    const { stdout } = await runCommand("pnpm", ["search", query, "--json"])
    const data = parseJson(stdout)
    if (!Array.isArray(data)) return []
    return _parseSearchResults(data)
  }

  async view(packageName: string): Promise<PackageDetail> {
    const { stdout, exitCode } = await runCommand("pnpm", [
      "info",
      packageName,
      "--json",
    ])
    if (exitCode !== 0) {
      throw new ManagerError(t("error.view_failed", { cmd: "pnpm info", package: packageName }))
    }
    const data = parseJson(stdout)
    if (!data || typeof data !== "object") {
      throw new ManagerError(t("error.view_not_object", { cmd: "pnpm info", package: packageName }))
    }
    return _parsePackageDetail(data, packageName)
  }

  async install(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("pnpm", [
      "add",
      "-g",
      packageName,
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "install")
  }

  async update(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("pnpm", [
      "add",
      "-g",
      packageName + "@latest",
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "update")
  }

  async updateAll(packageNames: string[]): Promise<OperationResult[]> {
    if (packageNames.length === 0) return []
    const specs = packageNames.map((n) => `${n}@latest`)
    const { stdout, stderr, exitCode } = await runCommand("pnpm", [
      "add",
      "-g",
      ...specs,
    ])
    const message = stdout.trim() || stderr.trim()
    const success = exitCode === 0
    return packageNames.map((name) => ({ success, message, package: name }))
  }

  async uninstall(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("pnpm", [
      "remove",
      "-g",
      packageName,
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "uninstall")
  }

  updateCommand(packageNames: string[]): string {
    const specs = packageNames.map((n) => `${n}@latest`).join(" ")
    return `pnpm add -g ${specs}`
  }

  uninstallCommand(packageNames: string[]): string {
    return `pnpm remove -g ${packageNames.join(" ")}`
  }
}

registerManager(PnpmPackageManager)
