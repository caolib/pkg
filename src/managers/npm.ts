/**
 * npm 包管理器后端实现。
 *
 * 通过调用 npm CLI 并解析其 JSON 输出来实现 PackageManager 接口。
 * 对应原 Python 项目的 managers/npm.py。
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

class NpmPackageManager extends PackageManager {
  name = "npm"
  display_name = "npm (Node.js)"
  icon = "⬢"
  description = "Node.js 包管理器，用于管理全局安装的 JavaScript 包。"
  registry = "npm"

  async isAvailable(): Promise<boolean> {
    return isAvailableAsync("npm")
  }

  async listInstalled(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("npm", [
      "list",
      "-g",
      "--depth=0",
      "--json",
    ])
    const data = parseJson(stdout)
    const deps: Record<string, any> = data?.dependencies ?? {}
    const packages: PackageInfo[] = []
    for (const [name, info] of Object.entries(deps)) {
      if (!info || typeof info !== "object") continue
      const version = (info as any).version ?? ""
      if (version === "invalid" || version === "missing" || version === "extraneous") continue
      packages.push({
        name,
        version,
        description: (info as any).description ?? "",
        manager: this.name,
      })
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    return packages
  }

  async listOutdated(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("npm", ["outdated", "-g", "--json"])
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
        location: (info as any).location ?? "",
        manager: this.name,
      })
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    return packages
  }

  async search(query: string): Promise<SearchResult[]> {
    const { stdout } = await runCommand("npm", ["search", query, "--json"])
    const data = parseJson(stdout)
    if (!Array.isArray(data)) return []
    return _parseSearchResults(data)
  }

  async view(packageName: string): Promise<PackageDetail> {
    const { stdout, exitCode } = await runCommand("npm", [
      "view",
      packageName,
      "--json",
    ])
    if (exitCode !== 0) {
      throw new ManagerError(t("error.view_failed", { cmd: "npm view", package: packageName }))
    }
    const data = parseJson(stdout)
    if (!data || typeof data !== "object") {
      throw new ManagerError(t("error.view_not_object", { cmd: "npm view", package: packageName }))
    }
    return _parsePackageDetail(data, packageName)
  }

  async install(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("npm", [
      "install",
      "-g",
      packageName,
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "install")
  }

  async update(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("npm", [
      "install",
      "-g",
      packageName + "@latest",
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "update")
  }

  async updateAll(packageNames: string[]): Promise<OperationResult[]> {
    if (packageNames.length === 0) return []
    const specs = packageNames.map((n) => `${n}@latest`)
    const { stdout, stderr, exitCode } = await runCommand("npm", [
      "install",
      "-g",
      ...specs,
    ])
    const message = stdout.trim() || stderr.trim()
    const success = exitCode === 0
    return packageNames.map((name) => ({ success, message, package: name }))
  }

  async uninstall(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("npm", [
      "uninstall",
      "-g",
      packageName,
    ])
    return _makeResult(stdout, stderr, exitCode, packageName, "uninstall")
  }

  updateCommand(packageNames: string[]): string {
    const specs = packageNames.map((n) => `${n}@latest`).join(" ")
    return `npm install -g ${specs}`
  }

  uninstallCommand(packageNames: string[]): string {
    return `npm uninstall -g ${packageNames.join(" ")}`
  }
}

registerManager(NpmPackageManager)

// ---------------------------------------------------------------------------
// npm / pnpm / bun 共享的解析函数
// ---------------------------------------------------------------------------

/** 解析 npm/pnpm search 返回的数组为 SearchResult[]。 */
export function _parseSearchResults(items: any[]): SearchResult[] {
  const results: SearchResult[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    results.push({
      name: item.name ?? "",
      version: item.version ?? "",
      description: item.description ?? "",
      date: item.date ?? "",
      keywords: Array.isArray(item.keywords) ? item.keywords : [],
      license: item.license ?? "",
    })
  }
  return results
}

/** 解析 npm/pnpm 的 view/info JSON 为 PackageDetail。 */
export function _parsePackageDetail(data: any, name: string): PackageDetail {
  let dist_tags: Record<string, string> = {}
  if (data["dist-tags"] && typeof data["dist-tags"] === "object") {
    dist_tags = {}
    for (const [k, v] of Object.entries(data["dist-tags"])) dist_tags[k] = String(v)
  }
  const latest = dist_tags["latest"] ?? ""

  const authorRaw = data.author
  let author: string
  if (authorRaw && typeof authorRaw === "object") {
    author = (authorRaw as any).name ?? ""
  } else {
    author = String(authorRaw ?? "")
  }

  const repoRaw = data.repository
  let repository: string
  if (repoRaw && typeof repoRaw === "object") {
    repository = (repoRaw as any).url ?? ""
  } else if (typeof repoRaw === "string") {
    repository = repoRaw
  } else {
    repository = ""
  }

  const versionsRaw = data.versions
  let versions: string[]
  if (Array.isArray(versionsRaw)) {
    versions = versionsRaw.map(String)
  } else if (versionsRaw && typeof versionsRaw === "object") {
    versions = Object.keys(versionsRaw)
  } else {
    versions = []
  }

  const timeRaw = data.time
  const time: Record<string, string> =
    timeRaw && typeof timeRaw === "object"
      ? Object.fromEntries(Object.entries(timeRaw).map(([k, v]) => [k, String(v)]))
      : {}

  const maintainersRaw: any[] = Array.isArray(data.maintainers) ? data.maintainers : []
  const maintainers = maintainersRaw.map((m) =>
    m && typeof m === "object" && "username" in m ? m.username : String(m),
  )

  return {
    name: data.name ?? name,
    latest_version: latest,
    description: data.description ?? "",
    license: data.license ?? "",
    homepage: data.homepage ?? "",
    repository,
    author,
    maintainers,
    dist_tags,
    versions,
    time,
    raw: data,
  }
}

/** 构造操作结果，operation 为 install/update/uninstall。 */
export function _makeResult(
  stdout: string,
  stderr: string,
  exitCode: number,
  pkg: string,
  operation: "install" | "update" | "uninstall",
): OperationResult {
  let message = stdout.trim() || stderr.trim()
  const success = exitCode === 0
  if (success) {
    message = message || t(`result.${operation}_ok`, { package: pkg })
  } else if (!message) {
    message = t(`result.${operation}_failed`, { package: pkg })
  }
  return { success, message, package: pkg }
}
