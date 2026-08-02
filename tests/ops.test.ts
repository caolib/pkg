/**
 * 命令执行日志（ops.OpLog）与 runCommand { log: true } 集成回归测试。
 *
 * 覆盖：跨 chunk 拼行、\r 进度帧折叠、ANSI 清洗、结束收尾、失败标记、
 * 条目/行数上限、订阅通知，以及 runCommand 记录成功/失败/找不到可执行文件。
 *
 * 运行：bun test tests/ops.test.ts
 */
import { test } from "bun:test";
import { OpLog } from "../src/ops";
import { runCommand } from "../src/managers/_cli";
import { opLog } from "../src/ops";

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
}

function linesOf(log: OpLog, id: number): string[] {
  const e = log.entries.find((x) => x.id === id);
  return e ? e.lines.map((l) => l.text) : [];
}

test("OpLog: 跨 chunk 拼行 + \r 进度帧折叠", () => {
  const log = new OpLog();
  const e = log.begin("npm install -g foo");
  // 第一个 chunk 只给了半行
  log.appendText(e, "out", "added 42 pac");
  check(log.latest()?.status === "running", "运行中状态保持 running");
  // 第二个 chunk 补齐该行并带来新行
  log.appendText(e, "out", "kages in 3s\n");
  check(linesOf(log, e.id).length === 1, "跨 chunk 拼成 1 行");
  check(linesOf(log, e.id)[0] === "added 42 packages in 3s", "拼行内容正确");

  // 无换行的 \r 进度帧累积，结束时才落行且只保留最后一帧
  log.appendText(e, "out", "0%\r50%\r100%");
  log.finish(e, 0);
  const lines = linesOf(log, e.id);
  check(lines.length === 2, `结束后 \r 帧落行为 1 行（共 ${lines.length} 行）`);
  check(lines[1] === "100%", `\r 帧只保留最后一段（${JSON.stringify(lines[1])}）`);
  check(e.status === "success" && e.exitCode === 0, "退出码 0 → success");
  check(e.finishedAt !== null, "结束时间已记录");
});

test("OpLog: 行内 \r 帧 + 结尾 \r 的处理", () => {
  const log = new OpLog();
  const e = log.begin("x");
  log.appendText(e, "out", "a\rb\rc\r");
  log.finish(e, 0);
  check(
    linesOf(log, e.id)[0] === "c",
    `行内多帧取最后可见帧（${JSON.stringify(linesOf(log, e.id)[0])}）`,
  );
});

test("OpLog: 结束收尾未完成行", () => {
  const log = new OpLog();
  const e = log.begin("x");
  log.appendText(e, "out", "tail without newline");
  log.finish(e, 0);
  check(linesOf(log, e.id)[0] === "tail without newline", "finish 时冲刷残留行");
  check(e.status === "success", "成功标记");
});

test("OpLog: 非零退出码 → failed；fail() 写入错误行", () => {
  const log = new OpLog();
  const e1 = log.begin("x");
  log.finish(e1, 1);
  check(e1.status === "failed" && e1.exitCode === 1, "非零退出码 → failed");

  const e2 = log.begin("y");
  log.fail(e2, "boom");
  check(e2.status === "failed" && e2.exitCode === null, "fail() → failed 且无退出码");
  check(linesOf(log, e2.id)[0] === "boom", "fail() 写入错误行");
});

test("OpLog: ANSI/控制字符清洗 + 制表符", () => {
  const log = new OpLog();
  const e = log.begin("x");
  log.appendText(e, "out", "\x1b[31mred\x1b[0m \t ok\x1b]0;title\x07\n");
  log.finish(e, 0);
  const line = linesOf(log, e.id)[0];
  check(!line.includes("\x1b"), "ANSI/OSC 转义被清除");
  check(line === "red    ok", `清洗后内容正确（${JSON.stringify(line)}）`);
});

test("OpLog: 条目上限（新在前，超出丢最旧）", () => {
  const log = new OpLog();
  let lastId = 0;
  for (let i = 0; i < 35; i++) lastId = log.begin(`cmd ${i}`).id;
  check(log.entries.length === 30, `条目数封顶 30（实际 ${log.entries.length}）`);
  check(log.entries[0].id === lastId, "最新条目在最前");
  check(!log.entries.some((e) => e.title === "cmd 0"), "最旧条目被丢弃");
});

test("OpLog: 订阅通知", () => {
  const log = new OpLog();
  let count = 0;
  const unsub = log.subscribe(() => count++);
  const e = log.begin("x");
  log.appendText(e, "out", "hello\n");
  log.finish(e, 0);
  check(count >= 3, `begin/append/finish 均触发通知（${count} 次）`);
  unsub();
  log.begin("y");
  const after = count;
  unsub();
  log.begin("z");
  check(after === count, "退订后不再通知");
});

test("OpLog: clear() 清空", () => {
  const log = new OpLog();
  log.begin("x");
  log.clear();
  check(log.entries.length === 0, "clear 后无条目");
});

test("runCommand: { log: true } 记录成功输出", async () => {
  opLog.clear();
  const res = await runCommand("cmd", ["/c", "echo", "hello-oplog"], { log: true });
  check(res.exitCode === 0, "命令执行成功");
  const e = opLog.latest();
  check(e !== null && e.status === "success", "产生 success 条目");
  check(e !== null && e.title === "cmd /c echo hello-oplog", "标题为实际命令");
  const out = e?.lines
    .filter((l) => l.stream === "out")
    .map((l) => l.text.trim())
    .join("\n");
  check(out === "hello-oplog", `stdout 被记录（${JSON.stringify(out)}）`);
});

test("runCommand: 非零退出码 → failed 条目", async () => {
  opLog.clear();
  const res = await runCommand("cmd", ["/c", "exit", "3"], { log: true });
  check(res.exitCode === 3, "退出码 3");
  const e = opLog.latest();
  check(e !== null && e.status === "failed" && e.exitCode === 3, "条目标记 failed 且记录退出码");
});

test("runCommand: 找不到可执行文件 → failed 条目 + 抛错", async () => {
  opLog.clear();
  let threw = false;
  try {
    await runCommand("definitely-not-a-real-exe-xyz", [], { log: true });
  } catch {
    threw = true;
  }
  check(threw, "抛出 ManagerError");
  const e = opLog.latest();
  check(e !== null && e.status === "failed", "条目标记 failed");
  check(e !== null && e.lines.length > 0 && e.lines[0].stream === "info", "失败原因写入 info 行");
});

test("runCommand: 不传 { log: true } 不产生条目", async () => {
  opLog.clear();
  await runCommand("cmd", ["/c", "echo", "x"]);
  check(opLog.entries.length === 0, "查询类命令默认不记录");
});
