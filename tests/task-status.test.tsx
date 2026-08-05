/**
 * 底栏任务状态（TaskStatus）回归测试。
 *
 * 验证：运行中显示转圈 + "{n}个任务"（转圈帧会动）、一批全部成功显示 ✓
 * 并在 successVisibleMs 后隐藏、有失败显示 ✗ 常驻、下一批任务开始时清除
 * 上次终态、clearToken 递增清除已结算终态（按 o 查看输出=已知晓）。
 * 依赖 opLog 单例（begin/finish/fail 触发订阅同步结算并重渲染）。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { TaskStatus } from "../src/components/TaskStatus";
import { opLog } from "../src/ops";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const check = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
};
const isRunning = (f: string) => f.includes("个任务") || f.includes("task");
const isDone = (f: string) => f.includes("✓") && (f.includes("完成") || f.includes("Done"));
const isFailed = (f: string) => f.includes("✗") && (f.includes("失败") || f.includes("Failed"));

test("TaskStatus：转圈+计数 → ✓ 暂显隐藏 / ✗ 常驻 → 新批次清除", async () => {
  opLog.clear();
  const outcomes: ("success" | "failed" | null)[] = [];
  const setup = await testRender(
    <TaskStatus successVisibleMs={150} onOutcomeChange={(o) => outcomes.push(o)} />,
    { width: 30, height: 1 },
  );
  try {
    await setup.renderOnce();
    check(setup.captureCharFrame().trim() === "", "初始无任务时不显示任何状态");

    // 两条并发任务：计数 2
    let e1!: ReturnType<typeof opLog.begin>;
    let e2!: ReturnType<typeof opLog.begin>;
    await act(async () => {
      e1 = opLog.begin("npm update -g foo");
      e2 = opLog.begin("scoop update bar");
    });
    await setup.renderOnce();
    let f = setup.captureCharFrame();
    check(f.includes("2个任务") || f.includes("2 tasks"), "两条运行中条目显示计数 2");
    const spinner0 = f.trim().charAt(0);

    // 转圈帧会动（轮询最多 1s，避免事件循环延迟抖动）
    let spun = false;
    for (let i = 0; i < 10 && !spun; i++) {
      await act(async () => {
        await tick(100);
      });
      await setup.renderOnce();
      spun = setup.captureCharFrame().trim().charAt(0) !== spinner0;
    }
    check(spun, "转圈动画帧随时间变化");

    // 一条完成、一条仍在跑：仍是运行中，计数 1
    await act(async () => {
      opLog.finish(e1, 0);
    });
    await setup.renderOnce();
    f = setup.captureCharFrame();
    check(
      (f.includes("1个任务") || f.includes("1 task")) && isRunning(f),
      "部分完成时仍显示运行中（计数 1）",
    );

    // 全部成功：✓ 完成，150ms（successVisibleMs）后隐藏
    await act(async () => {
      opLog.finish(e2, 0);
    });
    await setup.renderOnce();
    check(isDone(setup.captureCharFrame()), "全部成功显示 ✓ 完成");
    await act(async () => {
      await tick(300);
    });
    await setup.renderOnce();
    check(setup.captureCharFrame().trim() === "", "成功状态到时长后自动隐藏");

    // 失败：✗ 常驻（超过成功隐藏时长也不消失）
    let e3!: ReturnType<typeof opLog.begin>;
    await act(async () => {
      e3 = opLog.begin("npm uninstall -g foo");
    });
    await act(async () => {
      opLog.fail(e3, "boom");
    });
    await setup.renderOnce();
    check(isFailed(setup.captureCharFrame()), "失败显示 ✗ 失败");
    await act(async () => {
      await tick(400);
    });
    await setup.renderOnce();
    check(isFailed(setup.captureCharFrame()), "失败状态常驻（不自动隐藏）");

    // 下一批开始：清除失败态，回到转圈运行中
    let e4!: ReturnType<typeof opLog.begin>;
    await act(async () => {
      e4 = opLog.begin("npm install -g baz");
    });
    await setup.renderOnce();
    f = setup.captureCharFrame();
    check(isRunning(f) && !f.includes("✗"), "新批次开始时清除上次失败状态");

    // 非零退出码也记为失败
    await act(async () => {
      opLog.finish(e4, 1);
    });
    await setup.renderOnce();
    check(isFailed(setup.captureCharFrame()), "非零退出码标记为失败");

    // onOutcomeChange 回调序列：挂载 null → 成功 → 隐藏清除 → 失败 → 新批次清除 → 失败
    check(
      JSON.stringify(outcomes) ===
        JSON.stringify([null, "success", null, "failed", null, "failed"]),
      `onOutcomeChange 终态迁移序列正确（实际 ${JSON.stringify(outcomes)}）`,
    );
  } finally {
    opLog.clear();
    setup.renderer.destroy();
  }
});

test("clearToken 递增清除已结算的终态（按 o 查看输出=已知晓）", async () => {
  let bump: () => void = () => {};
  function Harness() {
    const [token, setToken] = useState(0);
    bump = () => setToken((n) => n + 1);
    return <TaskStatus clearToken={token} />;
  }

  opLog.clear();
  const setup = await testRender(<Harness />, { width: 30, height: 1 });
  try {
    // 制造失败：✗ 常驻
    await act(async () => {
      const e = opLog.begin("npm uninstall -g foo");
      opLog.fail(e, "boom");
    });
    await setup.renderOnce();
    check(isFailed(setup.captureCharFrame()), "失败显示 ✗ 常驻");

    // 按 o 查看输出 → clearToken 递增 → 终态清除
    await act(async () => {
      bump();
    });
    await setup.renderOnce();
    check(setup.captureCharFrame().trim() === "", "clearToken 递增后终态清除");

    // 清除不影响后续批次：新任务仍正常结算
    await act(async () => {
      const e = opLog.begin("npm update -g bar");
      opLog.finish(e, 0);
    });
    await setup.renderOnce();
    check(isDone(setup.captureCharFrame()), "清除后新批次仍正常显示 ✓");
  } finally {
    opLog.clear();
    setup.renderer.destroy();
  }
});
