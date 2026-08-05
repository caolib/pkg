/**
 * Windows Terminal OSC 9;4 进度序列（标签页图标 / 任务栏转圈）。
 *
 * 耗时任务开始时写入"不确定进度"（state=3，转圈动画），结束时清除（state=0）。
 * 不支持的终端按 OSC 规范静默忽略；stdout 非 TTY（管道/重定向）时不写，
 * 所有写入 try/catch 兜底——纯交互优化，任何失败都不得影响应用主流程。
 *
 * 多个并发来源（opLog 命令任务、首页加载）共用引用计数：0→1 才开始转圈、
 * 1→0 才清除，重叠任务不会互相提前关掉对方的转圈。进程退出时兜底清除，
 * 避免标签页残留转圈动画。
 */

import { opLog } from "./ops";

const OSC_INDETERMINATE = "\x1b]9;4;3;\x07";
const OSC_CLEAR = "\x1b]9;4;0;\x07";

/** 进行中的任务数（>0 时终端处于转圈状态） */
let depth = 0;

function write(seq: string): void {
  try {
    // 输出被管道/重定向时不写转义序列，避免污染下游
    if (!process.stdout.isTTY) return;
    process.stdout.write(seq);
  } catch {
    // 终端不可写等任何异常一律忽略
  }
}

/**
 * 开始一个耗时任务（首个任务触发终端转圈）。
 * 返回一次性结束回调，任务结束务必调用（try/finally 或 effect cleanup）。
 */
export function beginTerminalProgress(): () => void {
  if (depth++ === 0) write(OSC_INDETERMINATE);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--depth === 0) write(OSC_CLEAR);
  };
}

/**
 * 让 opLog 的"存在运行中条目"驱动转圈：安装/更新/卸载命令自动覆盖，
 * 无需各调用点手动 begin/end。返回清理函数（取消订阅并结束转圈）。
 */
export function trackOpLogProgress(): () => void {
  let end: (() => void) | null = null;
  const sync = () => {
    const running = opLog.entries.some((e) => e.status === "running");
    if (running && !end) {
      end = beginTerminalProgress();
    } else if (!running && end) {
      end();
      end = null;
    }
  };
  const unsubscribe = opLog.subscribe(sync);
  sync(); // 对齐订阅前已在运行的条目
  return () => {
    unsubscribe();
    if (end) {
      end();
      end = null;
    }
  };
}

// 进程退出兜底：无论以何种方式退出（Ctrl+C/异常），清掉残留的转圈状态
process.on("exit", () => {
  if (depth > 0) {
    depth = 0;
    write(OSC_CLEAR);
  }
});
