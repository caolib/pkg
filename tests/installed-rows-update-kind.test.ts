/**
 * buildInstalledRows 回填 updateKind 的集成回归测试。
 *
 * 主界面"最新版本"列的符号与颜色取自 InstalledRow.updateKind（version-diff.ts 定档）。
 * 这里守住三条容易回归的边界：
 *  - 有更新 → 对应档位；
 *  - "已检测但无更新"（latestVersion 回填为当前版本）与"未检测"（latestVersion 空）
 *    都必须是 null——否则最新版本列会平白多出符号/颜色；
 *  - 仅预发布差异（hasUpdate=true 但 updateKind=null）仍算"可更新"：
 *    filterUpdates 过滤必须继续按 hasUpdate，不能改用 updateKind。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { ALL_MANAGERS, ManagerRegistry, buildInstalledRows } from "../src/runtime";

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
}

/** 构造注册表：npm 可用且已检测过时（5 个包覆盖各档位），winget 可用但未检测过时。 */
function makeReg(): ManagerRegistry {
  const reg = new ManagerRegistry();
  reg.mergeNpmManagers = false;
  for (const st of reg.states.values()) {
    st.checked = true;
    st.available = ["npm", "winget"].includes(st.name);
    st.loadedInstalled = true;
    st.loadedOutdated = true;
  }
  const pkg = (name: string, version: string) => ({
    name,
    version,
    display_name: "",
    latest_version: null,
    description: "",
  });
  const outdated = (name: string, version: string, latest: string) => ({
    ...pkg(name, version),
    latest_version: latest,
  });
  const npm = reg.states.get("npm")!;
  npm.installed = [
    pkg("maj", "1.0.0"),
    pkg("min", "1.0.0"),
    pkg("pat", "1.0.0"),
    pkg("pre", "1.0.0"),
    pkg("uptodate", "1.0.0"),
  ];
  npm.outdated = [
    outdated("maj", "1.0.0", "2.0.0"),
    outdated("min", "1.0.0", "1.1.0"),
    outdated("pat", "1.0.0", "1.0.1"),
    outdated("pre", "1.0.0", "1.0.0-beta.1"),
  ];
  npm.outdatedMap = new Map(npm.outdated.map((p) => [p.name, p]));

  const winget = reg.states.get("winget")!;
  winget.loadedOutdated = false; // 未检测过时 → latestVersion 空
  winget.installed = [pkg("unchecked", "1.0.0")];
  return reg;
}

const baseOpts = {
  current: ALL_MANAGERS,
  filterUpdates: false,
  filterText: "",
  checkedKeys: new Set<string>(),
  isAll: true,
};

test("buildInstalledRows：有更新按跨度定档", () => {
  const rows = buildInstalledRows(makeReg(), baseOpts);
  const byName = new Map(rows.map((r) => [r.pkg.name, r]));
  const kind = (n: string) => byName.get(n)?.updateKind;
  const latest = (n: string) => byName.get(n)?.latestVersion;

  check(kind("maj") === "major" && latest("maj") === "2.0.0", "1.0.0→2.0.0 判大版本");
  check(kind("min") === "minor" && latest("min") === "1.1.0", "1.0.0→1.1.0 判中版本");
  check(kind("pat") === "patch" && latest("pat") === "1.0.1", "1.0.0→1.0.1 判小版本");
});

test("buildInstalledRows：无更新/未检测/null 回退不出现符号", () => {
  const rows = buildInstalledRows(makeReg(), baseOpts);
  const byName = new Map(rows.map((r) => [r.pkg.name, r]));

  const uptodate = byName.get("uptodate")!;
  check(
    uptodate.hasUpdate === false &&
      uptodate.latestVersion === "1.0.0" &&
      uptodate.updateKind === null,
    "已检测但无更新：latestVersion=当前版本且不定档",
  );

  const unchecked = byName.get("unchecked")!;
  check(
    unchecked.hasUpdate === false && unchecked.latestVersion === "" && unchecked.updateKind === null,
    "未检测过时：latestVersion 空且不定档",
  );
});

test("buildInstalledRows：仅预发布差异不算档位，但仍算可更新", () => {
  const reg = makeReg();
  const rows = buildInstalledRows(reg, baseOpts);
  const pre = rows.find((r) => r.pkg.name === "pre")!;
  check(pre.hasUpdate === true, "1.0.0→1.0.0-beta.1 仍视为有更新（hasUpdate=true）");
  check(pre.updateKind === null, "仅预发布差异不定档（回退绿、无符号）");

  // 过滤必须按 hasUpdate：预发布更新不能被"仅显示可更新"漏掉
  const filtered = buildInstalledRows(reg, { ...baseOpts, filterUpdates: true });
  check(
    filtered.some((r) => r.pkg.name === "pre"),
    "filterUpdates 仍按 hasUpdate 过滤，预发布更新在列表内",
  );
});
