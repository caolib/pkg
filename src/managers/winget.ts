/**
 * winget (Windows Package Manager) 后端实现。
 *
 * winget CLI 没有 --json 输出，所有命令输出表格，需手动解析。
 * 用"按表头列名定位列起始显示列、再按显示宽度切分数据行"的通用解析器
 * 处理 list/upgrade/search 的表格输出。winget 中文表头全角字符每字占 2 列，
 * 故按显示列（而非字符索引）定位。
 *
 * 与 npm/pnpm/bun 不同，winget 使用独立 registry（registry 留 null），
 * 搜索界面作为独立源单独搜索。包标识用 PackageIdentifier。
 * 对应原 Python 项目的 managers/winget.py。
 */

import { t } from "../i18n";
import { dispWidthChar, sliceByDisp } from "../width";
import type { OperationResult, PackageDetail, PackageInfo, SearchResult } from "./types";
import { isAvailableAsync, ManagerError, runCommand } from "./_cli";
import { PackageManager, registerManager } from "./base";

// 安装/升级/卸载时统一附加的免交互参数
const _ACCEPT_ARGS = [
  "--accept-package-agreements",
  "--accept-source-agreements",
  "--disable-interactivity",
];

// ---------------------------------------------------------------------------
// 显示宽度辅助（中文/全角=2，其余=1），共享实现见 ../width.ts
// ---------------------------------------------------------------------------

function _dispWidthStr(s: string): number {
  let sum = 0;
  for (const ch of s) sum += dispWidthChar(ch);
  return sum;
}

/** 表头列名候选：winget 中英文表头 → 统一 key。 */
const _HEADER_ALIASES: Record<string, string> = {
  名称: "name",
  Name: "name",
  Id: "id",
  ID: "id",
  版本: "version",
  Version: "version",
  可用: "available",
  Available: "available",
  源: "source",
  Source: "source",
  Match: "match",
  匹配: "match",
};

/** 从表头行解析各列名到其起始显示列索引。 */
function _columnPositions(header: string): Record<string, number> {
  const positions: Record<string, number> = {};
  const tokens: Array<[string, number]> = [];
  const chars = [...header];
  let i = 0;
  let col = 0;
  const n = chars.length;
  while (i < n) {
    while (i < n && /\s/.test(chars[i])) {
      i++;
      col++;
    }
    if (i >= n) break;
    const start = col;
    let j = i;
    while (j < n && !/\s/.test(chars[j])) {
      col += dispWidthChar(chars[j]);
      j++;
    }
    const word = chars.slice(i, j).join("");
    tokens.push([word, start]);
    i = j;
  }
  // 精确匹配优先，再处理粘连前缀
  for (const [word, start] of tokens) {
    if (word in _HEADER_ALIASES) {
      const key = _HEADER_ALIASES[word];
      if (!(key in positions)) positions[key] = start;
    } else {
      for (const [alias, key] of Object.entries(_HEADER_ALIASES)) {
        if (word.startsWith(alias) && !(key in positions)) {
          positions[key] = start;
        }
      }
    }
  }
  return positions;
}

/** 按列起始显示列切分一行数据，返回 {列key: 该列文本}。 */
function _splitRowByColumns(
  line: string,
  positions: Record<string, number>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const keys = Object.keys(positions);
  if (keys.length === 0) return result;
  const ordered = keys.map<[string, number]>((k) => [k, positions[k]]).sort((a, b) => a[1] - b[1]);
  const lineDisp = _dispWidthStr(line);
  ordered.forEach(([key, start], idx) => {
    const end = idx + 1 < ordered.length ? ordered[idx + 1][1] : lineDisp;
    if (start >= lineDisp) {
      result[key] = "";
      return;
    }
    result[key] = sliceByDisp(line, start, end).trim();
  });
  return result;
}

/** 去除 ANSI 转义序列（彩色/光标控制）。 */
function _stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

interface _Row {
  id?: string;
  name?: string;
  version?: string;
  available?: string;
  source?: string;
  installed?: string;
  latest?: string;
  info?: string;
}

/** 按 id 去重，保留信息最完整的一行。 */
function _dedupRowsById(rows: _Row[]): _Row[] {
  const best = new Map<string, _Row>();
  const score = (row: _Row): [number, number] => {
    const av = row.available ?? "";
    const vr = row.version ?? "";
    return [av ? 1 : 0, vr && vr.toLowerCase() !== "unknown" ? 1 : 0];
  };
  for (const row of rows) {
    const pid = row.id ?? "";
    if (!pid) continue;
    const prev = best.get(pid);
    if (prev === undefined) {
      best.set(pid, row);
    } else {
      const a = score(row);
      const b = score(prev);
      if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) best.set(pid, row);
    }
  }
  return [...best.values()];
}

/** 解析 winget 表格输出，返回每行为 {wanted_col_key: value}。 */
function _parseTable(stdout: string, wantedCols: string[]): _Row[] {
  const lines = _stripAnsi(stdout).split(/\r?\n/);
  // 找表头行：能识别出 id 列的行
  let headerIdx = -1;
  let headerPositions: Record<string, number> = {};
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const stripped = line.trim();
    if (!stripped || (new Set(stripped).size === 1 && stripped[0] === "-")) continue;
    const positions = _columnPositions(line);
    if ("id" in positions) {
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
    if (!row.id) continue;
    rows.push(row);
  }
  return rows;
}

class WingetPackageManager extends PackageManager {
  /** winget 管理的是 Windows 桌面软件，与 Node.js 系不同源，registry 留 null。 */
  name = "winget";
  display_name = "winget (Windows)";
  icon = "⊞";
  description = "Windows 官方包管理器，管理桌面软件的安装与升级。";

  async isAvailable(): Promise<boolean> {
    return isAvailableAsync("winget");
  }

  // ------------------------------------------------------------------
  // 查询
  // ------------------------------------------------------------------

  async listInstalled(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("winget", [
      "list",
      "--accept-source-agreements",
      "--disable-interactivity",
    ]);
    const rows = _dedupRowsById(_parseTable(stdout, ["id", "name", "version", "available"]));
    const packages: PackageInfo[] = [];
    for (const row of rows) {
      let version = row.version ?? "";
      // winget 对未知版本显示 "Unknown"，统一记为空串便于展示
      if (version.toLowerCase() === "unknown") version = "";
      packages.push({
        name: row.id!,
        // winget 的"名称"列仅供展示，操作标识仍用 PackageIdentifier(name=id)
        display_name: row.name ?? "",
        version,
        latest_version: row.available || null,
        manager: this.name,
      });
    }
    packages.sort((a, b) =>
      (a.display_name || a.name)
        .toLowerCase()
        .localeCompare((b.display_name || b.name).toLowerCase()),
    );
    return packages;
  }

  async listOutdated(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("winget", [
      "upgrade",
      "--accept-source-agreements",
      "--disable-interactivity",
    ]);
    const rows = _dedupRowsById(
      _parseTable(stdout, ["id", "name", "version", "available", "source"]),
    );
    const packages: PackageInfo[] = [];
    for (const row of rows) {
      let current = row.version ?? "";
      const latest = row.available ?? "";
      // 没有可用版本号的行跳过（winget upgrade 表格末尾常有汇总行）
      if (!latest) continue;
      if (current.toLowerCase() === "unknown") current = "";
      packages.push({
        name: row.id!,
        display_name: row.name ?? "",
        version: current,
        latest_version: latest,
        manager: this.name,
      });
    }
    packages.sort((a, b) =>
      (a.display_name || a.name)
        .toLowerCase()
        .localeCompare((b.display_name || b.name).toLowerCase()),
    );
    return packages;
  }

  async search(query: string): Promise<SearchResult[]> {
    const { stdout } = await runCommand("winget", [
      "search",
      query,
      "--accept-source-agreements",
      "--disable-interactivity",
    ]);
    const rows = _parseTable(stdout, ["id", "name", "version", "source"]);
    const results: SearchResult[] = [];
    for (const row of rows) {
      results.push({
        name: row.id!,
        display_name: row.name ?? "",
        version: row.version ?? "",
        license: row.source ?? "",
      });
    }
    return results;
  }

  async view(packageName: string): Promise<PackageDetail> {
    // winget show 输出为 "key: value" 行形式，非表格，逐行解析
    const { stdout, exitCode } = await runCommand("winget", [
      "show",
      packageName,
      "-e",
      "--accept-source-agreements",
      "--disable-interactivity",
    ]);
    if (exitCode !== 0) {
      throw new ManagerError(t("error.view_failed", { cmd: "winget show", package: packageName }));
    }
    const fields = WingetPackageManager._parseShowOutput(stdout);
    // winget show 首行形如 "已找到 Bandizip [Bandisoft.Bandizip]"
    const [dispName, pkgId] = WingetPackageManager._extractHeader(stdout);
    const finalId = pkgId || fields.id || packageName;
    return {
      name: finalId,
      display_name: dispName || fields.name || "",
      latest_version: fields.version || "",
      description: fields.description || "",
      license: fields.license || "",
      homepage: fields.homepage || "",
      // winget 无作者概念，用 Publisher 充当 author 展示
      author: fields.publisher || "",
      raw: fields,
    };
  }

  /** 从 winget show 首行 "已找到 <显示名> [<id>]" 提取显示名与 id。 */
  private static _extractHeader(stdout: string): [string, string] {
    const _FOUND_PREFIXES = ["已找到", "Found", "Trouvé", "Gefunden", "Encontrado"];
    for (const line of _stripAnsi(stdout).split(/\r?\n/)) {
      const lb = line.indexOf("[");
      const rb = line.lastIndexOf("]");
      if (0 <= lb && lb < rb) {
        const pkgId = line.slice(lb + 1, rb).trim();
        if (!pkgId || pkgId.includes(" ")) continue;
        let display = line.slice(0, lb).trim();
        for (const prefix of _FOUND_PREFIXES) {
          if (display.startsWith(prefix)) {
            display = display.slice(prefix.length).trim();
            break;
          }
        }
        return [display, pkgId];
      }
    }
    return ["", ""];
  }

  /** 解析 winget show 的 "键: 值" 行输出为字典。
   *  值可能跨多行（延续缩进），合并到上一键。 */
  private static _parseShowOutput(stdout: string): Record<string, string> {
    const aliases: Record<string, string> = {
      publisher: "publisher",
      发布者: "publisher",
      version: "version",
      版本: "version",
      description: "description",
      描述: "description",
      homepage: "homepage",
      主页: "homepage",
      license: "license",
      许可证: "license",
      "package identifier": "id",
      包标识符: "id",
      id: "id",
      name: "name",
      名称: "name",
      author: "author",
      作者: "author",
    };
    const fields: Record<string, string> = {};
    let currentKey: string | null = null;
    for (const rawLine of _stripAnsi(stdout).split(/\r?\n/)) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line.trim()) {
        currentKey = null;
        continue;
      }
      if (line.includes(":")) {
        const [left, , right] = partition(line, ":");
        const keyRaw = left.trim().toLowerCase();
        const key = aliases[keyRaw];
        if (key) {
          currentKey = key;
          const value = right.trim();
          if (value) fields[key] = value;
          continue;
        }
      }
      // 无冒号或键未识别：若属于上一个键的延续行（缩进），追加
      if (currentKey && rawLine.startsWith(" ")) {
        fields[currentKey] = `${fields[currentKey] ?? ""} ${line.trim()}`.trim();
      } else {
        currentKey = null;
      }
    }
    return fields;
  }

  // ------------------------------------------------------------------
  // 操作
  // ------------------------------------------------------------------

  async install(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand(
      "winget",
      ["install", packageName, "-e", ..._ACCEPT_ARGS],
      { log: true },
    );
    return _makeResult(stdout, stderr, exitCode, packageName, "install");
  }

  async update(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand(
      "winget",
      ["upgrade", packageName, "-e", ..._ACCEPT_ARGS],
      { log: true },
    );
    return _makeResult(stdout, stderr, exitCode, packageName, "update");
  }

  async uninstall(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand(
      "winget",
      ["uninstall", packageName, "-e", "--purge", ..._ACCEPT_ARGS],
      { log: true },
    );
    return _makeResult(stdout, stderr, exitCode, packageName, "uninstall");
  }

  installCommand(packageName: string): string {
    return `winget install ${packageName} -e --accept-package-agreements --accept-source-agreements`;
  }

  updateCommand(packageNames: string[]): string {
    // winget 升级一次只接一个 id；多包时展示为多条命令
    return packageNames
      .map((n) => `winget upgrade ${n} -e --accept-package-agreements --accept-source-agreements`)
      .join(" && ");
  }

  uninstallCommand(packageNames: string[]): string {
    return packageNames
      .map((n) => `winget uninstall ${n} -e --purge --accept-package-agreements`)
      .join(" && ");
  }
}

registerManager(WingetPackageManager);

/** 以首个分隔符 splitting，返回 [left, sep, right]。 */
function partition(s: string, sep: string): [string, string, string] {
  const idx = s.indexOf(sep);
  if (idx < 0) return [s, "", ""];
  return [s.slice(0, idx), sep, s.slice(idx + sep.length)];
}

/** winget 本地操作结果构造（stdout/stderr 文本，rc，包名，操作类型）。 */
function _makeResult(
  stdout: string,
  stderr: string,
  exitCode: number,
  pkg: string,
  operation: "install" | "update" | "uninstall",
): OperationResult {
  let message = stdout.trim() || stderr.trim();
  const success = exitCode === 0;
  if (success) {
    message = message || t(`result.${operation}_ok`, { package: pkg });
  } else if (!message) {
    message = t(`result.${operation}_failed`, { package: pkg });
  }
  return { success, message, package: pkg };
}
