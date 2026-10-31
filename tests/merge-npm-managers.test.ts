/** 合并 npm 系只合并入口；同名不同源的安装记录、版本和操作身份各自独立。 */
import { expect, test } from "bun:test";
import { ManagerRegistry, buildInstalledRows, ALL_MANAGERS } from "../src/runtime";
import { buildStripItems } from "../src/components/ManagerStrip";
import type { PackageInfo } from "../src/managers";

const sources = ["npm", "pnpm", "bun"];
const pkg = (name: string, version = "1.0.0") => ({
  name,
  version,
  display_name: "",
  latest_version: null,
  description: "",
});

function makeReg(merge = true): ManagerRegistry {
  const reg = new ManagerRegistry();
  reg.mergeNpmManagers = merge;
  for (const st of reg.states.values()) {
    st.checked = true;
    st.available = sources.includes(st.name);
    st.loadedInstalled = true;
    st.loadedOutdated = true;
  }
  reg.states.get("npm")!.installed = [pkg("opencode", "2.2.5"), pkg("x")];
  reg.states.get("pnpm")!.installed = [pkg("opencode", "2.1.0")];
  const bun = reg.states.get("bun")!;
  bun.installed = [pkg("opencode", "2.2.4"), pkg("b")];
  bun.outdated = [{ ...pkg("opencode", "2.2.4"), latest_version: "2.2.5" }];
  bun.outdatedMap = new Map(bun.outdated.map((p) => [p.name, p]));
  return reg;
}

const baseOpts = {
  current: ALL_MANAGERS,
  filterUpdates: false,
  filterText: "",
  checkedKeys: new Set<string>(),
};

test("合并 npm 系：顶栏只保留代表入口", () => {
  const reg = makeReg();
  expect([...reg.mergedManagerNames()]).toEqual([
    ["bun", "npm"],
    ["pnpm", "npm"],
  ]);
  const names = buildStripItems(reg, ALL_MANAGERS, false)
    .filter((i) => i.kind === "manager")
    .map((i) => i.name);
  expect(names).toEqual([ALL_MANAGERS, "npm"]);
});

for (const current of [ALL_MANAGERS, "npm"]) {
  test(`合并 npm 系：${current} 保留同名包的全部来源与真实操作身份`, () => {
    const reg = makeReg();
    const rows = buildInstalledRows(reg, { ...baseOpts, current });
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.key)).size).toBe(5);
    expect(
      rows
        .filter((r) => r.pkg.name === "opencode")
        .map((r) => r.managerName)
        .sort(),
    ).toEqual([...sources].sort());
    for (const row of rows) {
      expect(row.key).toBe(`${row.managerName}:${row.pkg.name}`);
      const found = reg.findSelected(current, row.key)!;
      expect(found.manager).toBe(reg.states.get(row.managerName)!.instance);
      expect(found.pkg).toBe(row.pkg);
      expect(reg.managerDisplayName(row.managerName)).toBe(row.managerName);
    }
    // 缺失源不能回退到另一个管理器，即使另一源确实装了该包。
    expect(reg.findSelected(current, "npm:b")).toBeNull();
    expect(reg.findSelected(current, "opencode")).toBeNull();
  });

  test(`合并 npm 系：${current} 各来源版本、更新状态和过滤互不覆盖`, () => {
    const reg = makeReg();
    const opts = { ...baseOpts, current, filterText: "opencode" };
    const rows = buildInstalledRows(reg, opts);
    expect(rows).toHaveLength(3);
    const bySource = new Map(rows.map((r) => [r.managerName, r]));
    expect(bySource.get("npm")!.pkg.version).toBe("2.2.5");
    expect(bySource.get("npm")!.latestVersion).toBe("2.2.5");
    expect(bySource.get("npm")!.hasUpdate).toBe(false);
    expect(bySource.get("pnpm")!.pkg.version).toBe("2.1.0");
    expect(bySource.get("bun")!.pkg.version).toBe("2.2.4");
    expect(bySource.get("bun")!.latestVersion).toBe("2.2.5");
    expect(bySource.get("bun")!.updateKind).toBe("patch");
    expect(buildInstalledRows(reg, { ...opts, filterUpdates: true }).map((r) => r.key)).toEqual([
      "bun:opencode",
    ]);
  });
}

test("渐进加载：新来源到达只追加记录，已有行身份不被替换", () => {
  for (const current of [ALL_MANAGERS, "npm"]) {
    for (const order of [sources, [...sources].reverse()]) {
      const reg = makeReg();
      const saved = new Map(sources.map((n) => [n, reg.states.get(n)!.installed]));
      for (const n of sources) reg.states.get(n)!.installed = [];
      const seen = new Map<string, PackageInfo>();
      for (const n of order) {
        reg.states.get(n)!.installed = saved.get(n)!;
        const rows = buildInstalledRows(reg, { ...baseOpts, current });
        for (const [key, record] of seen) {
          expect(rows.find((r) => r.key === key)?.pkg).toBe(record);
        }
        for (const row of rows) seen.set(row.key, row.pkg);
      }
      expect(seen.size).toBe(5);
    }
  }
});

test("关闭合并：同名包仍分源保留，单管理器视图仅包含自身", () => {
  const reg = makeReg(false);
  expect(reg.mergedManagerNames().size).toBe(0);
  const names = buildStripItems(reg, ALL_MANAGERS, false)
    .filter((i) => i.kind === "manager")
    .map((i) => i.name);
  expect(names).toEqual([ALL_MANAGERS, "bun", "npm", "pnpm"]);
  expect(buildInstalledRows(reg, baseOpts)).toHaveLength(5);
  const rows = buildInstalledRows(reg, { ...baseOpts, current: "npm" });
  expect(rows.map((r) => r.key)).toEqual(["npm:opencode", "npm:x"]);
  expect(reg.findSelected("npm", "npm:opencode")?.state.name).toBe("npm");
  expect(reg.findSelected("npm", "bun:opencode")).toBeNull();
});

test("禁用/不可用来源不参与聚合，也不能被旧 key 操作", () => {
  const reg = makeReg();
  reg.states.get("npm")!.disabled = true;
  reg.states.get("pnpm")!.available = false;
  expect(buildInstalledRows(reg, baseOpts).map((r) => r.key)).toEqual(["bun:opencode", "bun:b"]);
  expect(reg.findSelected(ALL_MANAGERS, "npm:opencode")).toBeNull();
  expect(reg.findSelected(ALL_MANAGERS, "pnpm:opencode")).toBeNull();
});

test("npm 不可用时仍保留其余合并成员；包名中的冒号不破坏来源解析", () => {
  const reg = makeReg();
  reg.states.get("npm")!.available = false;
  for (const n of ["bun", "pnpm"]) {
    reg.states.get(n)!.installed.push(pkg("@scope/pkg:variant"));
  }
  expect(reg.mergedManagerNames().get("pnpm")).toBe("bun");
  for (const current of [ALL_MANAGERS, "bun"]) {
    const rows = buildInstalledRows(reg, { ...baseOpts, current });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(reg.findSelected(current, row.key)?.pkg).toBe(row.pkg);
    }
  }
});
