/**
 * terminal-progress（Windows Terminal OSC 9;4 转圈）测试。
 *
 * 验证：引用计数（0→1 才写开始、1→0 才写清除）、非 TTY 不写、写入异常
 * 不外抛（绝不影响主流程）、trackOpLogProgress 随 opLog 运行中条目启停。
 * 通过临时替换 process.stdout.write / isTTY 观察写入。
 *
 * 运行：bun test
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { beginTerminalProgress, trackOpLogProgress } from "../src/terminal-progress";
import { opLog } from "../src/ops";

const OSC_START = "\x1b]9;4;3;\x07";
const OSC_CLEAR = "\x1b]9;4;0;\x07";

let written: string[] = [];
let origWrite: typeof process.stdout.write;
let origIsTTY: boolean | undefined;
/** 为 true 时 stub 抛错（模拟终端不可写） */
let throwOnWrite = false;

beforeEach(() => {
  written = [];
  throwOnWrite = false;
  origWrite = process.stdout.write;
  origIsTTY = process.stdout.isTTY;
  process.stdout.write = ((chunk: unknown) => {
    if (throwOnWrite) throw new Error("stdout broken");
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
});

afterEach(() => {
  process.stdout.write = origWrite;
  Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  opLog.clear();
});

/** 已写入的 OSC 9;4 序列（过滤掉其他输出） */
const oscWrites = () => written.filter((s) => s.startsWith("\x1b]9;4"));

test("引用计数：嵌套任务只在 0→1 写开始、1→0 写清除", () => {
  const end1 = beginTerminalProgress();
  expect(oscWrites()).toEqual([OSC_START]);
  const end2 = beginTerminalProgress(); // 第二个任务叠加：不重复写开始
  expect(oscWrites()).toEqual([OSC_START]);
  end1(); // 还有一个在跑：不清除
  expect(oscWrites()).toEqual([OSC_START]);
  end2(); // 全部结束：清除
  expect(oscWrites()).toEqual([OSC_START, OSC_CLEAR]);
  end2(); // 结束回调幂等：重复调用不再写
  expect(oscWrites()).toEqual([OSC_START, OSC_CLEAR]);
});

test("非 TTY（管道重定向）不写任何序列", () => {
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  const end = beginTerminalProgress();
  end();
  expect(oscWrites()).toEqual([]);
});

test("写入抛错不外抛，不影响主流程", () => {
  throwOnWrite = true;
  const end = beginTerminalProgress();
  expect(() => end()).not.toThrow();
  // 写入失败不影响计数：恢复可写后新一轮仍能正常开始/清除
  throwOnWrite = false;
  const end2 = beginTerminalProgress();
  end2();
  expect(oscWrites()).toEqual([OSC_START, OSC_CLEAR]);
});

test("trackOpLogProgress：opLog 运行中条目驱动启停", () => {
  const stop = trackOpLogProgress();
  expect(oscWrites()).toEqual([]); // 无运行中条目：不转圈
  const e1 = opLog.begin("npm update -g foo");
  expect(oscWrites()).toEqual([OSC_START]);
  const e2 = opLog.begin("scoop update bar"); // 第二条并发：仍只有一次开始
  expect(oscWrites()).toEqual([OSC_START]);
  opLog.finish(e1, 0); // 还剩一条在跑：不清除
  expect(oscWrites()).toEqual([OSC_START]);
  opLog.fail(e2, "boom"); // 全部结束（含失败）：清除
  expect(oscWrites()).toEqual([OSC_START, OSC_CLEAR]);
  stop(); // 清理后不再响应 opLog 变化
  opLog.begin("npm install -g baz");
  expect(oscWrites()).toEqual([OSC_START, OSC_CLEAR]);
});
