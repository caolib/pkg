/**
 * 设置界面。
 *
 * 对应原 Python 项目 screens/settings_screen.py：
 *   - 包管理器管理：每行显示名称、检测状态、启用开关；可单个/全部检查可用性
 *   - 语言切换（简体中文 / English）
 *   - 配置文件路径显示 + 打开所在目录
 *   - Esc / "完成" 关闭，回传变更（disabled_managers、language）
 *
 * 简化：用自建受控列表（box+text），键盘 ↑↓ 移光标、Enter/Space 切换启用、
 * c 检查单个、a 全部检查、l 切语言、o 打开目录、Esc/Enter 在"完成"行关闭。
 */

import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/react"
import { useState } from "react"
import { configPath } from "../config"
import { isTextInputFocused } from "../focus"
import { t, setLanguage, currentLanguage } from "../i18n"
import type { ManagerRegistry } from "../runtime"

export interface SettingsResult {
  disabledManagers: Set<string>
  language: string
}

export interface SettingsScreenProps {
  reg: ManagerRegistry
  onClose: (result: SettingsResult | null) => void
  onToast: (message: string, severity: "info" | "warn" | "error") => void
}

/** 一行设置项。 */
type Row =
  | { kind: "mgr"; name: string }
  | { kind: "lang" }
  | { kind: "checkall" }
  | { kind: "opendir" }
  | { kind: "done" }

function statusLabel(reg: ManagerRegistry, name: string): string {
  const st = reg.states.get(name)
  if (!st) return t("settings.status_unknown")
  if (!st.checked) return t("settings.status_unknown")
  return st.available ? t("settings.status_installed") : t("settings.status_missing")
}

function statusColor(reg: ManagerRegistry, name: string): string {
  const st = reg.states.get(name)
  if (!st || !st.checked) return "#888"
  return st.available ? "#8f8" : "#f88"
}

function toggleLabel(reg: ManagerRegistry, name: string): string {
  const st = reg.states.get(name)
  const enabled = st ? !st.disabled : true
  return enabled ? t("settings.toggle_enable") : t("settings.toggle_disable")
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { reg, onClose, onToast } = props
  const renderer = useRenderer()
  const [, force] = useState(0)
  const rerender = () => force((n) => n + 1)
  const [cursor, setCursor] = useState(0)
  const [lang, setLang] = useState(currentLanguage())

  // 行序列：各管理器 + 语言 + 全部检查 + 打开目录 + 完成
  const rows: Row[] = [
    ...reg.names.map((n): Row => ({ kind: "mgr", name: n })),
    { kind: "lang" },
    { kind: "checkall" },
    { kind: "opendir" },
    { kind: "done" },
  ]

  useKeyboard((key) => {
    if (key.name === "escape") {
      finish()
      key.preventDefault()
      return
    }
    // 若还有文本输入持有焦点，a/c/l/o 等字符键归它，不在这里当快捷键
    if (isTextInputFocused(renderer)) return
    if (key.name === "up") {
      setCursor((c) => (c - 1 + rows.length) % rows.length)
      key.preventDefault()
      return
    }
    if (key.name === "down") {
      setCursor((c) => (c + 1) % rows.length)
      key.preventDefault()
      return
    }
    const row = rows[cursor]
    if (key.name === "return" || key.name === "space") {
      activate(row)
      key.preventDefault()
      return
    }
    // 快捷键
    if (key.name === "a") {
      checkAll()
      key.preventDefault()
    } else if (key.name === "c") {
      if (row.kind === "mgr") checkOne(row.name)
      key.preventDefault()
    } else if (key.name === "l") {
      toggleLanguage()
      key.preventDefault()
    } else if (key.name === "o") {
      openDir()
      key.preventDefault()
    }
  })

  function activate(row: Row) {
    if (row.kind === "mgr") toggleManager(row.name)
    else if (row.kind === "lang") toggleLanguage()
    else if (row.kind === "checkall") checkAll()
    else if (row.kind === "opendir") openDir()
    else if (row.kind === "done") finish()
  }

  function toggleManager(name: string) {
    const st = reg.states.get(name)
    if (!st) return
    st.disabled = !st.disabled
    if (st.disabled) reg.disabledManagers.add(name)
    else reg.disabledManagers.delete(name)
    rerender()
  }

  function toggleLanguage() {
    const next = lang === "zh_CN" ? "en_US" : "zh_CN"
    setLanguage(next)
    setLang(next)
    rerender()
  }

  async function checkOne(name: string) {
    const st = reg.states.get(name)
    if (!st) return
    rerender()
    try {
      st.available = await st.instance.isAvailable()
      st.checked = true
    } catch {
      st.available = false
      st.checked = true
    }
    rerender()
  }

  async function checkAll() {
    for (const name of reg.names) {
      const st = reg.states.get(name)!
      try {
        st.available = await st.instance.isAvailable()
        st.checked = true
      } catch {
        st.available = false
        st.checked = true
      }
      rerender()
    }
  }

  function openDir() {
    // 打开配置文件所在目录（系统文件管理器）
    const dir = configPath().replace(/[/\\][^/\\]+$/, "")
    try {
      const cmd =
        process.platform === "win32"
          ? ["cmd", "/c", "explorer", dir]
          : process.platform === "darwin"
            ? ["open", dir]
            : ["xdg-open", dir]
      Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })
    } catch {
      onToast(t("settings.open_dir_failed"), "warn")
    }
  }

  function finish() {
    onClose({ disabledManagers: new Set(reg.disabledManagers), language: currentLanguage() })
  }

  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" backgroundColor="rgba(0,0,0,0.5)" alignItems="center" justifyContent="center">
      <box flexDirection="column" borderStyle="rounded" borderColor="#36c" backgroundColor="#1a1a1a" padding={1} width={72} maxHeight="85%">
        <text fg="#fff" attributes={TextAttributes.BOLD}>{t("settings.title")}</text>

        <box flexDirection="column" marginTop={1}>
          {rows.map((row, i) => {
            const isCursor = i === cursor
            const bg = isCursor ? "#264f78" : "transparent"
            if (row.kind === "mgr") {
              const st = reg.states.get(row.name)!
              return (
                <box key={`mgr-${row.name}`} flexDirection="row" backgroundColor={bg}>
                  <text width={12} fg="#ddd">{row.name}</text>
                  <text width={16} fg={statusColor(reg, row.name)}>{statusLabel(reg, row.name)}</text>
                  <text width={10} fg={st.disabled ? "#888" : "#8f8"}>{toggleLabel(reg, row.name)}</text>
                </box>
              )
            }
            if (row.kind === "lang") {
              return (
                <box key="lang" flexDirection="row" backgroundColor={bg}>
                  <text width={12} fg="#888">{t("settings.section_language")}</text>
                  <text width={20} fg="#6cf">{lang === "zh_CN" ? t("settings.lang_zh") : t("settings.lang_en")}</text>
                  <text fg="#888">{"(l 切换)"}</text>
                </box>
              )
            }
            if (row.kind === "checkall") {
              return (
                <box key="checkall" flexDirection="row" backgroundColor={bg}>
                  <text fg="#6cf">{`[ ${t("settings.check_all")} ]  (a)`}</text>
                </box>
              )
            }
            if (row.kind === "opendir") {
              return (
                <box key="opendir" flexDirection="row" backgroundColor={bg}>
                  <text fg="#6cf">{`[ ${t("settings.open_dir")} ]  (o)`}</text>
                </box>
              )
            }
            // done
            return (
              <box key="done" flexDirection="row" backgroundColor={bg}>
                <text fg="#ff0">{`[ ${t("settings.done")} ]`}</text>
              </box>
            )
          })}
        </box>

        {/* 配置文件路径 */}
        <box flexDirection="column" marginTop={1}>
          <text fg="#888">{t("settings.config_path")}</text>
          <text fg="#ddd">{configPath()}</text>
        </box>

        {/* 底部提示 */}
        <box flexDirection="row" marginTop={1}>
          <text fg="#666">{"↑↓ 移动  Enter/Space 切换  c 检查  a 全部  l 语言  o 目录  Esc 完成"}</text>
        </box>
      </box>
    </box>
  )
}
