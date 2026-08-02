/**
 * 命令输出界面（OutputScreen）渲染回归测试。
 *
 * 用 @opentui/react/test-utils 验证：空态提示、运行中/成功/失败条目的实时
 * 渲染（输出行追加、状态与退出码显示）、↑↓ 切换条目、Esc 关闭回调。
 * 依赖 opLog 单例（begin/appendText/finish/fail 触发订阅重渲染）。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { OutputScreen } from "../src/screens/OutputScreen";
import { opLog } from "../src/ops";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** stdin 解析器异步处理输入，事件后须多轮 tick+render 消化（同鼠标测试约定）。 */
async function pump(setup: Awaited<ReturnType<typeof testRender>>, rounds = 10) {
  for (let round = 0; round < rounds; round++) {
    await tick();
    await setup.renderOnce();
  }
}

test("命令输出界面：空态 + 实时追加 + 状态/退出码 + ↑↓ 切换 + Esc 关闭", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  opLog.clear();
  let closed = 0;
  const setup = await testRender(<OutputScreen onClose={() => closed++} />, {
    width: 100,
    height: 24,
  });
  try {
    await setup.renderOnce();
    let f = setup.captureCharFrame();
    check(f.includes("命令输出") || f.includes("Command Output"), "界面标题渲染");
    check(
      f.includes("暂无命令执行记录") || f.includes("No command output yet"),
      "空态提示（无任何记录时）",
    );

    // 运行中的记录 + 实时输出行
    await act(async () => {
      opLog.begin("npm install -g foo");
    });
    await setup.renderOnce();
    f = setup.captureCharFrame();
    check(f.includes("npm install -g foo"), "新条目实时出现在列表");
    check(f.includes("运行中") || f.includes("Running"), "运行中状态显示");

    await act(async () => {
      opLog.appendText(opLog.entries[0], "out", "added 1 package in 2s\n");
    });
    await setup.renderOnce();
    f = setup.captureCharFrame();
    check(f.includes("added 1 package in 2s"), "输出行实时追加到输出区");

    // 成功结束：状态 + 退出码
    await act(async () => {
      opLog.finish(opLog.entries[0], 0);
    });
    await setup.renderOnce();
    f = setup.captureCharFrame();
    check(f.includes("成功") || f.includes("Success"), "完成后状态切换为成功");
    check(f.includes("退出码 0") || f.includes("exit code 0"), "显示退出码 0");

    // 第二条失败记录（新在前，列表出现 ✗）
    await act(async () => {
      const e = opLog.begin("scoop update bar");
      opLog.fail(e, "boom");
    });
    await setup.renderOnce();
    f = setup.captureCharFrame();
    check(f.includes("scoop update bar"), "新条目插到列表顶部");
    check(f.includes("失败") || f.includes("Failed"), "选中失败条目显示失败状态");
    check(f.includes("boom"), "失败原因（info 行）显示在输出区");

    // ↑↓ 在条目间切换：↓ 选到成功条目（状态行切为成功 + 退出码 0）
    await act(async () => {
      setup.mockInput.pressArrow("down");
    });
    await pump(setup);
    f = setup.captureCharFrame();
    check(
      (f.includes("成功") || f.includes("Success")) &&
        (f.includes("退出码 0") || f.includes("exit code 0")),
      "↓ 切到成功条目，状态行随之切换",
    );
    // ↑ 切回失败条目
    await act(async () => {
      setup.mockInput.pressArrow("up");
    });
    await pump(setup);
    f = setup.captureCharFrame();
    check(f.includes("失败") || f.includes("Failed"), "↑ 切回失败条目");

    // Esc 关闭
    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await pump(setup);
    check(closed === 1, "Esc 触发 onClose");
  } finally {
    opLog.clear();
    setup.renderer.destroy();
  }
});
