/**
 * 确认对话框。
 *
 * 用于执行破坏性操作（卸载、批量更新）前向用户确认。
 * 居中模态：展示消息（含将执行的命令预览）+ 确定/取消按钮。
 * ← → 在按钮间切换，Enter 选中，Esc 取消。
 * 对应原 Python 项目的 screens/confirm_screen.py。
 */

import { useKeyboard } from "@opentui/react"
import { ModalBackdrop } from "../components/ModalBackdrop"
import { t } from "../i18n"
import { useState } from "react"

export interface ConfirmDialogProps {
  message: string
  /** 命令预览行（每行一条将执行的命令），以 cyan 高亮展示 */
  commands?: string[]
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { message, commands, onConfirm, onCancel } = props
  const [focus, setFocus] = useState<"yes" | "no">("yes")

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel()
      key.preventDefault()
    } else if (key.name === "left" || key.name === "right") {
      setFocus((f) => (f === "yes" ? "no" : "yes"))
      key.preventDefault()
    } else if (key.name === "return") {
      if (focus === "yes") onConfirm()
      else onCancel()
      key.preventDefault()
    } else if (key.name === "tab") {
      setFocus((f) => (f === "yes" ? "no" : "yes"))
      key.preventDefault()
    }
  })

  const yesBg = focus === "yes" ? "#a33" : "#333"
  const noBg = focus === "no" ? "#264f78" : "#333"

  return (
    <ModalBackdrop>
      <box flexDirection="column" borderStyle="rounded" borderColor="#c93" backgroundColor="#1a1a1a" padding={1} width={64}>
        <text fg="#eee">{message}</text>
        {commands && commands.length > 0 ? (
          <box flexDirection="column" marginTop={1}>
            {commands.map((c, i) => (
              <text key={i} fg="#6cf">
                {"  "}{c}
              </text>
            ))}
          </box>
        ) : null}
        <box flexDirection="row" marginTop={1} justifyContent="center">
          <text fg="#fff" bg={yesBg}>{` ${t("button.confirm")} `}</text>
          <text>{"  "}</text>
          <text fg="#fff" bg={noBg}>{` ${t("button.cancel")} `}</text>
        </box>
      </box>
    </ModalBackdrop>
  )
}
