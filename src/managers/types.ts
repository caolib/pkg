/**
 * 跨包管理器通用的数据模型。
 *
 * 各个具体的包管理器后端负责将各自的输出转换为这些统一模型，
 * 供 TUI 层使用。对应原 Python 项目的 models.py。
 */

/** 一个已安装包的标准化信息。 */
export interface PackageInfo {
  /** 包的唯一标识。对 npm 系为包名，对 winget 为 PackageIdentifier。
   *  用作表格行 key 与安装/更新/卸载等操作的标识，必须保证
   *  在同一管理器内唯一、稳定，故不应放入仅供展示的"显示名"。 */
  name: string;
  /** 当前安装的版本。 */
  version: string;
  /** 用户可读的显示名（仅用于界面展示）。为空时回退到 name。
   *  winget 用此字段存放 Name 列，npm/pnpm/bun 留空。 */
  display_name?: string;
  description?: string;
  /** 包的安装路径（如果可用）。 */
  location?: string;
  /** 来源包管理器的名称（如 "npm"）。 */
  manager?: string;
  /** 最新可用版本（如果已知）。 */
  latest_version?: string | null;
  /** 符合 semver 约束的期望版本（如果已知）。 */
  wanted_version?: string | null;
}

/** 判断是否存在可用更新。 */
export function hasUpdate(pkg: PackageInfo): boolean {
  if (pkg.latest_version == null || pkg.latest_version === "") return false;
  return pkg.latest_version !== pkg.version;
}

/** 表格"名称"列实际显示的文本：优先 display_name，否则 name。 */
export function shownName(pkg: PackageInfo): string {
  return pkg.display_name || pkg.name;
}

/** 包搜索结果条目。 */
export interface SearchResult {
  /** 包的唯一标识（搜索结果行 key 与安装操作的标识）。 */
  name: string;
  version?: string;
  /** 用户可读的显示名（winget 用），为空时回退到 name。 */
  display_name?: string;
  description?: string;
  date?: string;
  keywords?: string[];
  license?: string;
}

/** 搜索结果"名称"列实际显示的文本。 */
export function shownResultName(r: SearchResult): string {
  return r.display_name || r.name;
}

/** 包的详细元数据。
 *  不同包管理器返回的详情字段差异较大，统一结构展示关键字段并保留 raw。 */
export interface PackageDetail {
  /** 包的唯一标识（npm 系为包名；winget 为 PackageIdentifier）。 */
  name: string;
  latest_version: string;
  display_name?: string;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  author?: string;
  maintainers?: string[];
  dist_tags?: Record<string, string>;
  versions?: string[];
  time?: Record<string, string>;
  /** 原始 API 返回数据，供需要时深度展示。 */
  raw?: Record<string, unknown>;
}

/** 最新版本发布时间。 */
export function publishedDate(detail: PackageDetail): string {
  if (!detail.time) return "";
  return detail.time[detail.latest_version] ?? detail.time["modified"] ?? "";
}

/** 一个包管理器操作（安装/更新/卸载）的结果。 */
export interface OperationResult {
  success: boolean;
  message?: string;
  /** 操作涉及的包名。 */
  package?: string;
}
