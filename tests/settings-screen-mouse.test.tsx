/**
 * SettingsScreen 鼠标交互回归测试：
 *  - 单击行 = 选中并激活（管理器行切换启用、完成行关闭）
 *  - 行溢出时滚轮移动光标（光标驱动的滚动窗口）
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { ManagerRegistry } from "../src/runtime";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * stdin 解析器异步处理输入：连发事件会因解析器等待态丢失，须在每次事件后
 * 多轮 tick+loop 消化（一轮 ≈1ms，10 轮 > 解析器 20ms 超时窗口的实测值）。
 */
async function pump(setup: Awaited<ReturnType<typeof testRender>>, rounds = 10) {
  for (let round = 0; round < rounds; round++) {
    await tick();
    await setup.renderOnce();
  }
}

test("设置界面鼠标交互（点击行/滚轮滚动）", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  // 构造即填充全部已注册管理器（行序列：5 管理器 + 语言 + 检查全部 + 打开目录 + 完成 = 9 行）
  const reg = new ManagerRegistry();
  let closed: string | null = null;

  // 小终端（height=10）→ 模态框只给行区 2 行空间，列表必然溢出
  const setup = await testRender(
    <SettingsScreen
      reg={reg}
      onClose={(r) => {
        closed = r === null ? "cancel" : "done";
      }}
      onToast={() => {}}
    />,
    { width: 80, height: 10 },
  );

  try {
    await setup.renderOnce();

    // 滚轮向下多滚几次 → 光标一路下移，滚动窗口跟随到列表底部
    // （小终端 height=10 下模态框压掉行区上边距，行区在 y=3..4，滚轮须落在行区内；
    //   光标钳到末行后窗口停在 (o)/完成，行区只有 2 行放不下 (a)）
    for (let n = 0; n < 4; n++) {
      await act(async () => {
        await setup.mockMouse.scroll(40, 4, "down");
      });
      await pump(setup);
    }
    const frameBottom = setup.captureCharFrame();
    check(
      frameBottom.includes("(o)") && frameBottom.includes("完成"),
      "滚轮滚动后窗口移到列表底部",
    );

    // 找到"完成"行（[ … ] 结尾且非 (a)/(o) 行）并点击 → 关闭并回传结果
    const doneLine = frameBottom
      .split("\n")
      .find((l) => /\[.*\]\s*$/.test(l.trim()) && !l.includes("(a)") && !l.includes("(o)"));
    check(doneLine !== undefined, `找到完成行（${doneLine?.trim() ?? "?"}）`);
    const doneY = doneLine !== undefined ? frameBottom.split("\n").indexOf(doneLine) : -1;
    if (doneY >= 0) {
      await act(async () => {
        await setup.mockMouse.click(10, doneY);
      });
      await pump(setup);
      check(closed === "done", "点击完成行关闭设置界面");
    }

    // 滚轮向上滚回顶部 → 回到初始窗口（顶行高亮区不再含 (a)）
    for (let n = 0; n < 4; n++) {
      await act(async () => {
        await setup.mockMouse.scroll(40, 4, "up");
      });
      await pump(setup);
    }
    const frameTop = setup.captureCharFrame();
    check(!frameTop.includes("(a)") && frameTop.includes("bun"), "滚轮向上滚动后窗口回到顶部");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});
