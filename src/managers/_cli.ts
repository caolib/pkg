/**
 * 通用 CLI 执行辅助。
 *
 * 供各包管理器后端复用，避免重复的 subprocess 和 JSON 解析代码。
 * 用 Bun.spawn 以参数列表形式执行（无 shell 拼接），对齐原 Python 项目
 * 不使用 shell=true 的安全约定。对应原 managers/_cli.py。
 *
 * Windows 特殊处理：winget 等位于 %LOCALAPPDATA%\Microsoft\WindowsApps 的
 * 可执行是 App Execution Alias（0 字节 reparse point 存根），Bun.which 无法
 * 解析、Bun.spawn 直调会报 not found。这类别名只能经 cmd shell 解析，故在
 * Windows 上当 Bun.which 失败时，回退用 `["cmd","/c",exe,...args]` 执行
 * （仍以 argv 数组传参，不经字符串拼接）。
 */

import { t } from "../i18n";
import { opLog } from "../ops";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

export class ManagerError extends Error {}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  /** 将命令执行过程记录到操作日志（"命令输出"界面实时查看用） */
  log?: boolean;
  /** 超时毫秒（0=不超时）。默认 10 分钟：防止卡死的子进程永久挂起
   *  （如旧版 winget 不支持 --disable-interactivity 时停在交互提示）。
   *  超时 kill 子进程并抛 ManagerError。 */
  timeoutMs?: number;
}

/** 默认超时：10 分钟（大包安装/下载也足够，卡死进程早该被杀）。 */
const DEFAULT_TIMEOUT_MS = 600_000;

/** 可执行文件的解析结果：直调 或 经 cmd /c 回退。 */
interface Resolved {
  argv: string[];
  viaCmd: boolean;
}

const _availabilityCache = new Map<string, boolean>();

/**
 * 解析可执行文件为可 spawn 的 argv。
 * 找不到时返回 null。Windows 上对 App Execution Alias 自动回退到 cmd /c。
 */
async function resolveExecutable(executable: string, args: string[]): Promise<Resolved | null> {
  const p = Bun.which(executable);
  if (p) return { argv: [p, ...args], viaCmd: false };

  // Windows App Execution Alias（如 winget）只能经 cmd 解析
  if (process.platform === "win32") {
    // 用 `where` 探测该别名是否可达（where 能解析 WindowsApps 别名）
    const probe = Bun.spawn(["cmd", "/c", "where", executable], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(probe.stdout).text();
    const code = await probe.exited;
    if (code === 0 && out.trim().length > 0) {
      return { argv: ["cmd", "/c", executable, ...args], viaCmd: true };
    }
  }
  return null;
}

/**
 * 异步执行一个 CLI 命令，返回 {stdout, stderr, exitCode}。
 * 找不到可执行文件时抛出 ManagerError(not_found)。
 * opts.log 为 true 时把执行过程实时写入操作日志（ops.opLog），供
 * "命令输出"界面查看——安装/更新/卸载等操作命令请务必传 { log: true }。
 */
export async function runCommand(
  executable: string,
  args: string[],
  opts?: RunOptions,
): Promise<RunResult> {
  const title = `${executable} ${args.join(" ")}`;
  const entry = opts?.log ? opLog.begin(title, { executable, args }) : null;

  const resolved = await resolveExecutable(executable, args);
  if (resolved === null) {
    const err = new ManagerError(t("error.not_found", { exe: executable }));
    if (entry) opLog.fail(entry, err.message);
    throw err;
  }

  const proc = Bun.spawn(resolved.argv, {
    stdout: "pipe",
    stderr: "pipe",
  });
  // 注入终止回调：用户在"命令输出"界面按 p 终止时,opLog.cancel 会调它
  // kill 子进程。kill 失败 try/catch 兜底;后续状态推进由 opLog.cancel 负责。
  if (entry) {
    opLog.setCancel(entry, () => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    });
  }

  // 超时兜底：卡死的子进程（如等交互输入的旧版 winget）不再永久挂起。
  // Windows 上经 cmd /c 包装的子进程 kill 只杀 cmd，实际 exe 可能残留——
  // 尽力而为，比永久挂起可感知得多。
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          try {
            proc.kill();
          } catch {
            // ignore
          }
        }, timeoutMs)
      : null;

  let exitCode: number;
  let stdout = "";
  let stderr = "";
  // 流式解码：chunk 可能在多字节字符中间断开，需 stream:true + 收尾 flush
  const outDec = new TextDecoder("utf-8", { fatal: false });
  const errDec = new TextDecoder("utf-8", { fatal: false });

  const readStream = async (
    stream: ReadableStream<Uint8Array> | null,
    decoder: TextDecoder,
    onText: (text: string) => void,
  ) => {
    if (!stream) return;
    for await (const chunk of stream) {
      onText(decoder.decode(chunk, { stream: true }));
    }
    onText(decoder.decode());
  };

  try {
    // 并发读取两个输出流，避免管道写满后阻塞
    [exitCode] = await Promise.all([
      proc.exited,
      readStream(proc.stdout, outDec, (text) => {
        stdout += text;
        if (entry) opLog.appendText(entry, "out", text);
      }),
      readStream(proc.stderr, errDec, (text) => {
        stderr += text;
        if (entry) opLog.appendText(entry, "err", text);
      }),
    ]);
  } catch (err) {
    // 任务被取消或其他异常时尽力清理子进程，避免遗留壳进程
    try {
      proc.kill();
    } catch {
      // ignore
    }
    if (entry) opLog.fail(entry, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (timedOut) {
    const msg = t("error.timeout", { exe: executable });
    if (entry) opLog.fail(entry, msg);
    throw new ManagerError(msg);
  }

  // 用户终止：opLog.cancel 已 kill 子进程并把 entry 标记为 cancelled,
  // proc.exited 随即 resolve（exitCode 可能为 null）。此时不写结果——
  // 抛 ManagerError 让上层（doUpdateAll 等）的 catch 统一记为失败；
  // opLog 状态已由 cancel 推进,下方 finish 因 status 非 running 直接跳过。
  if (entry && entry.status === "cancelled") {
    throw new ManagerError(t("error.terminated", { cmd: entry.title }));
  }

  if (entry) opLog.finish(entry, exitCode);
  return { stdout, stderr, exitCode };
}

/**
 * 以管理员权限重新执行一个命令（Windows UAC 提权）。
 *
 * PowerShell 的 `Start-Process -Verb RunAs` 不允许 -RedirectStandardOutput
 * 与 -Verb 同用，故经内部 `cmd /c "<exe> <args> > out.tmp 2> err.tmp"`
 * 把提权子进程的 stdout/stderr 重定向到临时文件，结束后读回写入 opLog，
 * 令用户仍能在"命令输出"界面看到提权执行的完整输出。
 *
 * UAC 被用户拒绝或 spawn 失败时记一行失败说明并标记 failed（不二次弹窗）。
 * 非 win32 平台回退到普通 runCommand。临时文件读回后尽力删除（失败忽略）。
 *
 * 安全性：PS 脚本中的 -ArgumentList 用单引号字面量注入（`'` 转义为 `''`），
 * 不经 shell 拼接用户裸输入；executable/args 为受限标识符（包名/标志），实际
 * 不含空格与特殊字符，转义仅作防御。setCancel 注入的回调杀的是 PS 宿主进程
 * ——提权子进程可能残留，属尽力而为（同现有注释约定）。
 */
export async function runCommandElevated(
  executable: string,
  args: string[],
  opts?: RunOptions,
): Promise<RunResult> {
  // 非 win32：提权概念不适用，回退普通执行
  if (process.platform !== "win32") {
    return runCommand(executable, args, opts);
  }

  const title = `${executable} ${args.join(" ")}`;
  const adminTitle = `${t("output.admin_prefix")}${title}`;
  const entry = opts?.log ? opLog.begin(adminTitle, { executable, args }) : null;

  // 唯一临时文件路径（含 entry id 防并发重试碰撞）
  const base = `pkg-tui-elev-${entry ? entry.id : process.pid}-${Date.now()}`;
  const outPath = join(tmpdir(), `${base}.out`);
  const errPath = join(tmpdir(), `${base}.err`);

  // PS 单引号转义：把任意字符串安全注入 PS 单引号字面量
  const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
  // cmd /c 内部命令行：重定向目标用双引号包裹（处理含空格的临时目录）
  const innerLine = `${[executable, ...args].join(" ")} > "${outPath}" 2> "${errPath}"`;
  // PS 脚本：经 Start-Process -Verb RunAs 提权运行 cmd，等待结束并回传退出码
  const script =
    `try { ` +
    `$p = Start-Process -FilePath cmd -ArgumentList ${psq(`/c ${innerLine}`)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; ` +
    `Write-Output $p.ExitCode ` +
    `} catch { Write-Output $_.Exception.Message }`;

  let exitCode = 1;
  let outContent = "";
  let errContent = "";
  try {
    const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (entry) {
      opLog.setCancel(entry, () => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
      });
    }
    const psOut = await new Response(proc.stdout).text();
    const code = await proc.exited;
    // PS 成功执行：stdout 为退出码数字；PS 自身失败时 code≠0
    if (code === 0) {
      const parsed = Number.parseInt(psOut.trim(), 10);
      exitCode = Number.isNaN(parsed) ? 1 : parsed;
    } else {
      // PS 脚本异常（如 UAC 被拒绝导致 Start-Process 抛错）
      exitCode = 1;
      if (entry) opLog.appendText(entry, "err", psOut.trim() || t("output.elevation_failed"));
    }

    // 读回提权子进程的输出到 opLog，同时作为返回值
    try {
      outContent = await Bun.file(outPath).text();
      if (entry && outContent) opLog.appendText(entry, "out", outContent);
    } catch {
      // 输出文件读取失败忽略（提权可能未产生输出）
    }
    try {
      errContent = await Bun.file(errPath).text();
      if (entry && errContent) opLog.appendText(entry, "err", errContent);
    } catch {
      // ignore
    }
  } catch (err) {
    if (entry) opLog.fail(entry, t("output.elevation_failed"));
    await cleanupTmp(outPath, errPath);
    throw err;
  }

  await cleanupTmp(outPath, errPath);

  if (entry) opLog.finish(entry, exitCode);
  return { stdout: outContent, stderr: errContent, exitCode };
}

/** 尽力删除临时文件（失败忽略）。 */
async function cleanupTmp(...paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      await unlink(p);
    } catch {
      // ignore
    }
  }
}

/** 安全解析 JSON。失败时返回空 dict（适合对象输出）。 */
export function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** 检查可执行文件是否在 PATH 中（异步）。
 *  Windows 上对 App Execution Alias（如 winget）也能正确识别（经 where 探测）。 */
export async function isAvailableAsync(executable: string): Promise<boolean> {
  const cached = _availabilityCache.get(executable);
  if (cached !== undefined) return cached;

  let ok = false;
  if (Bun.which(executable)) {
    ok = true;
  } else if (process.platform === "win32") {
    // Windows App Execution Alias 探测
    try {
      const probe = Bun.spawn(["cmd", "/c", "where", executable], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(probe.stdout).text();
      const code = await probe.exited;
      ok = code === 0 && out.trim().length > 0;
    } catch {
      ok = false;
    }
  }
  _availabilityCache.set(executable, ok);
  return ok;
}
