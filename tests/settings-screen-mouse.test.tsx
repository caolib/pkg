/**
 * SettingsScreen 鼠标交互回归测试:
 *  - 单击行 = 选中并激活(管理器行切换启用)
 *  - 行溢出时滚轮移动光标(光标驱动的滚动窗口)
 *
 * 运行:bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { ManagerRegistry } from "../src/runtime";
import { dispWidthStr } from "../src/width";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * stdin 解析器异步处理输入:连发事件会因解析器等待态丢失,须在每次事件后
 * 多轮 tick+loop 消化(一轮 ≈1ms,10 轮 > 解析器 20ms 超时窗口的实测值)。
 */
async function pump(setup: Awaited<ReturnType<typeof testRender>>, rounds = 10) {
  for (let round = 0; round < rounds; round++) {
    await tick();
    await setup.renderOnce();
  }
}

test("设置界面鼠标交互(点击行/滚轮滚动)", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  // 构造即填充全部已注册管理器(行序列:管理器 + 语言 + 合并 npm 系)
  const reg = new ManagerRegistry();
  let closed: string | null = null;

  // 小终端(height=10)→ 模态框只给行区 2 行空间,列表必然溢出
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

    // 滚轮向下多滚几次 → 光标一路下移,滚动窗口跟随到列表底部
    for (let n = 0; n < 4; n++) {
      await act(async () => {
        await setup.mockMouse.scroll(40, 4, "down");
      });
      await pump(setup);
    }
    const frameBottom = setup.captureCharFrame();
    check(frameBottom.includes("合并 npm 系"), "滚轮滚动后窗口移到列表底部");

    // 点击"合并 npm 系"行 → 切换开关(不关闭界面)
    const mergeLine = frameBottom.split("\n").find((l) => l.includes("合并 npm 系"));
    check(mergeLine !== undefined, "找到合并 npm 系行");
    const mergeY = mergeLine !== undefined ? frameBottom.split("\n").indexOf(mergeLine) : -1;
    const before = reg.mergeNpmManagers;
    if (mergeY >= 0) {
      await act(async () => {
        await setup.mockMouse.click(10, mergeY);
      });
      await pump(setup);
      check(reg.mergeNpmManagers === !before, "点击合并 npm 系行切换开关");
    }

    // 滚轮向上滚回顶部 → 回到初始窗口
    for (let n = 0; n < 4; n++) {
      await act(async () => {
        await setup.mockMouse.scroll(40, 4, "up");
      });
      await pump(setup);
    }
    const frameTop = setup.captureCharFrame();
    check(frameTop.includes("bun"), "滚轮向上滚动后窗口回到顶部");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("设置界面右下角关闭按钮:点击关闭并回传结果", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  const reg = new ManagerRegistry();
  let closed: string | null = null;

  const setup = await testRender(
    <SettingsScreen
      reg={reg}
      onClose={(r) => {
        closed = r === null ? "cancel" : "done";
      }}
      onToast={() => {}}
    />,
    { width: 80, height: 20 },
  );

  try {
    await setup.renderOnce();
    await pump(setup);
    const frame = setup.captureCharFrame();
    const lines = frame.split("\n");
    const footerLine = lines.find((l) => l.includes("关闭"));
    check(footerLine !== undefined, "底栏渲染出关闭按钮");
    if (footerLine) {
      // 按钮文本是自绘 <text>,点击须落在其显示宽度范围内(CJK 全角占 2 列)
      const y = lines.indexOf(footerLine);
      const x = dispWidthStr(footerLine.slice(0, footerLine.indexOf("关闭")));
      await act(async () => {
        await setup.mockMouse.click(x, y);
      });
      await pump(setup);
      check(closed === "done", "点击关闭按钮关闭界面并回传结果");
    }
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});
