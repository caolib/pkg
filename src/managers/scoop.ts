/**
 * scoop (Windows 命令行安装器) 后端实现。
 *
 * scoop 面向开发者工具、按用户级安装到 ~/scoop，无管理员权限要求，
 * 与 npm 系、winget 均不同源，故 registry 留 null，搜索界面单独出现。
 *
 * scoop CLI 没有统一 --json：list/search/status 输出表格，info 输出键值，
 * 但 scoop cat 能输出单个 manifest 的标准 JSON，故 view 用 cat。
 * scoop 表头为 ASCII 英文，按普通字符列定位切分即可。
 * 对应原 Python 项目的 managers/scoop.py。
 */

import { t } from "../i18n";
import type { OperationResult, PackageDetail, PackageInfo, SearchResult } from "./types";
import { isAvailableAsync, ManagerError, parseJson, runCommand } from "./_cli";
import { PackageManager, registerManager } from "./base";
import { _makeResult } from "./npm";

// ---------------------------------------------------------------------------
// 表格解析辅助（scoop 的 ASCII 列表头）
// ---------------------------------------------------------------------------

/** 去 ANSI 转义序列。 */
function _stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

// scoop 表头列名到统一 key 的映射（覆盖中英文表头）
const _COL_ALIASES: Record<string, string> = {
  name: "name",
  version: "version",
  source: "source",
  updated: "updated",
  info: "info",
  binaries: "binaries",
  installed: "installed",
  latest: "latest",
};

/** 从表头行解析各列名到其起始字符索引。 */
function _columnPositions(header: string): Record<string, number> {
  const positions: Record<string, number> = {};
  let i = 0;
  const n = header.length;
  while (i < n) {
    while (i < n && /\s/.test(header[i])) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !/\s/.test(header[i])) i++;
    const word = header.slice(start, i);
    const key = _COL_ALIASES[word.toLowerCase()];
    if (key && !(key in positions)) positions[key] = start;
  }
  return positions;
}

interface _Row {
  name?: string;
  version?: string;
  source?: string;
  info?: string;
  installed?: string;
  latest?: string;
  binaries?: string;
}

/** 按列起始字符索引切分一行数据，返回 {列key: 该列文本}。 */
function _splitRowByColumns(
  line: string,
  positions: Record<string, number>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const keys = Object.keys(positions);
  if (keys.length === 0) return result;
  const ordered = keys.map<[string, number]>((k) => [k, positions[k]]).sort((a, b) => a[1] - b[1]);
  ordered.forEach(([key, start], idx) => {
    const end = idx + 1 < ordered.length ? ordered[idx + 1][1] : line.length;
    const cell = start < line.length ? line.slice(start, end) : "";
    result[key] = cell.trim();
  });
  return result;
}

/** 解析 scoop 表格输出，返回每行为 {wanted_col_key: value}。 */
function _parseTable(stdout: string, wantedCols: string[]): _Row[] {
  const lines = _stripAnsi(stdout).split(/\r?\n/);
  let headerIdx = -1;
  let headerPositions: Record<string, number> = {};
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const stripped = line.trim();
    if (!stripped || (new Set(stripped).size === 1 && stripped[0] === "-")) continue;
    const positions = _columnPositions(line);
    if ("name" in positions) {
      headerIdx = idx;
      headerPositions = positions;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const rows: _Row[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/\s+$/, "");
    if (!stripped) continue;
    if (new Set(stripped.replace(/ /g, "")).size === 1 && stripped[0] === "-") continue;
    const cells = _splitRowByColumns(line, headerPositions);
    const row: _Row = {};
    for (const c of wantedCols) (row as any)[c] = cells[c] ?? "";
    if (!row.name) continue;
    rows.push(row);
  }
  return rows;
}

class ScoopPackageManager extends PackageManager {
  /** scoop 与 npm 系、winget 均不同源，registry 留 null。 */
  name = "scoop";
  display_name = "scoop";
  icon = "🥄";
  description = "Windows 命令行软件安装器，面向开发者工具，按用户级安装。";

  async isAvailable(): Promise<boolean> {
    return isAvailableAsync("scoop");
  }

  // ------------------------------------------------------------------
  // 查询
  // ------------------------------------------------------------------

  async listInstalled(): Promise<PackageInfo[]> {
    // scoop 按用户级安装到 ~/scoop，无"全局/局部"之分；scoop list 列出该用户所有已安装应用
    let stdout: string;
    let exitCode: number;
    try {
      ({ stdout, exitCode } = await runCommand("scoop", ["list"]));
    } catch {
      return [];
    }
    if (exitCode !== 0) return [];
    const rows = _parseTable(stdout, ["name", "version", "source", "info"]);
    const packages: PackageInfo[] = [];
    for (const row of rows) {
      // 把状态信息（如 "Install failed"）放进 description 便于用户察觉
      packages.push({
        name: row.name!,
        version: row.version ?? "",
        description: row.info ?? "",
        manager: this.name,
      });
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return packages;
  }

  /** 列出有可用更新的已安装应用。优先用 scoop status（联网比对 buckets）。
   *  status 需联网更新 buckets，失败返回空列表而非抛错。 */
  async listOutdated(): Promise<PackageInfo[]> {
    let stdout: string;
    let exitCode: number;
    try {
      ({ stdout, exitCode } = await runCommand("scoop", ["status"]));
    } catch {
      return [];
    }
    if (exitCode !== 0) {
      // status 可能因联网失败而非零退出；保守起见不展示可能不完整的更新列表
      return [];
    }
    const rows = _parseTable(stdout, ["name", "installed", "latest", "info"]);
    const packages: PackageInfo[] = [];
    for (const row of rows) {
      const latest = row.latest ?? "";
      const installed = row.installed ?? "";
      // 没有最新版本号的行（如安装失败的 ffmpeg）跳过
      if (!latest) continue;
      packages.push({
        name: row.name!,
        version: installed,
        latest_version: latest,
        manager: this.name,
      });
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return packages;
  }

  async search(query: string): Promise<SearchResult[]> {
    const { stdout } = await runCommand("scoop", ["search", query]);
    const rows = _parseTable(stdout, ["name", "version", "source", "binaries"]);
    const results: SearchResult[] = [];
    for (const row of rows) {
      results.push({
        name: row.name!,
        version: row.version ?? "",
        description: row.source ?? "",
      });
    }
    return results;
  }

  async view(packageName: string): Promise<PackageDetail> {
    // scoop cat 输出 manifest 的标准 JSON，是最可靠的详情来源
    const { stdout, exitCode } = await runCommand("scoop", ["cat", packageName]);
    if (exitCode !== 0) {
      throw new ManagerError(t("error.view_failed", { cmd: "scoop cat", package: packageName }));
    }
    const data = parseJson(stdout);
    if (!data || typeof data !== "object") {
      throw new ManagerError(
        t("error.view_not_object", { cmd: "scoop cat", package: packageName }),
      );
    }
    return ScoopPackageManager._parseManifest(data as Record<string, unknown>, packageName);
  }

  /** 从 scoop cat 的 manifest JSON 构造 PackageDetail。
   *  version 可为字符串或 {"version":"x"}；license 可为字符串或 {identifier,url}。 */
  private static _parseManifest(data: Record<string, unknown>, name: string): PackageDetail {
    const versionRaw = data.version;
    let latest: string;
    if (versionRaw && typeof versionRaw === "object") {
      latest = String((versionRaw as any).version ?? "");
    } else {
      latest = String(versionRaw ?? "");
    }

    const licenseRaw = data.license;
    let licenseStr: string;
    if (licenseRaw && typeof licenseRaw === "object") {
      licenseStr = (licenseRaw as any).identifier || (licenseRaw as any).url || "";
    } else if (Array.isArray(licenseRaw) && licenseRaw.length > 0) {
      const first = licenseRaw[0];
      licenseStr =
        first && typeof first === "object" ? ((first as any).identifier ?? "") : String(first);
    } else {
      licenseStr = String(licenseRaw ?? "");
    }

    // description 可能是字符串，也可能是多段列表
    const descRaw = data.description;
    let description: string;
    if (Array.isArray(descRaw)) {
      description = descRaw
        .map((d) => String(d))
        .join(" ")
        .trim();
    } else {
      description = String(descRaw ?? "");
    }

    return {
      name: (data.name as string) ?? name,
      latest_version: latest,
      description,
      license: licenseStr,
      homepage: (data.homepage as string) ?? "",
      raw: data,
    };
  }

  // ------------------------------------------------------------------
  // 操作
  // ------------------------------------------------------------------

  async install(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("scoop", ["install", packageName], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "install");
  }

  async update(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("scoop", ["update", packageName], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "update");
  }

  async uninstall(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("scoop", ["uninstall", packageName], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "uninstall");
  }

  installCommand(packageName: string): string {
    return `scoop install ${packageName}`;
  }

  updateCommand(packageNames: string[]): string {
    // scoop update 一次只接一个 app，多包时展示为多条命令
    return packageNames.map((n) => `scoop update ${n}`).join(" && ");
  }

  uninstallCommand(packageNames: string[]): string {
    // scoop uninstall 同理一次只接一个 app
    return packageNames.map((n) => `scoop uninstall ${n}`).join(" && ");
  }
}

registerManager(ScoopPackageManager);
