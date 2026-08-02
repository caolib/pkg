/**
 * cargo (Rust) 包管理器后端实现。
 *
 * cargo install --list 输出纯文本（`name vX.Y.Z:` + 缩进二进制行），正则解析；
 * cargo 没有内置 outdated 命令，通过逐个 cargo info 对比版本实现（同 bun 的
 * 逐个 view 方案）。
 *
 * search / info 需要 registry 的搜索 API。若用户用镜像源（如清华 sparse
 * index）经 `replace-with` 替换了 crates-io，镜像只有索引没有搜索 API，
 * cargo search/info 会直接报错，故这两处显式传 `--registry crates-io`。
 * 这只影响只读查询；install/update/uninstall 不传，继续走用户配置的镜像源。
 */

import { t } from "../i18n";
import type { OperationResult, PackageDetail, PackageInfo, SearchResult } from "./types";
import { isAvailableAsync, ManagerError, runCommand } from "./_cli";
import { PackageManager, registerManager } from "./base";
import { _makeResult } from "./npm";

/** 只读查询（search/info）强制走 crates.io，绕开无搜索 API 的镜像源。 */
const _CRATES_IO = ["--registry", "crates-io", "--color", "never"];

// cargo install --list 输出形如:
//   cargo-sweep v0.8.0:
//       cargo-sweep.exe
const _INSTALLED_LINE = /^([\w.-]+)\s+v([^\s:]+):/;

// cargo search 单行格式:  serde = "1.0.229"    # A generic serialization...
const _SEARCH_LINE = /^([\w.-]+)\s*=\s*"([^"]+)"(?:\s+#\s*(.*))?$/;

// cargo info 键值行: version: 0.10.0
const _INFO_KV = /^([a-z][a-z-]*):\s*(.+)$/;

/** 去 ANSI 转义序列。 */
function _stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

/** 解析 cargo search 输出。兼容单行格式与部分版本键值块格式。 */
function _parseSearch(stdout: string): SearchResult[] {
  const lines = _stripAnsi(stdout).split(/\r?\n/);
  const results: SearchResult[] = [];

  for (const line of lines) {
    const m = line.match(_SEARCH_LINE);
    if (m) {
      results.push({ name: m[1], version: m[2], description: (m[3] ?? "").trim() });
    }
  }
  if (results.length > 0) return results;

  // 键值块格式（name = "x" / version = "x" / description = "x" 逐块重复）
  let name = "";
  let version = "";
  let description = "";
  for (const line of lines) {
    const kv = line.match(/^(\w+)\s*=\s*"([^"]*)"\s*$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (key === "name") {
      if (name) results.push({ name, version, description });
      name = value;
      version = "";
      description = "";
    } else if (key === "version") {
      version = value;
    } else if (key === "description") {
      description = value;
    }
  }
  if (name) results.push({ name, version, description });
  return results;
}

/** 解析 cargo info 输出为 PackageDetail。 */
function _parseInfo(stdout: string, name: string): PackageDetail {
  const lines = _stripAnsi(stdout).split(/\r?\n/);
  const detail: PackageDetail = { name, latest_version: "" };

  // 首行: `name #kw1 #kw2`（可能无关键字）
  const first = lines[0] ?? "";
  const nameToken = first.match(/^(\S+)/);
  if (nameToken) {
    detail.name = nameToken[1];
    const keywords = first
      .slice(nameToken[1].length)
      .split("#")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywords.length > 0) detail.raw = { ...(detail.raw ?? {}), keywords };
  }

  // 第二行起: 描述（若干行）后跟 `key: value` 键值；键值开始后不再收描述
  // （如 "crates.io: ..." 这类不关心的行只出现在键值区，须排除出描述）
  let description: string[] = [];
  let kvStarted = false;
  const kv: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(_INFO_KV);
    if (m) {
      kv[m[1]] = m[2].trim();
      kvStarted = true;
    } else if (!kvStarted && line.trim() && !/^\s/.test(line) && !line.trim().endsWith(":")) {
      description.push(line.trim());
    }
  }

  detail.latest_version = kv["version"] ?? "";
  detail.description = description.join(" ");
  detail.license = kv["license"] ?? "";
  detail.homepage = kv["homepage"] ?? "";
  detail.repository = kv["repository"] ?? "";
  detail.author = kv["author"] ?? "";
  return detail;
}

class CargoPackageManager extends PackageManager {
  /** cargo 的 registry 是 crates.io，与其它管理器不同源，registry 留 null。 */
  name = "cargo";
  display_name = "cargo (Rust)";
  icon = "🦀";
  description = "Rust 的包管理器，用于全局安装 Rust 编写的 CLI 工具。";

  async isAvailable(): Promise<boolean> {
    return isAvailableAsync("cargo");
  }

  async listInstalled(): Promise<PackageInfo[]> {
    const { stdout } = await runCommand("cargo", ["install", "--list"]);
    const packages: PackageInfo[] = [];
    for (const rawLine of stdout.split(/\r?\n/)) {
      const m = rawLine.match(_INSTALLED_LINE);
      if (m) {
        packages.push({
          name: m[1],
          version: m[2],
          manager: this.name,
        });
      }
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return packages;
  }

  /** cargo 无内置 outdated 命令，逐个 cargo info 对比最新版本。 */
  async listOutdated(): Promise<PackageInfo[]> {
    const installed = await this.listInstalled();
    if (installed.length === 0) return [];
    const outdated: PackageInfo[] = [];
    for (const pkg of installed) {
      try {
        const detail = await this.view(pkg.name);
        const latest = detail.latest_version;
        if (latest && latest !== pkg.version) {
          outdated.push({
            name: pkg.name,
            version: pkg.version,
            latest_version: latest,
            manager: this.name,
          });
        }
      } catch {
        continue;
      }
    }
    outdated.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return outdated;
  }

  async search(query: string): Promise<SearchResult[]> {
    const { stdout } = await runCommand("cargo", ["search", query, "--limit", "20", ..._CRATES_IO]);
    return _parseSearch(stdout);
  }

  async view(packageName: string): Promise<PackageDetail> {
    const { stdout, exitCode } = await runCommand("cargo", ["info", packageName, ..._CRATES_IO]);
    if (exitCode !== 0) {
      // 旧版 cargo 无 info 子命令时回退到 search 取版本与描述
      const { stdout: searchOut } = await runCommand("cargo", [
        "search",
        packageName,
        "--limit",
        "1",
        ..._CRATES_IO,
      ]);
      for (const result of _parseSearch(searchOut)) {
        if (result.name === packageName) {
          return {
            name: result.name,
            latest_version: result.version ?? "",
            description: result.description ?? "",
          };
        }
      }
      throw new ManagerError(t("error.view_failed", { cmd: "cargo info", package: packageName }));
    }
    return _parseInfo(stdout, packageName);
  }

  async install(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("cargo", ["install", packageName], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "install");
  }

  /** cargo install 在已有更新版本时即执行更新。 */
  async update(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("cargo", ["install", packageName], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "update");
  }

  async uninstall(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("cargo", ["uninstall", packageName], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "uninstall");
  }

  installCommand(packageName: string): string {
    return `cargo install ${packageName}`;
  }

  updateCommand(packageNames: string[]): string {
    return `cargo install ${packageNames.join(" ")}`;
  }

  uninstallCommand(packageNames: string[]): string {
    return `cargo uninstall ${packageNames.join(" ")}`;
  }
}

registerManager(CargoPackageManager);
