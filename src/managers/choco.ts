/**
 * choco (Chocolatey) 包管理器后端实现。
 *
 * choco 支持 `--limit-output` 输出机器可读的 `name|version` 行，
 * list/outdated/search 均用此格式解析；info 输出键值文本，按行取关键字段。
 * choco 的仓库是 community repo，与 winget/scoop 均不同源，registry 留 null。
 *
 * 注意：choco info 对不存在的包退出码为 0，须检测输出中的 "0 packages found."。
 * 安装/升级/卸载需要管理员权限（与 winget 相同），由用户在终端环境负责。
 */

import { t } from "../i18n";
import type { OperationResult, PackageDetail, PackageInfo, SearchResult } from "./types";
import { isAvailableAsync, ManagerError, runCommand } from "./_cli";
import { PackageManager, registerManager } from "./base";
import { _makeResult } from "./npm";

// choco list/search 的 --limit-output 行: name|version
const _PIPE_LINE = /^([^|]+)\|([^|]+)$/;

// choco outdated 的 --limit-output 行: name|installed|latest|pinned
const _OUTDATED_LINE = /^([^|]+)\|([^|]*)\|([^|]*)\|(.*)$/;

// info 的首信息行: `git 2.55.0.3 [Approved]`
const _INFO_HEAD = /^(\S+)\s+([^\s[\]]+)/;

// info 键值行: `Software Site: https://...`（键含空格，取冒号前全部）
const _INFO_KV = /^([A-Za-z][A-Za-z ]*?):\s*(.*)$/;

class ChocoPackageManager extends PackageManager {
  /** choco 与其它管理器不同源，registry 留 null。 */
  name = "choco";
  display_name = "choco (Chocolatey)";
  icon = "🍫";
  description = "Windows 包管理器（基于 PowerShell），按管理员权限安装软件。";

  async isAvailable(): Promise<boolean> {
    return isAvailableAsync("choco");
  }

  async listInstalled(): Promise<PackageInfo[]> {
    const { stdout, exitCode } = await runCommand("choco", [
      "list",
      "--local-only",
      "--limit-output",
    ]);
    if (exitCode !== 0) return [];
    const packages: PackageInfo[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(_PIPE_LINE);
      if (m) {
        packages.push({ name: m[1], version: m[2], manager: this.name });
      }
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return packages;
  }

  async listOutdated(): Promise<PackageInfo[]> {
    const { stdout, exitCode } = await runCommand("choco", ["outdated", "--limit-output"]);
    if (exitCode !== 0) return [];
    const packages: PackageInfo[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(_OUTDATED_LINE);
      if (m?.[3]) {
        packages.push({
          name: m[1],
          version: m[2],
          latest_version: m[3],
          manager: this.name,
        });
      }
    }
    packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return packages;
  }

  async search(query: string): Promise<SearchResult[]> {
    const { stdout } = await runCommand("choco", ["search", query, "--limit-output"]);
    const results: SearchResult[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(_PIPE_LINE);
      if (m) results.push({ name: m[1], version: m[2] });
    }
    return results;
  }

  async view(packageName: string): Promise<PackageDetail> {
    const { stdout, exitCode } = await runCommand("choco", ["info", packageName]);
    if (exitCode !== 0 || stdout.includes("0 packages found")) {
      throw new ManagerError(t("error.view_failed", { cmd: "choco info", package: packageName }));
    }
    return _parseInfo(stdout, packageName);
  }

  async install(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("choco", ["install", packageName, "-y"], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "install");
  }

  async update(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand("choco", ["upgrade", packageName, "-y"], {
      log: true,
    });
    return _makeResult(stdout, stderr, exitCode, packageName, "update");
  }

  async uninstall(packageName: string): Promise<OperationResult> {
    const { stdout, stderr, exitCode } = await runCommand(
      "choco",
      ["uninstall", packageName, "-y"],
      { log: true },
    );
    return _makeResult(stdout, stderr, exitCode, packageName, "uninstall");
  }

  installCommand(packageName: string): string {
    return `choco install ${packageName} -y`;
  }

  updateCommand(packageNames: string[]): string {
    return `choco upgrade ${packageNames.join(" ")} -y`;
  }

  uninstallCommand(packageNames: string[]): string {
    return `choco uninstall ${packageNames.join(" ")} -y`;
  }
}

/** 解析 choco info 输出为 PackageDetail。 */
function _parseInfo(stdout: string, name: string): PackageDetail {
  const detail: PackageDetail = { name, latest_version: "" };
  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    // 首信息行 `git 2.55.0.3 [Approved]`；排除 "Chocolatey vX" 与
    // 结尾的 "N packages found."（版本号必以数字开头）
    const head = line.match(_INFO_HEAD);
    if (head && /^\d/.test(head[2]) && head[1] !== "Chocolatey") {
      detail.name = head[1];
      detail.latest_version = head[2];
      continue;
    }
    const kv = line.trim().match(_INFO_KV);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (key === "Title") {
      detail.display_name = value.split("|")[0].trim();
    } else if (key === "Software Site") {
      detail.homepage = value;
    } else if (key === "Software License") {
      detail.license = value;
    } else if (key === "Software Source") {
      detail.repository = value;
    } else if (key === "Summary") {
      detail.description = value;
    } else if (key === "Description") {
      // 描述多行：取首行，后续缩进行拼入
      let desc = value;
      const idx = lines.indexOf(line);
      for (let i = idx + 1; i < lines.length; i++) {
        const next = lines[i];
        if (!next.trim() || next.trim().startsWith("##")) break;
        if (!/^\s/.test(next) && /^\S/.test(next) && /:\s/.test(next)) break;
        desc += ` ${next.trim()}`;
      }
      detail.description = desc.trim();
    } else if (key === "Tags") {
      const tags = value.split(/\s+/).filter(Boolean);
      if (tags.length > 0) {
        detail.raw = { ...(detail.raw ?? {}), tags };
      }
    }
  }
  return detail;
}

registerManager(ChocoPackageManager);
