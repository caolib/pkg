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

export class ManagerError extends Error {}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

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
 */
export async function runCommand(executable: string, args: string[]): Promise<RunResult> {
  const resolved = await resolveExecutable(executable, args);
  if (resolved === null) {
    throw new ManagerError(t("error.not_found", { exe: executable }));
  }

  const proc = Bun.spawn(resolved.argv, {
    stdout: "pipe",
    stderr: "pipe",
  });

  let exitCode: number;
  let stdoutBytes: Uint8Array;
  let stderrBytes: Uint8Array;
  try {
    // 并发读取两个输出流，避免管道写满后阻塞
    [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer().then((b) => new Uint8Array(b)),
      new Response(proc.stderr).arrayBuffer().then((b) => new Uint8Array(b)),
      proc.exited,
    ]);
  } catch (err) {
    // 任务被取消或其他异常时尽力清理子进程，避免遗留壳进程
    try {
      proc.kill();
    } catch {
      // ignore
    }
    throw err;
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  return {
    stdout: decoder.decode(stdoutBytes),
    stderr: decoder.decode(stderrBytes),
    exitCode,
  };
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
