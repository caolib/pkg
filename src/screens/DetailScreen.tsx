/**
 * 包详情展示界面。
 *
 * 展示单个包的完整元数据。打开后立刻渲染加载态，后台 worker 调用管理器的
 * view 拉取详情；数据到达后填充正文。已安装视图打开时附带更新/删除按钮。
 * 对应原 Python 项目的 screens/detail_screen.py。
 */

import { useKeyboard } from "@opentui/react"
import { useEffect, useState } from "react"
import { ModalBackdrop } from "../components/ModalBackdrop"
import { t } from "../i18n"
import type { PackageManager, PackageDetail } from "../managers"
import { publishedDate } from "../managers"

export interface DetailScreenProps {
  manager: PackageManager
  name: string
  /** 非 null 时显示更新/删除按钮（来自已安装视图） */
  managerName: string | null
  title: string
  onClose: () => void
  onUpdate: (managerName: string, name: string) => void
  onUninstall: (managerName: string, name: string) => void
  onToast: (message: string, severity: "info" | "warn" | "error") => void
}

interface LoadState {
  status: "loading" | "ok" | "error"
  detail: PackageDetail | null
  error: string
}

export function DetailScreen(props: DetailScreenProps) {
  const { manager, name, managerName, title, onClose, onUpdate, onUninstall, onToast } = props
  const [state, setState] = useState<LoadState>({ status: "loading", detail: null, error: "" })
  const [focus, setFocus] = useState<"update" | "delete" | "close">(managerName ? "update" : "close")

  // 按钮顺序：有更新/删除时为 [update, delete, close]，否则 [close]
  const buttons = managerName ? ["update", "delete", "close"] as const : ["close"] as const

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const detail = await manager.view(name)
        if (!cancelled) setState({ status: "ok", detail, error: "" })
      } catch (exc) {
        const msg = String(exc)
        if (!cancelled) setState({ status: "error", detail: null, error: msg })
        onToast(t("notify.detail_failed", { exc: msg }), "error")
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose()
      key.preventDefault()
      return
    }
    if (key.name === "left" || key.name === "right") {
      const idx = buttons.indexOf(focus as any)
      if (idx < 0) return
      const delta = key.name === "left" ? -1 : 1
      const next = buttons[(idx + delta + buttons.length) % buttons.length]
      setFocus(next as any)
      key.preventDefault()
    } else if (key.name === "return" || key.name === "tab") {
      activate(focus)
      key.preventDefault()
    }
  })

  function activate(btn: "update" | "delete" | "close") {
    if (btn === "close") {
      onClose()
    } else if (managerName && btn === "update") {
      onUpdate(managerName, name)
    } else if (managerName && btn === "delete") {
      onUninstall(managerName, name)
    }
  }

  const body =
    state.status === "loading" ? (
      <text fg="#888">{t("detail.loading")}</text>
    ) : state.status === "error" ? (
      <text fg="#f88">{t("detail.load_failed", { exc: state.error })}</text>
    ) : state.detail ? (
      formatDetail(state.detail)
    ) : null

  return (
    <ModalBackdrop>
      <box flexDirection="column" backgroundColor="#1a1a1a" padding={1} width={80} maxHeight={"80%"}>
        <text fg="#fff">{title}</text>
        <box flexDirection="column" marginTop={1}>
          {body}
        </box>
        <box flexDirection="row" marginTop={1} justifyContent="flex-end">
          {buttons.map((b) => {
            const label = b === "update" ? t("button.update") : b === "delete" ? t("button.delete") : t("button.close")
            const isFocus = focus === b
            const bg = isFocus ? "#264f78" : "#333"
            const fg = b === "delete" ? (isFocus ? "#fff" : "#f88") : "#fff"
            return (
              <text
                key={b}
                fg={fg}
                bg={bg}
                onMouseDown={() => activate(b as any)}
              >{` ${label} `}</text>
            )
          })}
        </box>
      </box>
    </ModalBackdrop>
  )
}

/** 将 PackageDetail 渲染为多行富文本节点列表。 */
function formatDetail(detail: PackageDetail) {
  const lines: Array<[string, string, string | undefined]> = []
  if (detail.display_name && detail.display_name !== detail.name) {
    lines.push([t("detail.display_name"), detail.display_name, undefined])
    lines.push([t("detail.id"), detail.name, "#6cf"])
  }
  lines.push([t("detail.version"), detail.latest_version || "-", "#6cf"])
  lines.push([t("detail.description"), detail.description || "-", undefined])
  lines.push([t("detail.license"), detail.license || "-", undefined])
  lines.push([t("detail.author"), detail.author || "-", undefined])
  lines.push([t("detail.homepage"), detail.homepage || "-", undefined])
  lines.push([t("detail.repository"), detail.repository || "-", undefined])
  if (detail.dist_tags && Object.keys(detail.dist_tags).length > 0) {
    const tags = Object.entries(detail.dist_tags).map(([k, v]) => `${k}=${v}`).join("  ")
    lines.push([t("detail.dist_tags"), tags, undefined])
  }
  if (detail.maintainers && detail.maintainers.length > 0) {
    lines.push([t("detail.maintainers"), detail.maintainers.slice(0, 5).join(", "), undefined])
  }
  const pub = publishedDate(detail)
  if (pub) lines.push([t("detail.published"), pub, undefined])
  if (detail.versions && detail.versions.length > 0) {
    const shown = detail.versions.slice(0, 10).join(", ")
    const more = detail.versions.length > 10 ? t("detail.version_count", { count: String(detail.versions.length) }) : ""
    lines.push([t("detail.history"), `${shown}${more}`, undefined])
  }
  return (
    <box flexDirection="column">
      {lines.map(([label, value, color], i) => (
        <box key={i} flexDirection="row">
          <text fg="#888" width={14}>{label}</text>
          <text fg={color ?? "#ddd"} flexGrow={1}>{value}</text>
        </box>
      ))}
    </box>
  )
}
