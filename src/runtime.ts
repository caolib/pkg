/**
 * 领域运行时逻辑层。
 *
 * 把主界面与操作编排中不依赖渲染的状态/逻辑集中在此，供 React hook 消费。
 * 对应原 Python 项目 PkgTuiApp 中的 ManagerState 与各 _do_* 编排逻辑。
 * 本模块不依赖 @opentui 与 react，可独立测试。
 */

import {
  listManagers,
  type PackageManager,
  type PackageInfo,
  type OperationResult,
  hasUpdate as pkgHasUpdate,
} from "./managers";
import {
  type Config,
  defaultKeybindings,
  defaultSearchKeybindings,
  getDisabledManagers,
  getKeybindings,
  getSearchKeybindings,
  getLanguage,
  getManagerIcons,
  getManagerNames,
  getUserManagerChoices,
  getAutoCheckUpdates,
  loadConfig,
  saveConfig,
  configExists,
} from "./config";

/** "全部"视图的特殊标识 */
export const ALL_MANAGERS = "__all__";

/** 预览命令的 action */
export type PreviewAction = "update" | "uninstall";

/** 单个包管理器的运行时状态。 */
export interface ManagerState {
  name: string;
  instance: PackageManager;
  available: boolean;
  /** 是否已检测过可用性（区分"未检测"与"已检测但不可用"） */
  checked: boolean;
  /** 用户手动禁用；禁用的管理器在主界面隐藏且不加载 */
  disabled: boolean;
  /** 用户手动切换过启用/禁用（true=禁用，false=启用；undefined=未手动操作，
   *  自动检测结果为准）。设置界面勾选过的管理器，checkAll/checkOne 不得覆盖。 */
  userDisabled?: boolean;
  installed: PackageInfo[];
  outdated: PackageInfo[];
  /** outdated 按包名索引，方便快速查找最新版本 */
  outdatedMap: Map<string, PackageInfo>;
  loadedInstalled: boolean;
  loadedOutdated: boolean;
}

/** 表格行（主界面已安装视图）。manager 只在"全部"视图填。 */
export interface InstalledRow {
  /** 行 key：全部视图 "manager:name"，单管理器视图 name */
  key: string;
  managerName: string;
  pkg: PackageInfo;
  /** 正在加载该管理器时为 true */
  loading: boolean;
  /** 该包是否有可用更新 */
  hasUpdate: boolean;
  /** 最新版本展示值（有更新=cached.latest_version；已检测但无更新=当前版本；未检测=空） */
  latestVersion: string;
}

export class ManagerRegistry {
  states: Map<string, ManagerState> = new Map();
  names: string[] = [];
  disabledManagers: Set<string> = new Set();
  // 构造即用默认值初始化，确保即使 loadPersisted 未完成，快捷键也可用
  keybindings: Record<string, string> = defaultKeybindings();
  searchKeybindings: Record<string, string> = defaultSearchKeybindings();
  managerIcons: Record<string, string> = {};
  managerNames: Record<string, string> = {};
  /** 打开首页时自动检查更新(默认开启,可在设置界面关闭)。 */
  autoCheckUpdates = true;
  config: Config = {};

  /** 构造所有已注册管理器的运行时状态。 */
  constructor() {
    for (const [name, cls] of Object.entries(listManagers()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const state: ManagerState = {
        name,
        instance: new cls(),
        available: false,
        checked: false,
        disabled: false,
        installed: [],
        outdated: [],
        outdatedMap: new Map(),
        loadedInstalled: false,
        loadedOutdated: false,
      };
      this.states.set(name, state);
      this.names.push(name);
    }
  }

  /** 从持久化配置恢复禁用状态、快捷键、图标、语言（返回语言码）。 */
  async loadPersisted(): Promise<string> {
    this.config = await loadConfig();
    this.disabledManagers = getDisabledManagers(this.config);
    this.keybindings = getKeybindings(this.config);
    this.searchKeybindings = getSearchKeybindings(this.config);
    this.managerIcons = getManagerIcons(this.config);
    this.managerNames = getManagerNames(this.config);
    this.autoCheckUpdates = getAutoCheckUpdates(this.config);
    const userChoices = getUserManagerChoices(this.config);
    for (const name of this.disabledManagers) {
      const st = this.states.get(name);
      if (st) st.disabled = true;
    }
    for (const [name, choice] of Object.entries(userChoices)) {
      const st = this.states.get(name);
      if (st) st.userDisabled = choice;
    }
    return getLanguage(this.config);
  }

  /**
   * 首次启动时若配置文件不存在，用默认值初始化并写入磁盘，
   * 方便用户后续按文件手动编辑快捷键等设置。
   */
  async ensureConfig(): Promise<void> {
    if (await configExists()) return;
    await this.persist();
  }

  /** 管理器按钮图标前缀（含尾随空格），无图标返回空串。 */
  managerIcon(name: string): string {
    if (name === ALL_MANAGERS) return "◈ ";
    const icon = this.managerIcons[name];
    if (icon !== undefined) return icon ? `${icon} ` : "";
    const st = this.states.get(name);
    return st && st.instance.icon ? `${st.instance.icon} ` : "";
  }

  /** 管理器显示名：优先配置覆盖，否则默认 name。 */
  managerDisplayName(name: string): string {
    return this.managerNames[name] ?? name;
  }

  /** 检测所有管理器可用性。 */
  async checkAvailability(): Promise<void> {
    for (const name of this.names) {
      const st = this.states.get(name)!;
      try {
        st.available = await st.instance.isAvailable();
        st.checked = true;
      } catch {
        st.available = false;
        st.checked = true;
      }
    }
  }

  /** 当前视图下"活跃"（可用且未禁用）的管理器列表。 */
  activeManagers(current: string): ManagerState[] {
    if (current === ALL_MANAGERS) {
      return [...this.states.values()].filter((s) => s.available && !s.disabled);
    }
    const st = this.states.get(current);
    return st && st.available && !st.disabled ? [st] : [];
  }

  /** 失效所有缓存，强制重载。 */
  invalidateAll(): void {
    for (const st of this.states.values()) {
      st.loadedInstalled = false;
      st.loadedOutdated = false;
      st.outdatedMap = new Map();
    }
  }

  /** 失效单个管理器缓存。 */
  invalidate(name: string): void {
    const st = this.states.get(name);
    if (!st) return;
    st.loadedInstalled = false;
    st.loadedOutdated = false;
    st.outdatedMap = new Map();
  }

  /** 为某包名查找其所属管理器与 PackageInfo（用于行选中→详情/操作）。 */
  findSelected(
    current: string,
    key: string,
  ): { manager: PackageManager; state: ManagerState; pkg: PackageInfo } | null {
    const isAll = current === ALL_MANAGERS;
    let mgrName: string | null = null;
    let pkgName: string = key;
    if (isAll) {
      const i = key.indexOf(":");
      if (i < 0) return null;
      mgrName = key.slice(0, i);
      pkgName = key.slice(i + 1);
    } else {
      mgrName = current;
    }
    const st = this.states.get(mgrName!);
    if (!st) return null;
    const inInstalled = st.installed.find((p) => p.name === pkgName);
    const inOutdated = st.outdated.find((p) => p.name === pkgName);
    const pkg = inInstalled ?? inOutdated;
    if (!pkg) return null;
    return { manager: st.instance, state: st, pkg };
  }

  /**
   * 各管理器的默认图标 {name: icon}（仅含自带图标的管理器）。
   * 写入配置文件作为可编辑的默认值，用户照此修改即可自定义。
   */
  private defaultManagerIcons(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, st] of this.states) {
      if (st.instance.icon) out[name] = st.instance.icon;
    }
    return out;
  }

  /**
   * 各管理器的默认显示名 {name: name}，写入配置文件列出全部可自定义的键，
   * 用户直接改值即可。
   */
  private defaultManagerNames(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of this.names) out[name] = name;
    return out;
  }

  /**
   * 持久化配置到磁盘。
   *
   * 快捷键（keybindings / search_keybindings）在 UI 中没有编辑入口，
   * 因此以磁盘当前值为准——避免用启动时载入内存的旧值覆盖用户在运行期间
   * 手动修改的 config.json。只有 disabled_managers / language / manager_icons
   * 这些 UI 可改的字段才用内存值写入。
   *
   * manager_icons / manager_names 合并各管理器默认值写入，用户可直接在文件
   * 中修改；自定义值覆盖默认值。
   */
  async persist(): Promise<void> {
    let disk: Config = {};
    try {
      disk = await loadConfig();
    } catch {
      // 磁盘读取失败时退回内存值（不阻塞保存）
    }
    this.config = {
      disabled_managers: [...this.disabledManagers].sort(),
      keybindings: disk.keybindings ?? this.keybindings,
      search_keybindings: disk.search_keybindings ?? this.searchKeybindings,
      language: this.config.language || "",
      auto_check_updates: this.autoCheckUpdates,
      manager_icons: { ...this.defaultManagerIcons(), ...this.managerIcons },
      manager_names: { ...this.defaultManagerNames(), ...this.managerNames },
      user_manager_choices: Object.fromEntries(
        [...this.states.entries()]
          .filter(([, st]) => st.userDisabled !== undefined)
          .map(([name, st]) => [name, st.userDisabled as boolean]),
      ),
    };
    try {
      await saveConfig(this.config);
    } catch {
      // 忽略保存失败（UI 层可单独提示）
    }
  }
}

// ---------------------------------------------------------------------------
// 已安装视图：聚合 + 过滤
// ---------------------------------------------------------------------------

export interface InstalledViewOptions {
  current: string;
  /** 仅显示可更新 */
  filterUpdates: boolean;
  /** 本地过滤文本（小写） */
  filterText: string;
  checkedKeys: Set<string>;
  /** 行 key 前缀取 manager 名（全部视图） */
  isAll: boolean;
}

/** 根据缓存构造已安装表格行列表（含过滤、最新版本回填、勾选）。 */
export function buildInstalledRows(
  reg: ManagerRegistry,
  opts: InstalledViewOptions,
): InstalledRow[] {
  const managers = reg.activeManagers(opts.current);
  const rows: InstalledRow[] = [];
  for (const st of managers) {
    const loading = !st.loadedInstalled;
    for (const pkg of st.installed) {
      const outdatedInfo = st.outdatedMap.get(pkg.name);
      let latestVer = "";
      if (outdatedInfo && outdatedInfo.latest_version) {
        latestVer = outdatedInfo.latest_version;
      } else if (st.loadedOutdated) {
        latestVer = pkg.version;
      }
      const up = pkgHasUpdate({ ...pkg, latest_version: latestVer });
      // 过滤模式：仅显示有更新
      if (opts.filterUpdates && !up) continue;
      // 本地过滤
      if (opts.filterText) {
        const shown = (pkg.display_name || pkg.name).toLowerCase();
        if (!shown.includes(opts.filterText) && !pkg.name.toLowerCase().includes(opts.filterText))
          continue;
      }
      rows.push({
        key: opts.isAll ? `${st.name}:${pkg.name}` : pkg.name,
        managerName: st.name,
        pkg,
        loading,
        hasUpdate: up,
        latestVersion: latestVer,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 搜索：registry 分组去重
// ---------------------------------------------------------------------------

export interface SearchGroup {
  /** 搜索代表（registry 内优先选 npm） */
  rep: PackageManager;
  /** 组内成员（安装时的候选管理器） */
  members: PackageManager[];
  /** 来源标注：只显示实际执行搜索的代表名（npm 系用 npm 搜，故标 "npm" 而非 "bun/npm/pnpm"） */
  sourceLabel: string;
}

/** 按_registry分组，同组只搜一次（npm 系默认用 npm 搜）。 */
export function buildSearchGroups(managers: PackageManager[]): {
  groups: SearchGroup[];
  repMap: Map<string, PackageManager>;
} {
  const groupsMap = new Map<string, PackageManager[]>();
  for (const m of managers) {
    const key = m.registry ?? m.name;
    const arr = groupsMap.get(key) ?? [];
    arr.push(m);
    groupsMap.set(key, arr);
  }
  const groups: SearchGroup[] = [];
  for (const ms of groupsMap.values()) {
    const rep = ms.find((m) => m.name === "npm") ?? ms[0];
    groups.push({
      rep,
      members: ms,
      sourceLabel: rep.name,
    });
  }
  const repMap = new Map<string, PackageManager>();
  for (const g of groups) repMap.set(g.rep.name, g.rep);
  return { groups, repMap };
}

// ---------------------------------------------------------------------------
// 操作编排：命令预览 + 批量执行汇总
// ---------------------------------------------------------------------------

/** groups: {管理器名: [包名...]}。 */
export type ManagerGroups = Record<string, string[]>;

/** 为确认框生成各管理器将执行的命令预览。 */
export function previewCommands(
  reg: ManagerRegistry,
  groups: ManagerGroups,
  action: PreviewAction,
): string[] {
  const cmds: string[] = [];
  for (const [mgrName, names] of Object.entries(groups)) {
    const st = reg.states.get(mgrName);
    if (!st) continue;
    cmds.push(
      action === "update" ? st.instance.updateCommand(names) : st.instance.uninstallCommand(names),
    );
  }
  return cmds;
}

export interface OpSummary {
  ok: number;
  fail: number;
  results: OperationResult[];
}

/** 批量更新多个管理器的多个包。 */
export async function doUpdateAll(reg: ManagerRegistry, groups: ManagerGroups): Promise<OpSummary> {
  const allResults: OperationResult[] = [];
  for (const [mgrName, names] of Object.entries(groups)) {
    const st = reg.states.get(mgrName);
    if (!st) continue;
    try {
      const results = await st.instance.updateAll(names);
      allResults.push(...results);
    } catch (exc) {
      for (const n of names) allResults.push({ success: false, message: String(exc), package: n });
    }
  }
  const ok = allResults.filter((r) => r.success).length;
  return { ok, fail: allResults.length - ok, results: allResults };
}

/** 批量卸载多个管理器的多个包。 */
export async function doUninstallAll(
  reg: ManagerRegistry,
  groups: ManagerGroups,
): Promise<OpSummary> {
  const allResults: OperationResult[] = [];
  for (const [mgrName, names] of Object.entries(groups)) {
    const st = reg.states.get(mgrName);
    if (!st) continue;
    for (const name of names) {
      try {
        allResults.push(await st.instance.uninstall(name));
      } catch (exc) {
        allResults.push({ success: false, message: String(exc), package: name });
      }
    }
  }
  const ok = allResults.filter((r) => r.success).length;
  return { ok, fail: allResults.length - ok, results: allResults };
}
