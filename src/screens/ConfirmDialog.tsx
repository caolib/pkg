/**
 * 确认对话框。
 *
 * 用于执行破坏性操作（卸载、批量更新）前向用户确认。
 * 居中模态：展示消息（含将执行的命令预览）+ 确定/取消按钮。
 * ← → 在按钮间切换，Enter 选中，Esc 取消；按钮也支持鼠标左键点击。
 * 对应原 Python 项目的 screens/confirm_screen.py。
 *
 * 多选项模式（options）：合并 registry（npm/pnpm/bun）安装时，每个可用
 * 管理器一个按钮（+ 取消），命令预览随聚焦按钮切换。
 */

import { MouseButton } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { ModalBackdrop } from "../components/ModalBackdrop";
import { t } from "../i18n";
import { useState } from "react";

/** 多选项模式的一个按钮选项。 */
export interface ConfirmOption {
  label: string;
  /** 该选项将执行的命令（预览随聚焦按钮切换） */
  command?: string;
  action: () => void;
}

export interface ConfirmDialogProps {
  message: string;
  /** 命令预览行（确定/取消模式，静态展示） */
  commands?: string[];
  /** 多选项模式：按钮 = options + 取消 */
  options?: ConfirmOption[];
  /** 确定/取消模式的确定回调（options 模式不用） */
  onConfirm?: () => void;
  onCancel: () => void;
}

interface DialogButton {
  label: string;
  command?: string;
  action: () => void;
  /** 破坏性确认（经典"确定"）：聚焦时红底 */
  danger?: boolean;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { message, commands, options, onConfirm, onCancel } = props;
  const buttons: DialogButton[] = options
    ? [...options, { label: t("button.cancel"), action: onCancel }]
    : [
        { label: t("button.confirm"), action: () => onConfirm?.(), danger: true },
        { label: t("button.cancel"), action: onCancel },
      ];
  const [focus, setFocus] = useState(0);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel();
      key.preventDefault();
    } else if (key.name === "left" || key.name === "right" || key.name === "tab") {
      const delta = key.name === "left" ? -1 : 1;
      setFocus((f) => (f + delta + buttons.length) % buttons.length);
      key.preventDefault();
    } else if (key.name === "return") {
      buttons[focus]?.action();
      key.preventDefault();
    }
  });

  // options 模式预览聚焦按钮的命令；经典模式静态展示 commands
  const preview: string[] = options
    ? buttons[focus]?.command
      ? [buttons[focus].command]
      : []
    : (commands ?? []);

  return (
    <ModalBackdrop>
      <box flexDirection="column" backgroundColor="#1a1a1a" padding={1} width={64}>
        <text fg="#eee">{message}</text>
        {preview.length > 0 ? (
          <box flexDirection="column" marginTop={1}>
            {preview.map((c, i) => (
              <text key={i} fg="#6cf">
                {"  "}
                {c}
              </text>
            ))}
          </box>
        ) : null}
        <box flexDirection="row" marginTop={1} justifyContent="center">
          {buttons.map((b, i) => {
            const bg = i === focus ? (b.danger ? "#a33" : "#264f78") : "#333";
            return (
              <text
                key={i}
                fg="#fff"
                bg={bg}
                marginLeft={i > 0 ? 2 : 0}
                onMouseDown={(event) => {
                  if (event.button !== MouseButton.LEFT) return;
                  event.stopPropagation();
                  setFocus(i);
                  b.action();
                }}
              >{` ${b.label} `}</text>
            );
          })}
        </box>
      </box>
    </ModalBackdrop>
  );
}
