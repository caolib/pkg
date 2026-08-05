/**
 * 包详情展示界面。
 *
 * 展示单个包的完整元数据。打开后立刻渲染加载态,后台 worker 调用管理器的
 * view 拉取详情;数据到达后填充正文。已安装视图打开时附带更新/删除/安装版本
 * 按钮;搜索视图打开时附带安装(默认聚焦,装最新版)/安装版本按钮。
 * 对应原 Python 项目的 screens/detail_screen.py。
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { ModalBackdrop } from "../components/ModalBackdrop";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { t } from "../i18n";
import { formatRelativeTime } from "../date";
import type { PackageManager, PackageDetail } from "../managers";
import { publishedDate } from "../managers";
import { VersionPicker } from "./VersionPicker";
import { dispWidthStr, sliceByDisp } from "../width";

export interface DetailScreenProps {
  manager: PackageManager;
  name: string;
  /** 非 null 时显示更新/删除按钮(来自已安装视图) */
  managerName: string | null;
  title: string;
  onClose: () => void;
  onUpdate: (managerName: string, name: string) => void;
  onUninstall: (managerName: string, name: string) => void;
  /** 安装最新版（仅搜索视图显示该按钮） */
  onInstall: () => void;
  onInstallVersion: (version: string) => void;
  onToast: (message: string, severity: "info" | "warn" | "error") => void;
  /** false=被上层 overlay（确认框/管理器选择器）压住：不响应按键 */
  active?: boolean;
}

interface LoadState {
  status: "loading" | "ok" | "error";
  detail: PackageDetail | null;
  error: string;
}

/** 详情框内容区可用宽度:框宽 80 - 内边距 2 - 标签列 14 = 64 列 */
const VALUE_WIDTH = 64;

/** 底部按钮种类：install=安装最新版，version=安装指定版本（打开版本选择器） */
type DetailButton = "update" | "delete" | "install" | "version" | "close";

export function DetailScreen(props: DetailScreenProps) {
  const {
    manager,
    name,
    managerName,
    title,
    onClose,
    onUpdate,
    onUninstall,
    onInstall,
    onInstallVersion,
    onToast,
    active = true,
  } = props;
  const [state, setState] = useState<LoadState>({ status: "loading", detail: null, error: "" });
  const [focus, setFocus] = useState<DetailButton>(managerName ? "update" : "install");
  const [showVersionPicker, setShowVersionPicker] = useState(false);
  const { height } = useTerminalDimensions();
  // 固定整体高度:加载/加载完成高度一致,按钮位置不跳动
  const boxHeight = Math.max(10, Math.floor(height * 0.8));

  // 按钮顺序:已安装视图为 [update, delete, version, close],
  // 搜索视图为 [install(默认聚焦,装最新版), version, close]
  const buttons: readonly DetailButton[] = managerName
    ? ["update", "delete", "version", "close"]
    : ["install", "version", "close"];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await manager.view(name);
        if (!cancelled) setState({ status: "ok", detail, error: "" });
      } catch (exc) {
        const msg = String(exc);
        if (!cancelled) setState({ status: "error", detail: null, error: msg });
        onToast(t("notify.detail_failed", { exc: msg }), "error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useKeyboard((key) => {
    // 被上层 overlay（确认框/管理器选择器）压住时不响应按键
    if (!active) return;
    if (showVersionPicker) {
      // 版本选择器自己处理按键,这里只负责关闭
      if (key.name === "escape") {
        setShowVersionPicker(false);
        key.preventDefault();
      }
      return;
    }
    if (key.name === "escape") {
      onClose();
      key.preventDefault();
      return;
    }
    if (key.name === "left" || key.name === "right") {
      const idx = buttons.indexOf(focus);
      if (idx < 0) return;
      const delta = key.name === "left" ? -1 : 1;
      const next = buttons[(idx + delta + buttons.length) % buttons.length];
      setFocus(next);
      key.preventDefault();
    } else if (key.name === "return" || key.name === "tab") {
      activate(focus);
      key.preventDefault();
    }
  });

  function activate(btn: DetailButton) {
    if (btn === "close") {
      onClose();
    } else if (managerName && btn === "update") {
      onUpdate(managerName, name);
    } else if (managerName && btn === "delete") {
      onUninstall(managerName, name);
    } else if (btn === "install") {
      onInstall();
    } else if (btn === "version") {
      setShowVersionPicker(true);
    }
  }

  const body =
    state.status === "loading" ? (
      <LoadingIndicator />
    ) : state.status === "error" ? (
      <text fg="#f88">{t("detail.load_failed", { exc: state.error })}</text>
    ) : state.detail ? (
      formatDetail(state.detail)
    ) : null;

  return (
    <ModalBackdrop>
      <box
        flexDirection="column"
        backgroundColor="#1a1a1a"
        padding={1}
        width={80}
        height={boxHeight}
      >
        <text fg="#fff">{title}</text>
        <box flexDirection="column" marginTop={1} flexGrow={1}>
          {body}
        </box>
        <box flexDirection="row" marginTop={1} justifyContent="flex-end">
          {buttons.map((b) => {
            const label =
              b === "update"
                ? t("button.update")
                : b === "delete"
                  ? t("button.delete")
                  : b === "install"
                    ? t("button.install")
                    : b === "version"
                      ? t("button.install_version")
                      : t("button.close");
            const isFocus = focus === b;
            const bg = isFocus ? "#264f78" : "#333";
            const fg = b === "delete" ? (isFocus ? "#fff" : "#f88") : "#fff";
            return (
              <text key={b} fg={fg} bg={bg} onMouseDown={() => activate(b)}>{` ${label} `}</text>
            );
          })}
        </box>
        {showVersionPicker ? (
          <VersionPicker
            versions={state.detail?.versions ?? []}
            currentVersion={state.detail?.latest_version ?? ""}
            onSelect={(version) => {
              setShowVersionPicker(false);
              onInstallVersion(version);
            }}
            onCancel={() => setShowVersionPicker(false)}
          />
        ) : null}
      </box>
    </ModalBackdrop>
  );
}

/** 按显示宽度截断字符串,超宽加省略号。 */
function truncateDisp(s: string, maxCols: number): string {
  if (dispWidthStr(s) <= maxCols) return s;
  return `${sliceByDisp(s, 0, maxCols - 1)}…`;
}

/** 把长文本按显示宽度折成多行(用于 dist_tags / versions)。 */
function wrapDisp(s: string, maxCols: number): string[] {
  const lines: string[] = [];
  let rest = s;
  while (dispWidthStr(rest) > maxCols) {
    const line = sliceByDisp(rest, 0, maxCols);
    lines.push(line);
    rest = rest.slice(line.length);
  }
  if (rest) lines.push(rest);
  return lines;
}

/** 将 PackageDetail 渲染为多行富文本节点列表。 */
function formatDetail(detail: PackageDetail) {
  const lines: Array<[string, string, string | undefined]> = [];
  if (detail.display_name && detail.display_name !== detail.name) {
    lines.push([t("detail.display_name"), detail.display_name, undefined]);
    lines.push([t("detail.id"), detail.name, "#6cf"]);
  }
  lines.push([t("detail.version"), detail.latest_version || "-", "#6cf"]);
  lines.push([t("detail.description"), truncateDisp(detail.description || "-", VALUE_WIDTH), undefined]);
  lines.push([t("detail.license"), truncateDisp(detail.license || "-", VALUE_WIDTH), undefined]);
  lines.push([t("detail.author"), truncateDisp(detail.author || "-", VALUE_WIDTH), undefined]);
  lines.push([t("detail.homepage"), truncateDisp(detail.homepage || "-", VALUE_WIDTH), undefined]);
  lines.push([t("detail.repository"), truncateDisp(detail.repository || "-", VALUE_WIDTH), undefined]);
  if (detail.dist_tags && Object.keys(detail.dist_tags).length > 0) {
    const tags = Object.entries(detail.dist_tags)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    const wrapped = wrapDisp(tags, VALUE_WIDTH);
    for (let i = 0; i < wrapped.length; i++) {
      lines.push([i === 0 ? t("detail.dist_tags") : "", wrapped[i], undefined]);
    }
  }
  if (detail.maintainers && detail.maintainers.length > 0) {
    lines.push([
      t("detail.maintainers"),
      truncateDisp(detail.maintainers.slice(0, 5).join(", "), VALUE_WIDTH),
      undefined,
    ]);
  }
  const pub = publishedDate(detail);
  if (pub) lines.push([t("detail.published"), formatRelativeTime(pub), undefined]);
  if (detail.versions && detail.versions.length > 0) {
    const shown = detail.versions.slice(0, 10).join(", ");
    const more =
      detail.versions.length > 10
        ? t("detail.version_count", { count: String(detail.versions.length) })
        : "";
    const full = `${shown}${more}`;
    const wrapped = wrapDisp(full, VALUE_WIDTH);
    for (let i = 0; i < wrapped.length; i++) {
      lines.push([i === 0 ? t("detail.history") : "", wrapped[i], undefined]);
    }
  }
  return (
    <box flexDirection="column">
      {lines.map(([label, value, color], i) => (
        <box key={i} flexDirection="row">
          <text fg="#888" width={14}>
            {label}
          </text>
          <text fg={color ?? "#ddd"} flexGrow={1}>
            {value}
          </text>
        </box>
      ))}
    </box>
  );
}
