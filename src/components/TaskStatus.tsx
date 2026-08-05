/**
 * 底栏任务状态（主页底栏右侧）。
 *
 * 替代原右下角 toast 通知：安装/更新/卸载命令的执行状态统一在这里呈现
 * （失败明细仍在"命令输出"界面，按 o 查看）。跟踪 ops.opLog 条目：
 * - 有运行中条目：转圈动画 + "{n}个任务"；
 * - 一批任务全部结束且全部成功：✓ 完成，3 秒后隐藏；
 * - 有失败：✗ 失败，常驻到下一批任务开始。
 *
 * opLog 是 mutable 单例，订阅推送重渲染（同 OutputScreen 约定）。批次状态机
 * 在订阅回调内同步结算（begin/finish/fail 的 notify 时机），不依赖渲染轮次——
 * 同一轮内 begin+finish 就结束的快速任务也能正确显示终态。
 */
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { opLog } from "../ops";

/** 转圈动画帧（Braille 字符，单列宽）与步进间隔 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

export interface TaskStatusProps {
  /** 成功状态的展示时长（失败常驻不自动隐藏）；测试可传小值 */
  successVisibleMs?: number;
  /** 终态变化回调（成功/失败/清除）——父组件据此高亮底栏"查看输出"提示 */
  onOutcomeChange?: (outcome: "success" | "failed" | null) => void;
  /** 递增即清除已结算的终态与隐藏计时器（用户按 o 查看输出=已知晓结果）；
   *  不影响运行中批次的后续结算 */
  clearToken?: number;
}

export function TaskStatus({ successVisibleMs = 3000, onOutcomeChange, clearToken = 0 }: TaskStatusProps) {
  const [, force] = useState(0);
  const [frame, setFrame] = useState(0);
  const [outcome, setOutcome] = useState<"success" | "failed" | null>(null);
  // 本批次运行中条目的 id：entries 会被追加/淘汰，以 id 追踪批次终态
  const batchRef = useRef<Set<number>>(new Set());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 批次状态机：在 opLog 订阅回调内同步结算（begin/finish/fail 的 notify 时机），
  // 不依赖渲染轮次——同一轮内 begin+finish 结束的快速任务也能正确结算。
  // 运行中收集批次 id 并清除上次终态；运行归零时结算——全部成功显示成功态
  // （successVisibleMs 后隐藏），有失败则常驻
  useEffect(() => {
    const sync = () => {
      let anyRunning = false;
      for (const e of opLog.entries) {
        if (e.status === "running") {
          anyRunning = true;
          batchRef.current.add(e.id);
        }
      }
      if (anyRunning) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        setOutcome(null);
      } else if (batchRef.current.size > 0) {
        const batch = batchRef.current;
        batchRef.current = new Set();
        const anyFailed = [...batch].some(
          (id) => opLog.entries.find((e) => e.id === id)?.status === "failed",
        );
        setOutcome(anyFailed ? "failed" : "success");
        if (!anyFailed) {
          hideTimerRef.current = setTimeout(() => {
            setOutcome(null);
            hideTimerRef.current = null;
          }, successVisibleMs);
        }
      }
      force((n) => n + 1);
    };
    return opLog.subscribe(sync);
  }, [successVisibleMs]);

  const runningCount = opLog.entries.reduce((n, e) => (e.status === "running" ? n + 1 : n), 0);
  const isRunning = runningCount > 0;

  // 终态变化上报（父组件借此高亮底栏提示；仅在状态迁移时触发，不逐行输出打扰）
  useEffect(() => {
    onOutcomeChange?.(outcome);
  }, [outcome, onOutcomeChange]);

  // 查看输出（o）= 已知晓结果：清除已结算的终态与隐藏计时器
  // （不清 batchRef——运行中的批次结束后仍应正常结算新结果）
  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setOutcome(null);
  }, [clearToken]);

  // 卸载时清理隐藏计时器
  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  // 转圈动画：仅运行中推帧
  useEffect(() => {
    if (!isRunning) return;
    const tm = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    return () => clearInterval(tm);
  }, [isRunning]);

  if (isRunning) {
    const key = runningCount === 1 ? "task.running_1" : "task.running";
    return (
      <text fg="#fd6">{`${SPINNER_FRAMES[frame]} ${t(key, { count: String(runningCount) })}`}</text>
    );
  }
  if (outcome === "success") return <text fg="#6b6">{`✓ ${t("task.done")}`}</text>;
  if (outcome === "failed") return <text fg="#f66">{`✗ ${t("task.failed")}`}</text>;
  return null;
}
