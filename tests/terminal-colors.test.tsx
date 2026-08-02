/**
 * terminal-colors 背景色缓存回归测试。
 *
 * overlay（搜索界面等）在初始化时用 getTerminalBackgroundSync() 同步读缓存，
 * 避免先渲染一帧 FALLBACK_BACKGROUND（深色）再切到真实背景造成闪烁。
 * 主页打开时已调 getTerminalBackground 触发缓存，overlay 挂载时同步值须立即可用。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { getTerminalBackground, getTerminalBackgroundSync } from "../src/terminal-colors";

test("getTerminalBackgroundSync 缓存可用性", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  // 用 testRender 拿到一个 CliRenderer（有 getPalette）；渲染一个空 box
  const setup = await testRender(<box />, { width: 40, height: 8 });
  try {
    const syncBefore = getTerminalBackgroundSync();
    check(
      syncBefore === null || typeof syncBefore === "string",
      "检测前同步值 null 或已有缓存字符串",
    );

    const bg = await getTerminalBackground(setup.renderer);
    const syncAfter = getTerminalBackgroundSync();
    check(syncAfter === bg, `检测后同步值等于异步值（${bg}）`);
    check(syncAfter !== null, "检测后同步缓存非空（overlay 可同步初始化避免闪烁）");
  } finally {
    setup.renderer.destroy();
  }
});
