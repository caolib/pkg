/**
 * 命令输出查看界面（"输出"）。
 *
 * 展示安装/更新/卸载命令的执行记录（最近条目新在前，最多保留若干条）：
 * 左侧为条目列表（状态图标 + 命令标题），右侧为选中条目的完整输出。
 * 运行中的条目输出实时追加并自动跟随到底部（类似 opencode 的子代理输出
 * 面板）；用户滚动离开后停止跟随，滚回底部后恢复。
 *
 * 键盘：↑↓ 在条目间切换（仅一条记录时滚动输出）、PgUp/PgDn 翻页、
 * Home/End 跳到首尾、Esc 关闭。滚轮在输出区滚动（ScrollBox 原生），
 * 在条目列表上移动选择。
 */

import {
  MouseButton,
  TextAttributes,
  type MouseEvent,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { FALLBACK_BACKGROUND, getTerminalBackgroundSync } from "../terminal-colors";
import { t } from "../i18n";
import { opLog, type OpLogEntry, type OpStatus } from "../ops";

export interface OutputScreenProps {
  onClose: () => void;
}

/** 条目列表滚轮每档移动的选择步数（与 PackageTable 的 VSCROLL_STEP 一致） */
const LIST_SCROLL_STEP = 3;

/** 各状态的图标与前景色。 */
const STATUS_META: Record<OpStatus, { icon: string; fg: string }> = {
  running: { icon: "●", fg: "#fd6" },
  success: { icon: "✓", fg: "#6b6" },
  failed: { icon: "✗", fg: "#f66" },
};

function statusText(status: OpStatus): string {
  if (status === "running") return t("output.status_running");
  if (status === "success") return t("output.status_ok");
  return t("output.status_failed");
}

/** 耗时文本：运行中为已耗时，结束后为总耗时。 */
function elapsedText(entry: OpLogEntry): string {
  const ms = (entry.finishedAt ?? Date.now()) - entry.startedAt;
  const sec = Math.max(1, Math.round(ms / 1000));
  return t("output.elapsed", { sec: String(sec) });
}

export function OutputScreen(props: OutputScreenProps) {
  const { onClose } = props;
  const { width } = useTerminalDimensions();
  const [, force] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [hover, setHover] = useState(-1);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  // 每次渲染即时读取：opLog 是 mutable 单例，订阅后推送重渲染
  const entries = opLog.entries;
  const entry: OpLogEntry | null = entries[cursor] ?? null;

  // 背景色跟随终端（主页已缓存，这里同步读取，避免先渲染一帧 FALLBACK 深色）
  const [termBg] = useState<string>(() => getTerminalBackgroundSync() ?? FALLBACK_BACKGROUND);

  // 日志变化（新条目/追加输出/结束）实时刷新
  useEffect(() => opLog.subscribe(() => force((n) => n + 1)), []);

  // 条目增减时钳制选择
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  // 运行中的条目：每秒刷新耗时显示
  useEffect(() => {
    if (!entry || entry.status !== "running") return;
    const tm = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, entry?.status]);

  // 切换条目时输出区滚到底部（scrollPosition setter 会钳制到最大）
  useEffect(() => {
    if (entry) scrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      key.preventDefault();
      return;
    }
    if (key.name === "up" || key.name === "down") {
      if (entries.length > 1) {
        const delta = key.name === "up" ? -1 : 1;
        setCursor((c) => Math.min(entries.length - 1, Math.max(0, c + delta)));
      } else {
        scrollRef.current?.scrollBy({ x: 0, y: key.name === "up" ? -1 : 1 });
      }
      key.preventDefault();
      return;
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      // 与 ScrollBox 自带键盘导航一致：半页一步
      scrollRef.current?.scrollBy(key.name === "pageup" ? -0.5 : 0.5, "viewport");
      key.preventDefault();
      return;
    }
    if (key.name === "home") {
      scrollRef.current?.scrollTo({ x: 0, y: 0 });
      key.preventDefault();
      return;
    }
    if (key.name === "end") {
      scrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
      key.preventDefault();
      return;
    }
  });

  // 条目列表上的滚轮：移动选择（与 PackageTable 的 onScrollMove 一致）
  const handleListScroll = (event: MouseEvent) => {
    if (event.type !== "scroll" || !event.scroll) return;
    event.preventDefault();
    event.stopPropagation();
    const { direction, delta } = event.scroll;
    const step = (delta || 1) * LIST_SCROLL_STEP;
    if (direction === "up") setCursor((c) => Math.max(0, c - step));
    else if (direction === "down") setCursor((c) => Math.min(entries.length - 1, c + step));
  };

  const header = (
    <box flexDirection="row" height={1} paddingLeft={1} alignItems="center">
      <text fg="#fff" attributes={TextAttributes.BOLD}>
        {t("output.title")}
      </text>
      <text fg="#666">{`   ${t("output.entries_count", { count: String(entries.length) })}`}</text>
    </box>
  );

  // 无任何记录：居中提示
  if (entries.length === 0) {
    return (
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        backgroundColor={termBg}
        flexDirection="column"
      >
        {header}
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg="#888">{t("output.empty")}</text>
        </box>
        <box flexDirection="row" height={1} backgroundColor="#111" paddingLeft={1}>
          <text fg="#666">{t("output.footer_empty")}</text>
        </box>
      </box>
    );
  }

  const meta = STATUS_META[entry!.status];
  const listWidth = Math.min(44, Math.max(28, Math.floor(width / 3)));

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={termBg}
      flexDirection="column"
    >
      {header}
      <box flexDirection="row" flexGrow={1}>
        {/* 左：条目列表 */}
        <box
          flexDirection="column"
          width={listWidth}
          paddingLeft={1}
          paddingRight={1}
          onMouseScroll={handleListScroll}
        >
          {entries.map((e, i) => {
            const m = STATUS_META[e.status];
            const rowBg = i === cursor ? "#264f78" : i === hover ? "#333" : "transparent";
            return (
              <box
                key={e.id}
                flexDirection="row"
                backgroundColor={rowBg}
                onMouseOver={() => setHover(i)}
                onMouseOut={() => setHover((h) => (h === i ? -1 : h))}
                onMouseDown={(event) => {
                  if (event.button !== MouseButton.LEFT) return;
                  event.stopPropagation();
                  setCursor(i);
                }}
              >
                <text width={2} fg={m.fg}>
                  {m.icon}
                </text>
                <text
                  width={listWidth - 5}
                  fg={i === cursor ? "#fff" : "#ddd"}
                  truncate
                  wrapMode="none"
                >
                  {e.title}
                </text>
              </box>
            );
          })}
        </box>
        {/* 分隔线 */}
        <box width={1} backgroundColor="#222" />
        {/* 右：状态行 + 输出 */}
        <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
          <box flexDirection="row" height={1}>
            <text fg={meta.fg}>{`${meta.icon} ${statusText(entry!.status)}`}</text>
            <text fg="#888">{` · ${elapsedText(entry!)}`}</text>
            {entry!.exitCode !== null ? (
              <text fg="#888">{` · ${t("output.exit_code", { code: String(entry!.exitCode) })}`}</text>
            ) : null}
          </box>
          {/* 输出区：sticky 跟随底部，滚开即暂停跟随（同 opencode 日志面板） */}
          <scrollbox
            ref={scrollRef}
            flexGrow={1}
            stickyScroll
            stickyStart="bottom"
            contentOptions={{ flexDirection: "column" }}
            verticalScrollbarOptions={{
              trackOptions: { backgroundColor: "transparent", foregroundColor: "#666" },
            }}
          >
            <text fg="#6cf" attributes={TextAttributes.BOLD} wrapMode="none">
              {`$ ${entry!.title}`}
            </text>
            {entry!.lines.map((line, i) => (
              <text
                key={i}
                fg={line.stream === "err" ? "#f88" : line.stream === "info" ? "#fd6" : "#ddd"}
                wrapMode="none"
              >
                {line.text}
              </text>
            ))}
          </scrollbox>
        </box>
      </box>
      <box flexDirection="row" height={1} backgroundColor="#111" paddingLeft={1}>
        <text fg="#666">
          {entries.length > 1 ? t("output.footer_multi") : t("output.footer_single")}
        </text>
      </box>
    </box>
  );
}
