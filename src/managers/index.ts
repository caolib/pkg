/**
 * 包管理器后端实现入口。
 *
 * 导入此模块会自动注册所有已实现的管理器（npm、pnpm、bun、winget、scoop、cargo）。
 * 对应原 Python 项目的 managers/__init__.py。
 */

import "./npm"; // 导入以触发注册
import "./pnpm";
import "./bun";
import "./winget";
import "./scoop";
import "./cargo";

export { PackageManager, getManagerClass, listManagers, registerManager } from "./base";
export type {
  OperationResult,
  PackageDetail,
  PackageInfo,
  SearchResult,
} from "./types";
export { hasUpdate, shownName, shownResultName, publishedDate } from "./types";
