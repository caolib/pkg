/**
 * 配置持久化。
 *
 * 将用户设置（禁用的包管理器、自定义快捷键、语言、管理器图标）保存为
 * JSON 文件，路径为 ~/.config/pkg-tui/config.json
 * （Windows 上为 %USERPROFILE%\.config\pkg-tui\config.json）。
 * 对应原 Python 项目的 config.py。
 */

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export interface Config {
  disabled_managers?: string[];
  keybindings?: Record<string, string>;
  search_keybindings?: Record<string, string>;
  language?: string;
  manager_icons?: Record<string, string>;
  manager_names?: Record<string, string>;
}

/** 主应用可自定义的快捷键定义：[action, 默认按键, 说明_i18n_key, 是否显示在底栏] */
export const DEFAULT_BINDINGS: [string, string, string, boolean][] = [
  ["open_settings", "alt+s", "binding.settings", true],
  ["open_search", "s", "binding.search", true],
  ["view_output", "o", "binding.output", true],
  ["refresh_all", "r", "binding.refresh", true],
  ["update_selected", "u", "binding.update", true],
  ["uninstall_selected", "d", "binding.uninstall", true],
  ["toggle_select", "space", "binding.toggle", true],
  ["toggle_filter_updates", "f", "binding.filter", true],
];

/** 搜索界面可自定义的快捷键定义 */
export const SEARCH_BINDINGS: [string, string, string, boolean][] = [
  ["install_selected", "i", "binding.install", true],
  ["view_detail", "v", "binding.detail", true],
];

/** 返回配置目录路径，跨平台兼容。 */
function configDir(): string {
  if (process.platform === "win32") {
    // Windows: %USERPROFILE%\.config\pkg-tui
    const base = process.env.USERPROFILE || homedir();
    return join(base, ".config", "pkg-tui");
  }
  // Unix: $XDG_CONFIG_HOME/pkg-tui 或 ~/.config/pkg-tui
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "pkg-tui");
}

/** 返回配置文件的完整路径。 */
export function configPath(): string {
  return join(configDir(), "config.json");
}

/** 检测配置文件是否存在。 */
export async function configExists(): Promise<boolean> {
  try {
    return await Bun.file(configPath()).exists();
  } catch {
    return false;
  }
}

/** 从磁盘加载配置；文件不存在或损坏时返回空对象。 */
export async function loadConfig(): Promise<Config> {
  try {
    const file = Bun.file(configPath());
    if (!(await file.exists())) return {};
    const data = await file.json();
    return data && typeof data === "object" ? (data as Config) : {};
  } catch {
    return {};
  }
}

/** 将配置写入磁盘，自动创建父目录。 */
export async function saveConfig(config: Config): Promise<void> {
  const path = configPath();
  // Bun.write 不会自动创建父目录，需先 mkdir -p，否则首次启动时抛 ENOENT。
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(config, null, 2));
}

/** 返回所有主界面快捷键的默认值 {action: keys}。 */
export function defaultKeybindings(): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [action, keys] of DEFAULT_BINDINGS) r[action] = keys;
  return r;
}

/** 返回搜索界面快捷键的默认值 {action: keys}。 */
export function defaultSearchKeybindings(): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [action, keys] of SEARCH_BINDINGS) r[action] = keys;
  return r;
}

/** 从配置中提取被禁用的管理器名集合。 */
export function getDisabledManagers(config: Config): Set<string> {
  const raw = config.disabled_managers;
  return Array.isArray(raw) ? new Set(raw.map(String)) : new Set();
}

/** 从配置中提取主界面快捷键覆盖，缺失的用默认值补全。 */
export function getKeybindings(config: Config): Record<string, string> {
  const result = defaultKeybindings();
  const custom = config.keybindings;
  if (custom && typeof custom === "object") {
    for (const [action, keys] of Object.entries(custom)) {
      if (action in result && typeof keys === "string" && keys) {
        result[action] = keys;
      }
    }
  }
  return result;
}

/** 从配置中提取搜索界面快捷键覆盖，缺失的用默认值补全。 */
export function getSearchKeybindings(config: Config): Record<string, string> {
  const result = defaultSearchKeybindings();
  const custom = config.search_keybindings;
  if (custom && typeof custom === "object") {
    for (const [action, keys] of Object.entries(custom)) {
      if (action in result && typeof keys === "string" && keys) {
        result[action] = keys;
      }
    }
  }
  return result;
}

/** 从配置中提取语言设置，缺失时返回空字符串（由 i18n 自动检测）。 */
export function getLanguage(config: Config): string {
  const lang = config.language;
  if (lang === "zh_CN" || lang === "en_US") return lang;
  return "";
}

/** 从配置中提取各管理器的自定义图标 {name: icon}。 */
export function getManagerIcons(config: Config): Record<string, string> {
  const raw = config.manager_icons;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = String(v);
  return out;
}

/** 从配置中提取各管理器的自定义显示名 {name: 名称}。 */
export function getManagerNames(config: Config): Record<string, string> {
  const raw = config.manager_names;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = String(v);
  return out;
}
