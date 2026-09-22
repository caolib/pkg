/**
 * 设置界面"管理器版本号"显示回归测试。
 *
 * 每行管理器显示：名称 | 版本号 | 检测状态 | 启用/禁用。版本号来自
 * `ManagerRegistry.loadVersions`（各管理器 `<cli> --version`，缓存在 state 上），
 * 这里预置缓存值以避开真实进程：已安装的显示版本号，未安装的留空。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { ManagerRegistry } from "../src/runtime";

test("设置界面显示已安装管理器的版本号", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  const reg = new ManagerRegistry();
  // npm 已安装且版本号已探测过（预置缓存 → effect 不会再去起进程）
  const npm = reg.states.get("npm")!;
  npm.available = true;
  npm.checked = true;
  npm.version = "11.11.0";
  // scoop 未安装
  const scoop = reg.states.get("scoop")!;
  scoop.available = false;
  scoop.checked = true;

  const setup = await testRender(
    <SettingsScreen reg={reg} onClose={() => {}} onToast={() => {}} />,
    { width: 80, height: 20 },
  );

  try {
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    const npmLine = lines.find((l) => l.trim().startsWith("npm "))?.trim() ?? "";
    const scoopLine = lines.find((l) => l.trim().startsWith("scoop"))?.trim() ?? "";
    console.log(`  |${npmLine}|`);
    console.log(`  |${scoopLine}|`);

    check(lines.some((l) => l.includes("11.11.0")), "界面上出现已安装管理器的版本号");
    check(npmLine.includes("11.11.0"), "版本号显示在对应管理器行内");
    check(!/\d+\.\d+\.\d+/.test(scoopLine), "未安装的管理器不显示版本号");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});
