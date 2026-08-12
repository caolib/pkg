/**
 * "合并 npm 系管理器"(mergeNpmManagers)回归测试。
 *
 * 设置开启后,首页"全部"视图里同 registry 的 npm/pnpm/bun 行合并显示为 npm:
 *  - mergedManagerNames: 可用成员(除代表)映射到代表名
 *  - buildInstalledRows: 行 key 前缀用代表名,同包名跨源去重(保留先出现的 npm)
 *  - buildStripItems: 被并入的管理器不出现在顶栏
 *  - findSelected: 行 key 前缀是代表名时,能回退定位到实际所属成员(操作仍用
 *    真实管理器执行)
 *
 * 运行:bun test
 */
import { test } from "bun:test";
import { ManagerRegistry, buildInstalledRows, ALL_MANAGERS } from "../src/runtime";
import { buildStripItems } from "../src/components/ManagerStrip";

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
}

/** 构造注册表:仅留 npm(可装 a/x)/pnpm(装 a)/bun(装 b),其余管理器不可用。 */
function makeReg(merge: boolean): ManagerRegistry {
  const reg = new ManagerRegistry();
  reg.mergeNpmManagers = merge;
  for (const st of reg.states.values()) {
    st.checked = true;
    st.available = ["npm", "pnpm", "bun"].includes(st.name);
    st.loadedInstalled = true;
  }
  const pkg = (name: string, version = "1.0.0") => ({
    name,
    version,
    display_name: "",
    latest_version: null,
    description: "",
  });
  reg.states.get("npm")!.installed = [pkg("a"), pkg("x")];
  reg.states.get("pnpm")!.installed = [pkg("a")];
  reg.states.get("bun")!.installed = [pkg("b")];
  return reg;
}

const baseOpts = {
  current: ALL_MANAGERS,
  filterUpdates: false,
  filterText: "",
  checkedKeys: new Set<string>(),
  isAll: true,
};

test("合并 npm 系:mergedManagerNames 与顶栏/行合并", () => {
  const reg = makeReg(true);

  const merged = reg.mergedManagerNames();
  check(merged.get("pnpm") === "npm" && merged.get("bun") === "npm", "pnpm/bun 并入代表 npm");
  check(!merged.has("npm"), "代表 npm 自身不在合并映射中");

  const strip = buildStripItems(reg, ALL_MANAGERS, false);
  const mgrNames = strip.filter((i) => i.kind === "manager").map((i) => i.name);
  check(
    mgrNames.includes("npm") && !mgrNames.includes("pnpm") && !mgrNames.includes("bun"),
    `顶栏只显示 npm(隐藏 pnpm/bun),实际 [${mgrNames.join(",")}]`,
  );

  const rows = buildInstalledRows(reg, baseOpts);
  check(
    rows.every((r) => r.key.startsWith("npm:")),
    `全部行 key 前缀为 npm:,实际 [${rows.map((r) => r.key).join(",")}]`,
  );
  check(rows.length === 3, `npm 的 a/x + bun 的 b,pnpm 的 a 与 npm 去重,共 3 行,实际 ${rows.length}`);
  check(
    reg.rowManagerDisplayName("pnpm") === "npm" && reg.rowManagerDisplayName("winget") === "winget",
    "管理器列展示名:pnpm→npm,非 npm 系不受影响",
  );

  // bun 独有的 b:key 前缀是 npm,findSelected 应回退定位到 bun 状态
  const found = reg.findSelected(ALL_MANAGERS, "npm:b");
  check(found !== null && found.state.name === "bun", "npm:b 定位到实际管理器 bun(操作用 bun 执行)");
  const foundNpm = reg.findSelected(ALL_MANAGERS, "npm:a");
  check(foundNpm !== null && foundNpm.state.name === "npm", "npm:a 仍定位到 npm 自身");
});

test("合并开关关闭(默认):行为不变", () => {
  const reg = makeReg(false);
  check(reg.mergedManagerNames().size === 0, "mergedManagerNames 为空");

  const strip = buildStripItems(reg, ALL_MANAGERS, false);
  const mgrNames = strip.filter((i) => i.kind === "manager").map((i) => i.name);
  check(
    mgrNames.includes("npm") && mgrNames.includes("pnpm") && mgrNames.includes("bun"),
    "顶栏仍各自显示 npm/pnpm/bun",
  );

  const rows = buildInstalledRows(reg, baseOpts);
  check(rows.length === 4, `4 行(不去重),实际 ${rows.length}`);
  check(
    rows.some((r) => r.key === "pnpm:a") && rows.some((r) => r.key === "bun:b"),
    "行 key 保留各自管理器前缀",
  );
});
