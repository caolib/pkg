/**
 * 设置界面。
 *
 * 对应原 Python 项目 screens/settings_screen.py:
 *   - 包管理器管理:每行显示名称、检测状态、启用开关
 *   - 语言切换(简体中文 / English)
 *   - 打开首页自动检查更新开关
 *   - 配置文件路径显示
 *   - Esc 关闭,回传变更(disabled_managers、language)
 *
 * 简化:用自建受控列表(box+text),键盘 ↑↓ 移光标、Enter/Space 切换启用、
 * a 全部检查、Esc 关闭。
 * 鼠标:单击行 = 选中并激活(与 ConfirmDialog 按钮一致),悬浮行高亮;
 * 行区溢出时滚轮上下移动光标(光标驱动的滚动窗口,同 PackageTable,无滚动条)。
 */

import { MouseButton, TextAttributes, type MouseEvent } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useState, useRef } from "react";
import { ModalBackdrop } from "../components/ModalBackdrop";
import { configPath } from "../config";
import { isTextInputFocused } from "../focus";
import { t, setLanguage, currentLanguage } from "../i18n";
import type { ManagerRegistry } from "../runtime";
import pkg from "../../package.json";

/** 滚轮每档移动的行数(与 PackageTable 的 VSCROLL_STEP 一致) */
const VSCROLL_STEP = 3;
/** 行区固定开销:内边距2 + 标题1 + 行区上边距1 + 配置路径3 + 底栏2 = 9 */
const ROWS_OVERHEAD = 9;

export interface SettingsResult {
  disabledManagers: Set<string>;
  language: string;
}

export interface SettingsScreenProps {
  reg: ManagerRegistry;
  onClose: (result: SettingsResult | null) => void;
  onToast: (message: string, severity: "info" | "warn" | "error") => void;
}

/** 一行设置项。 */
type Row = { kind: "mgr"; name: string } | { kind: "lang" } | { kind: "autocheck" };

function statusLabel(reg: ManagerRegistry, name: string): string {
  const st = reg.states.get(name);
  if (!st) return t("settings.status_unknown");
  if (!st.checked) return t("settings.status_unknown");
  return st.available ? t("settings.status_installed") : t("settings.status_missing");
}

function statusColor(reg: ManagerRegistry, name: string): string {
  const st = reg.states.get(name);
  if (!st || !st.checked) return "#888";
  return st.available ? "#8f8" : "#f88";
}

function toggleLabel(reg: ManagerRegistry, name: string): string {
  const st = reg.states.get(name);
  const enabled = st ? !st.disabled : true;
  return enabled ? t("settings.toggle_enable") : t("settings.toggle_disable");
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { reg, onClose } = props;
  const renderer = useRenderer();
  const { height } = useTerminalDimensions();
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [cursor, setCursor] = useState(0);
  const [lang, setLang] = useState(currentLanguage());
  /** 鼠标悬浮的行索引(-1=无) */
  const [hover, setHover] = useState(-1);
  /** 光标驱动的滚动窗口起点(同 PackageTable:行溢出时滚轮/键盘让光标行可见) */
  const windowStartRef = useRef(0);

  // 行序列:各管理器 + 语言 + 自动检查更新
  const rows: Row[] = [
    ...reg.names.map((n): Row => ({ kind: "mgr", name: n })),
    { kind: "lang" },
    { kind: "autocheck" },
  ];

  // 行区可见高度:模态框 maxHeight=85%,行区盒子给显式 height(显式高度
  // 不受 Yoga 收缩影响),扣除固定开销 ROWS_OVERHEAD 后恰好放满。
  // 行数不足时盒子收缩到实际行数,避免出现空白行。
  const listRows = Math.min(rows.length, Math.max(2, Math.floor(height * 0.85) - ROWS_OVERHEAD));
  const maxStart = Math.max(0, rows.length - listRows);
  let windowStart = Math.min(windowStartRef.current, maxStart);
  if (cursor < windowStart) windowStart = cursor;
  else if (cursor >= windowStart + listRows) windowStart = cursor - listRows + 1;
  windowStart = Math.max(0, Math.min(windowStart, maxStart));
  windowStartRef.current = windowStart;
  const windowEnd = Math.min(windowStart + listRows, rows.length);
  const visibleRows = rows.slice(windowStart, windowEnd);

  const handleWheel = (event: MouseEvent) => {
    (globalThis as any).__wheelLog = (globalThis as any).__wheelLog || [];
    if (event.type !== "scroll" || !event.scroll) return;
    (globalThis as any).__wheelLog.push(
      `${event.scroll?.direction}${event.scroll?.delta} cursor=${cursor}`,
    );
    event.preventDefault();
    event.stopPropagation();
    const { direction, delta } = event.scroll;
    if (direction === "up") {
      setCursor((c) => Math.max(0, c - (delta || 1) * VSCROLL_STEP));
    } else if (direction === "down") {
      setCursor((c) => Math.min(rows.length - 1, c + (delta || 1) * VSCROLL_STEP));
    }
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      finish();
      key.preventDefault();
      return;
    }
    // 若还有文本输入持有焦点,字符键归它,不在这里当快捷键
    if (isTextInputFocused(renderer)) return;
    if (key.name === "up") {
      setCursor((c) => (c - 1 + rows.length) % rows.length);
      key.preventDefault();
      return;
    }
    if (key.name === "down") {
      setCursor((c) => (c + 1) % rows.length);
      key.preventDefault();
      return;
    }
    const row = rows[cursor];
    if (key.name === "return" || key.name === "space") {
      activate(row);
      key.preventDefault();
      return;
    }
    // 快捷键
    if (key.name === "a") {
      checkAll();
      key.preventDefault();
    }
  });

  function activate(row: Row) {
    if (row.kind === "mgr") toggleManager(row.name);
    else if (row.kind === "lang") toggleLanguage();
    else if (row.kind === "autocheck") toggleAutoCheck();
  }

  function toggleManager(name: string) {
    const st = reg.states.get(name);
    if (!st) return;
    st.disabled = !st.disabled;
    // 记录用户显式选择:此后 checkAll 不得用自动检测结果覆盖
    st.userDisabled = st.disabled;
    if (st.disabled) reg.disabledManagers.add(name);
    else reg.disabledManagers.delete(name);
    rerender();
  }

  function toggleLanguage() {
    const next = lang === "zh_CN" ? "en_US" : "zh_CN";
    setLanguage(next);
    setLang(next);
    rerender();
  }

  function toggleAutoCheck() {
    reg.autoCheckUpdates = !reg.autoCheckUpdates;
    rerender();
  }

  async function checkAll() {
    for (const name of reg.names) {
      const st = reg.states.get(name)!;
      try {
        st.available = await st.instance.isAvailable();
        st.checked = true;
      } catch {
        st.available = false;
        st.checked = true;
      }
      autoDisableMissing(name);
      rerender();
    }
  }

  /** 检测完成后:未安装的管理器自动禁用。
   *  用户手动切换过启用/禁用的管理器不覆盖(userDisabled 记录其选择)。 */
  function autoDisableMissing(name: string) {
    const st = reg.states.get(name);
    if (!st || !st.checked) return;
    if (!st.available) {
      if (st.userDisabled === false) return;
      st.disabled = true;
      reg.disabledManagers.add(name);
    }
  }

  function finish() {
    onClose({ disabledManagers: new Set(reg.disabledManagers), language: currentLanguage() });
  }

  return (
    <ModalBackdrop>
      <box flexDirection="column" backgroundColor="#1a1a1a" padding={1} width={72} maxHeight="85%">
        <box flexDirection="row" justifyContent="space-between">
          <text fg="#fff" attributes={TextAttributes.BOLD}>
            {t("settings.title")}
          </text>
          <text fg="#888">v{pkg.version}</text>
        </box>

        <box flexDirection="column" marginTop={1} height={listRows} onMouseScroll={handleWheel}>
          {visibleRows.map((row, vi) => {
            const i = windowStart + vi;
            const isCursor = i === cursor;
            const bg = isCursor ? "#264f78" : hover === i ? "#333" : "transparent";
            const rowHandlers = {
              onMouseDown: (event: MouseEvent) => {
                if (event.button !== MouseButton.LEFT) return;
                event.stopPropagation();
                setCursor(i);
                activate(row);
              },
              onMouseOver: () => setHover(i),
              onMouseOut: () => setHover((h) => (h === i ? -1 : h)),
            };
            if (row.kind === "mgr") {
              const st = reg.states.get(row.name)!;
              return (
                <box
                  key={`mgr-${row.name}`}
                  flexDirection="row"
                  backgroundColor={bg}
                  {...rowHandlers}
                >
                  <text width={12} fg="#ddd">
                    {row.name}
                  </text>
                  <text width={16} fg={statusColor(reg, row.name)}>
                    {statusLabel(reg, row.name)}
                  </text>
                  <text width={10} fg={st.disabled ? "#888" : "#8f8"}>
                    {toggleLabel(reg, row.name)}
                  </text>
                </box>
              );
            }
            if (row.kind === "lang") {
              return (
                <box key="lang" flexDirection="row" backgroundColor={bg} {...rowHandlers}>
                  <text width={12} fg="#888">
                    {t("settings.section_language")}
                  </text>
                  <text width={20} fg="#6cf">
                    {lang === "zh_CN" ? t("settings.lang_zh") : t("settings.lang_en")}
                  </text>
                </box>
              );
            }
            // autocheck
            return (
              <box key="autocheck" flexDirection="row" backgroundColor={bg} {...rowHandlers}>
                <text width={22} fg="#888">
                  {t("settings.auto_check_updates")}
                </text>
                <text width={10} fg={reg.autoCheckUpdates ? "#8f8" : "#888"}>
                  {reg.autoCheckUpdates ? t("settings.on") : t("settings.off")}
                </text>
                <text fg="#888">{t("settings.auto_check_hint")}</text>
              </box>
            );
          })}
        </box>

        {/* 配置文件路径 */}
        <box flexDirection="column" marginTop={1}>
          <text fg="#888">{t("settings.config_path")}</text>
          <text fg="#ddd">{configPath()}</text>
        </box>

        {/* 底部提示 */}
        <box flexDirection="row" marginTop={1}>
          <text fg="#666">{"Enter/Space 切换  a 检查"}</text>
        </box>
      </box>
    </ModalBackdrop>
  );
}
