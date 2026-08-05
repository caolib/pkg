/**
 * 命令执行日志（"命令输出"界面数据源）。
 *
 * 安装/更新/卸载等操作执行时，由 _cli.runCommand 以 { log: true } 将子进程的
 * stdout/stderr 逐行追加进 OpLog 条目（新条目在最前）。UI 层（OutputScreen）
 * 通过 subscribe 订阅变化实时刷新，实现类似 opencode 子代理输出的查看体验：
 * 运行中输出实时追加、自动跟随到底部，可随时查看历史记录。
 *
 * 本模块不依赖 @opentui 与 react，可独立测试（tests/ops.test.ts）。
 */

import { t } from "./i18n";

export type OpLogStream = "out" | "err" | "info";

export interface OpLogLine {
  stream: OpLogStream;
  text: string;
}

export type OpStatus = "running" | "success" | "failed" | "cancelled";

/** 一条命令执行记录。 */
export interface OpLogEntry {
  id: number;
  /** 展示标题：实际执行的命令文本（如 "npm install -g typescript"） */
  title: string;
  status: OpStatus;
  /** 按到达顺序合并的 stdout/stderr/info 行 */
  lines: OpLogLine[];
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  /** 可执行文件名（如 "npm"），由 _cli.runCommand 在 log:true 时注入。
   *  供"命令输出"界面失败后重试/提权重试用；纯查询类不注入。 */
  executable?: string;
  /** 命令参数数组（如 ["install","-g","foo"]），由 _cli.runCommand 注入。
   *  与 executable 配套用于重试。 */
  args?: string[];
  /** 终止该命令子进程的回调（由 _cli.runCommand 注入）。运行中时可被
   *  cancel() 调用;调用后置空,防重复终止。只读 UI 不应直接调用此字段,
   *  统一经 opLog.cancel() 以确保状态一致。 */
  cancel?: () => void;
}

/** 最多保留的条目数（超出丢弃最旧的） */
const MAX_ENTRIES = 30;
/** 单条目最多保留的行数（超出丢旧行并插入截断标记） */
const MAX_LINES = 3000;
/** 单行超过此长度按此长度切段（防止超长 JSON 等拖慢布局） */
const MAX_LINE_CHARS = 4096;
/** 无换行段的累积上限：超过强制落行，防止 \r 进度帧无限累积撑爆内存 */
const MAX_PENDING_CHARS = 16384;
const TRUNCATED_MARK = "… (output truncated)";

const _ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const _OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const _CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** 清洗一行输出：去 ANSI/OSC 转义与控制字符，制表符转双空格。 */
function cleanLine(text: string): string {
  return text.replace(_OSC_RE, "").replace(_ANSI_RE, "").replace(_CTRL_RE, "").replace(/\t/g, "  ");
}

export class OpLog {
  /** 最近条目（新在前） */
  entries: OpLogEntry[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();
  /** 未结束行的跨 chunk 累积缓冲（stream 未到 \n 的残余） */
  private pending = new WeakMap<OpLogEntry, { out: string; err: string }>();

  /** 订阅日志变化（新条目/追加输出/状态变更都会通知）。返回取消订阅函数。 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 清空全部条目（测试用）。 */
  clear(): void {
    this.entries = [];
    this.nextId = 1;
    this.pending = new WeakMap();
    this.notify();
  }

  /** 开始一条命令执行记录，返回条目（新条目在最前）。
   *  meta 可携带 executable/args 结构化信息（由 _cli.runCommand 在
   *  log:true 时注入），供"命令输出"界面失败后重试/提权重试直接读取，
   *  而不必反解析 title。meta 可选以兼容测试中 `begin("x")` 调用。 */
  begin(title: string, meta?: { executable?: string; args?: string[] }): OpLogEntry {
    const entry: OpLogEntry = {
      id: this.nextId++,
      title,
      status: "running",
      lines: [],
      exitCode: null,
      startedAt: Date.now(),
      finishedAt: null,
      executable: meta?.executable,
      args: meta?.args,
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.pop();
    this.notify();
    return entry;
  }

  /** 追加一段子进程输出（跨 chunk 自动拼行，\r 进度帧折叠）。 */
  appendText(entry: OpLogEntry, stream: "out" | "err", text: string): void {
    if (entry.status !== "running") return;
    const pending = this.pending.get(entry) ?? { out: "", err: "" };
    const buf = pending[stream] + text;
    const parts = buf.split(/\r\n|\n/);
    for (let i = 0; i < parts.length - 1; i++) this.pushLine(entry, stream, parts[i]);
    const tail = parts[parts.length - 1];
    if (tail.length > MAX_PENDING_CHARS) {
      // 极长的无换行段（进度帧累积等）：直接落行为一行，避免内存膨胀
      this.pushLine(entry, stream, tail);
      pending[stream] = "";
    } else {
      pending[stream] = tail;
    }
    this.pending.set(entry, pending);
    this.notify();
  }

  /** 正常结束：以退出码标记成功/失败并收尾未完成的行。 */
  finish(entry: OpLogEntry, exitCode: number): void {
    if (entry.status !== "running") return;
    this.flushPending(entry);
    entry.exitCode = exitCode;
    entry.status = exitCode === 0 ? "success" : "failed";
    entry.finishedAt = Date.now();
    this.notify();
  }

  /** 异常失败：写入错误行并标记失败。 */
  fail(entry: OpLogEntry, message: string): void {
    if (entry.status !== "running") return;
    this.flushPending(entry);
    if (message) this.pushLine(entry, "info", message);
    entry.exitCode = null;
    entry.status = "failed";
    entry.finishedAt = Date.now();
    this.notify();
  }

  /** 最近一条（最新），无记录返回 null。 */
  latest(): OpLogEntry | null {
    return this.entries[0] ?? null;
  }

  /** 由 _cli.runCommand 在 spawn 后注入终止回调（kill 子进程）。 */
  setCancel(entry: OpLogEntry, fn: () => void): void {
    if (entry.status !== "running") return;
    entry.cancel = fn;
  }

  /** 用户终止运行中的任务：kill 子进程,标记 cancelled,写一行说明并通知。
   *  非运行中条目无操作（幂等）。子进程的 kill 由注入的 cancel 回调执行,
   *  这里的职责是状态机推进——_cli.runCommand 检测到 status 不再是 running
   *  后会抛 ManagerError(terminated),由上层 doUpdateAll 等的 catch 记为失败。 */
  cancel(entry: OpLogEntry): void {
    if (entry.status !== "running") return;
    try {
      entry.cancel?.();
    } catch {
      // ignore: kill 失败不阻塞状态推进
    }
    entry.cancel = undefined;
    this.flushPending(entry);
    entry.exitCode = null;
    entry.status = "cancelled";
    entry.finishedAt = Date.now();
    this.pushLine(entry, "info", t("output.cancelled_by_user"));
    this.notify();
  }

  // ------------------------------------------------------------------

  private flushPending(entry: OpLogEntry): void {
    const pending = this.pending.get(entry);
    if (!pending) return;
    for (const stream of ["out", "err"] as const) {
      if (pending[stream]) {
        this.pushLine(entry, stream, pending[stream]);
        pending[stream] = "";
      }
    }
  }

  private pushLine(entry: OpLogEntry, stream: OpLogStream, raw: string): void {
    // \r 进度帧只保留最后一段（"0%\r50%\r100%" → "100%"）
    const segs = raw.split("\r");
    let line = segs[segs.length - 1];
    if (line === "" && segs.length > 1) line = segs[segs.length - 2];
    let clean = cleanLine(line);
    if (!clean) return;
    // 单行总长封顶到容量上限，保证 nChunks ≤ MAX_LINES（keep 恒非负）
    if (clean.length > MAX_LINE_CHARS * MAX_LINES)
      clean = clean.slice(0, MAX_LINE_CHARS * MAX_LINES);
    const lines = entry.lines;
    const nChunks = Math.ceil(clean.length / MAX_LINE_CHARS);
    // 满时一次腾出全部空间（TRUNCATED_MARK + 各段），再逐段写入——
    // 逐段截断会在每次 splice 后把保留的最旧真实行覆盖成标记，每段多丢一行
    if (lines.length + nChunks > MAX_LINES) {
      const keep = Math.max(0, MAX_LINES - nChunks);
      lines.splice(0, lines.length - keep);
      if (keep > 0) lines[0] = { stream: "info", text: TRUNCATED_MARK };
    }
    for (let i = 0; i < clean.length; i += MAX_LINE_CHARS) {
      lines.push({ stream, text: clean.slice(i, i + MAX_LINE_CHARS) });
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

/** 全局命令日志单例（_cli 写入、OutputScreen 读取）。 */
export const opLog = new OpLog();
