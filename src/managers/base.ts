/**
 * 包管理器抽象基类与注册表。
 *
 * 每个具体的包管理器（如 npm、winget 等）实现 PackageManager 接口，
 * 并通过 registerManager 装饰/注册到全局注册表。
 * TUI 层通过注册表按名称获取管理器实例，从而实现解耦。
 * 对应原 Python 项目的 managers/base.py。
 */

import type { OperationResult, PackageDetail, PackageInfo, SearchResult } from "./types";

export abstract class PackageManager {
  /** 管理器的唯一标识（如 "npm"）。 */
  abstract name: string;
  /** 用户可读的显示名称（如 "npm (Node.js)"）。 */
  display_name: string = "";
  /** 顶栏按钮前显示的图标字符（如 "⬢"），空串表示不显示。
   *  可被用户配置中的 manager_icons 覆盖。 */
  icon: string = "";
  /** 说明文字。 */
  description: string = "";
  /** 搜索所用的 registry 标识。相同 registry 的管理器（如 npm/pnpm/bun）
   *  聚合搜索时只搜索一次。null 表示以自身 name 作为独立 registry
   *  （winget/scoop 无需设置即自动独立搜索）。 */
  registry: string | null = null;

  /** 列出所有已安装的全局包。 */
  abstract listInstalled(): Promise<PackageInfo[]>;
  /** 列出所有有可用更新的已安装全局包。 */
  abstract listOutdated(): Promise<PackageInfo[]>;
  /** 在远端注册表中搜索包。 */
  abstract search(query: string): Promise<SearchResult[]>;
  /** 获取指定包的详细元数据。 */
  abstract view(packageName: string): Promise<PackageDetail>;
  /** 全局安装指定包。 */
  abstract install(packageName: string): Promise<OperationResult>;
  /** 全局安装指定包的特定版本。默认实现回退到 install(最新版)。 */
  async installVersion(packageName: string, version: string): Promise<OperationResult> {
    return this.install(packageName);
  }
  /** 安装指定版本将执行的命令行(进度通知展示用)。 */
  installVersionCommand(packageName: string, version: string): string {
    return this.installCommand(packageName);
  }
  /** 更新指定的全局包到最新版本。 */
  abstract update(packageName: string): Promise<OperationResult>;
  /** 卸载指定的全局包。 */
  abstract uninstall(packageName: string): Promise<OperationResult>;
  /** 安装指定包将执行的命令行（进度通知展示用）。 */
  abstract installCommand(packageName: string): string;
  /** 更新指定包到最新版本将执行的命令行（确认界面展示用）。 */
  abstract updateCommand(packageNames: string[]): string;
  /** 卸载指定包将执行的命令行（确认界面展示用）。 */
  abstract uninstallCommand(packageNames: string[]): string;

  /** 批量更新多个包。默认实现逐个调用 update；
   *  子类可覆盖以利用批量命令（如 npm i -g a b c）。 */
  async updateAll(packageNames: string[]): Promise<OperationResult[]> {
    const results: OperationResult[] = [];
    for (const name of packageNames) {
      results.push(await this.update(name));
    }
    return results;
  }

  /** 检查此包管理器是否在当前系统中可用。
   *  默认实现返回 true；子类可覆盖以检测可执行文件是否存在。 */
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

/** 构造器类型：可无参 new 出一个 PackageManager 实例。 */
export type PackageManagerCtor = { new (): PackageManager };

const _REGISTRY = new Map<string, PackageManagerCtor>();

/**
 * 将一个 PackageManager 子类注册到全局注册表。
 *
 * 由于 TS 中子类的 ``name = "npm"`` 等类字段初始化赋值到实例而非原型，
 * 这里通过零参实例化读取出 ``name`` 字段。所有后端子类均无构造参数，
 * 故零参实例化是安全的。
 */
export function registerManager<T extends PackageManagerCtor>(cls: T): T {
  const name = new cls().name;
  if (!name) {
    throw new Error(`${cls.name} 必须定义非空的 name 类属性`);
  }
  _REGISTRY.set(name, cls);
  return cls;
}

/** 根据名称获取已注册的管理器类。 */
export function getManagerClass(name: string): PackageManagerCtor | undefined {
  return _REGISTRY.get(name);
}

/** 返回所有已注册的管理器类 {name: cls}。 */
export function listManagers(): Record<string, PackageManagerCtor> {
  return Object.fromEntries(_REGISTRY);
}
