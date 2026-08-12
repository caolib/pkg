/**
 * 管理器顺序（reg.names）按配置 manager_names 键顺序排列的回归测试。
 *
 * 顶栏按钮、← → 视图切换、设置界面管理器列表共用 reg.names 的顺序：
 *  - orderNamesByConfig: 配置列出的键按文件键顺序排前，未列出的保持字母序附后，
 *    未注册的键忽略
 *  - 无 manager_names 配置时维持字母序
 *  - persist() 写回 config.json 时 manager_names 按当前 names 顺序输出，
 *    用户手动调整过的键顺序不会被保存操作打乱
 *
 * 运行:bun test tests/manager-order.test.ts
 */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig, loadConfig, configPath } from "../src/config";
import { ManagerRegistry, orderNamesByConfig } from "../src/runtime";

const ALL = ["bun", "cargo", "choco", "npm", "pnpm", "scoop", "uv", "winget"];

function ordered(names: string[], managerNames: Record<string, string>): string[] {
  const arr = [...names];
  orderNamesByConfig(arr, { manager_names: managerNames });
  return arr;
}

/** 把配置目录重定向到临时目录（win32 看 USERPROFILE，unix 看 XDG_CONFIG_HOME/HOME），返回还原函数。 */
function useTempHome(): () => void {
  const home = mkdtempSync(join(tmpdir(), "pkg-tui-order-"));
  const keys = ["USERPROFILE", "HOME", "XDG_CONFIG_HOME"] as const;
  const old = keys.map((k) => process.env[k]);
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  return () => {
    keys.forEach((k, i) => {
      if (old[i] === undefined) delete process.env[k];
      else process.env[k] = old[i];
    });
    rmSync(home, { recursive: true, force: true });
  };
}

test("无 manager_names 配置时保持字母序", () => {
  const arr = [...ALL];
  orderNamesByConfig(arr, {});
  expect(arr).toEqual(ALL);
});

test("配置键顺序优先，未列出的保持字母序附后", () => {
  expect(ordered(ALL, { winget: "W", npm: "N" })).toEqual([
    "winget",
    "npm",
    "bun",
    "cargo",
    "choco",
    "pnpm",
    "scoop",
    "uv",
  ]);
});

test("完整自定义顺序原样生效", () => {
  const custom = { uv: "", npm: "", scoop: "", bun: "", winget: "", pnpm: "", cargo: "", choco: "" };
  expect(ordered(ALL, custom)).toEqual(Object.keys(custom));
});

test("未注册的键被忽略", () => {
  expect(ordered(ALL, { nosuch: "X", uv: "U" })).toEqual([
    "uv",
    "bun",
    "cargo",
    "choco",
    "npm",
    "pnpm",
    "scoop",
    "winget",
  ]);
});

test("loadPersisted 应用配置顺序（禁用状态不受影响）", async () => {
  const restore = useTempHome();
  try {
    await saveConfig({
      manager_names: { winget: "W", scoop: "S", npm: "N" },
      disabled_managers: ["scoop"],
    });
    const reg = new ManagerRegistry();
    await reg.loadPersisted();
    expect(reg.names).toEqual(["winget", "scoop", "npm", "bun", "cargo", "choco", "pnpm", "uv"]);
    expect(reg.states.get("scoop")!.disabled).toBe(true);
  } finally {
    restore();
  }
});

test("persist 按当前 names 顺序写回 manager_names", async () => {
  const restore = useTempHome();
  try {
    const reg = new ManagerRegistry();
    reg.names = ["uv", "npm", ...ALL.filter((n) => n !== "uv" && n !== "npm")];
    await reg.persist();
    const written = JSON.parse(readFileSync(configPath(), "utf8"));
    expect(Object.keys(written.manager_names)).toEqual(reg.names);
    // 读回后顺序不变
    const reg2 = new ManagerRegistry();
    orderNamesByConfig(reg2.names, await loadConfig());
    expect(reg2.names).toEqual(reg.names);
  } finally {
    restore();
  }
});
