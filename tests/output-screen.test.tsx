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

test("命令输出界面：p 终止运行中条目 + cancelled 状态显示 + 幂等", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };
  opLog.clear();
  const setup = await testRender(<OutputScreen onClose={() => {}} />, {
    width: 100,
    height: 24,
  });
  try {
    // 运行中条目（注入 mock kill 回调，模拟 _cli.runCommand 注入的 proc.kill）
    let killed = 0;
    let entry: any;
    await act(async () => {
      entry = opLog.begin("npm install -g slow-pkg");
      opLog.setCancel(entry, () => {
        killed++;
      });
    });
    await setup.renderOnce();
    let f = setup.captureCharFrame();
    check(f.includes("运行中") || f.includes("Running"), "终止前显示运行中");
    check(f.includes("p 终止") || f.includes("p terminate"), "底栏常驻显示 p 终止提示");

    // p 终止
    await act(async () => {
      setup.mockInput.pressKey("p");
    });
    await pump(setup);
    check(killed === 1, "p 触发注入的 kill 回调（终止子进程）");
    f = setup.captureCharFrame();
    check(f.includes("已终止") || f.includes("Terminated"), "终止后显示已终止状态");
    check(
      !(f.includes("p 终止") || f.includes("p terminate")),
      "已终止条目底栏不再显示 p 终止提示（上下文底栏：仅运行中显示）",
    );

    // 幂等：再次 p 不重复 kill
    await act(async () => {
      setup.mockInput.pressKey("p");
    });
    await pump(setup);
    check(killed === 1, "已终止条目再按 p 不重复 kill（幂等）");
  } finally {
    opLog.clear();
    setup.renderer.destroy();
  }
});

test("命令输出界面：长日志按宽度换行，右侧内容不被截断", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };
  opLog.clear();
  // 现实终端宽度：右侧输出区约 60+ 列，word 换行时单词完整不断裂
  const setup = await testRender(<OutputScreen onClose={() => {}} />, {
    width: 100,
    height: 24,
  });
  try {
    await act(async () => {
      opLog.begin("npm install -g foo");
    });
    await setup.renderOnce();
    // 这行约 100 字符，远超右侧输出区宽度。wrapMode="none" 时尾部被截断
    // 不可见；wrapMode="word" 时按宽度换行，尾部内容出现在后续行。
    const longLine =
      "added 3 packages in 2s, and audited 150 packages in 3s, found 0 vulnerabilities, changed 1 thing";
    await act(async () => {
      opLog.appendText(opLog.entries[0], "out", longLine + "\n");
    });
    await pump(setup);
    const f = setup.captureCharFrame();
    check(f.includes("vulnerabilities"), "长日志换行后尾部内容可见（未截断）");
    check(f.includes("changed 1 thing"), "行末内容完整可见");
  } finally {
    opLog.clear();
    setup.renderer.destroy();
  }
});

test("命令输出界面：失败条目底栏显示重试提示 + r/a 触发 onRetry", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };
  opLog.clear();
  const retryCalls: Array<{ executable: string; args: string[]; elevate: boolean }> = [];
  const setup = await testRender(
    <OutputScreen
      onClose={() => {}}
      onRetry={(executable, args, elevate) => retryCalls.push({ executable, args, elevate })}
    />,
    { width: 100, height: 24 },
  );
  try {
    // 失败条目（注入结构化 executable/args，模拟 _cli.runCommand 注入）
    await act(async () => {
      const e = opLog.begin("choco upgrade pkg -y", {
        executable: "choco",
        args: ["upgrade", "pkg", "-y"],
      });
      opLog.fail(e, "permission denied");
    });
    await setup.renderOnce();
    let f = setup.captureCharFrame();
    check(f.includes("失败") || f.includes("Failed"), "失败条目显示失败状态");
    check(f.includes("r 重试") || f.includes("r retry"), "失败条目底栏显示 r 重试提示");
    // win32 下还应显示管理员重试提示
    if (process.platform === "win32") {
      check(
        f.includes("a 管理员重试") || f.includes("a retry as admin"),
        "win32 失败条目底栏显示 a 管理员重试提示",
      );
    }

    // r 重试：触发 onRetry(executable, args, false)
    await act(async () => {
      setup.mockInput.pressKey("r");
    });
    await pump(setup);
    check(
      retryCalls.length === 1 && retryCalls[0].elevate === false,
      "r 触发 onRetry 且 elevate=false",
    );
    check(
      retryCalls[0].executable === "choco" &&
        retryCalls[0].args.length === 3 &&
        retryCalls[0].args[0] === "upgrade",
      "r 传入结构化 executable/args",
    );

    // a 管理员重试：触发 onRetry(executable, args, true)
    await act(async () => {
      setup.mockInput.pressKey("a");
    });
    await pump(setup);
    if (process.platform === "win32") {
      check(
        retryCalls.length === 2 && retryCalls[1].elevate === true,
        "win32 下 a 触发 onRetry 且 elevate=true",
      );
    } else {
      check(retryCalls.length === 1, "非 win32 下 a 不触发 onRetry");
    }
  } finally {
    opLog.clear();
    setup.renderer.destroy();
  }
});

test("命令输出界面：运行中/成功条目按 r/a 不触发 onRetry", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };
  opLog.clear();
  const retryCalls: Array<{ executable: string; args: string[]; elevate: boolean }> = [];
  const setup = await testRender(
    <OutputScreen
      onClose={() => {}}
      onRetry={(executable, args, elevate) => retryCalls.push({ executable, args, elevate })}
    />,
    { width: 100, height: 24 },
  );
  try {
    // 运行中条目：r/a 均不触发
    await act(async () => {
      opLog.begin("npm install -g foo", { executable: "npm", args: ["install", "-g", "foo"] });
    });
    await setup.renderOnce();
    await act(async () => {
      setup.mockInput.pressKey("r");
    });
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressKey("a");
    });
    await pump(setup);
    check(retryCalls.length === 0, "运行中条目按 r/a 不触发 onRetry");

    // 切到成功条目：r/a 仍不触发
    await act(async () => {
      opLog.finish(opLog.entries[0], 0);
    });
    await setup.renderOnce();
    await act(async () => {
      setup.mockInput.pressKey("r");
    });
    await pump(setup);
    check(retryCalls.length === 0, "成功条目按 r 不触发 onRetry");
  } finally {
    opLog.clear();
    setup.renderer.destroy();
  }
});

test("命令输出界面：未注入 executable/args 时回退解析 title 重试", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };
  opLog.clear();
  const retryCalls: Array<{ executable: string; args: string[]; elevate: boolean }> = [];
  const setup = await testRender(
    <OutputScreen
      onClose={() => {}}
      onRetry={(executable, args, elevate) => retryCalls.push({ executable, args, elevate })}
    />,
    { width: 100, height: 24 },
  );
  try {
    // 仅 begin 创建、未注入结构（兼容旧调用）：回退解析 title
    await act(async () => {
      const e = opLog.begin("scoop install foo");
      opLog.fail(e, "boom");
    });
    await setup.renderOnce();
    await act(async () => {
      setup.mockInput.pressKey("r");
    });
    await pump(setup);
    check(
      retryCalls.length === 1 && retryCalls[0].executable === "scoop",
      "回退解析 title 得到 executable",
    );
    check(
      retryCalls[0].args.length === 2 && retryCalls[0].args[0] === "install",
      "回退解析 title 得到 args",
    );
  } finally {
    opLog.clear();
    setup.renderer.destroy();
  }
});
