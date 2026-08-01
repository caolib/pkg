/**
 * buildSearchGroups 搜索分组回归测试。
 *
 * 验证"全部"搜索会并发各 registry 代表：npm 系（npm/pnpm/bun）合成一组用 npm 搜，
 * 不同 registry（scoop/winget）各自独立成组单独搜。曾反馈"全部只搜了 npm，scoop
 * 没搜"——若分组逻辑把 scoop 漏掉，本测试会失败。
 *
 * 运行：bun test
 */
import { test } from "bun:test"
import { buildSearchGroups } from "../src/runtime"
import type { PackageManager } from "../src/managers/base"

function mk(name: string, registry: string | null): PackageManager {
  return { name, registry } as unknown as PackageManager
}

test("buildSearchGroups registry 分组去重", () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg)
    console.log("  ✓", msg)
  }

  const managers = [
    mk("npm", "npm"),
    mk("pnpm", "npm"),
    mk("bun", "npm"),
    mk("scoop", null),
    mk("winget", null),
  ]
  const { groups, repMap } = buildSearchGroups(managers)

  // 三组：npm 系合 1 组 + scoop + winget 各 1 组
  check(groups.length === 3, `分组数 = 3（npm 系/scoop/winget），实际 ${groups.length}`)

  const npmGroup = groups.find((g) => g.rep.name === "npm")
  check(npmGroup !== undefined, "npm 系合成一组，代表为 npm")
  check(
    !!npmGroup && npmGroup.members.map((m) => m.name).sort().join(",") === "bun,npm,pnpm",
    "npm 组成员 = bun/npm/pnpm",
  )
  check(
    !!npmGroup && npmGroup.sourceLabel === "npm",
    `npm 组来源标注只显示代表名 "npm"（而非 "bun/npm/pnpm"）`,
  )

  const scoopGroup = groups.find((g) => g.rep.name === "scoop")
  check(scoopGroup !== undefined, "scoop 独立成组（registry=null）")
  check(!!scoopGroup && scoopGroup.members.length === 1, "scoop 组只含 scoop 自己")
  check(!!scoopGroup && scoopGroup.sourceLabel === "scoop", "scoop 组来源标注 = scoop")

  const wingetGroup = groups.find((g) => g.rep.name === "winget")
  check(wingetGroup !== undefined, "winget 独立成组")

  // "全部" 搜索 = 并发所有组的 rep.search：必须含 scoop/winget
  const reps = groups.map((g) => g.rep.name)
  check(
    reps.includes("npm") && reps.includes("scoop") && reps.includes("winget"),
    `"全部"搜索的 rep 含 npm/scoop/winget（${reps.join(",")}）`,
  )

  check(repMap.has("scoop") && repMap.has("winget"), "repMap 含 scoop/winget")
})
