/**
 * 顶栏管理器按钮组 + 设置/搜索按钮 + 本地过滤输入框。
 *
 * 对应原 Python 项目 app.py 中的 #manager-strip：设置 + 搜索 + 过滤框 + "全部"
 * + 各可用管理器按钮，顺序即焦点顺序。当前选中管理器的按钮高亮，
 * 键盘聚焦项（父组件 stripFocus）额外高亮。← → 在项间循环、↓ 进表格、
 * ↑ 从表格首行回顶栏、enter 激活，均由父组件 MainScreen 统一用 useKeyboard
 * 处理；本组件只渲染。
 */

import { type ReactNode, type Ref } from "react"
import type { InputRenderable } from "@opentui/core"
import { t } from "../i18n"
import { ALL_MANAGERS, type ManagerRegistry } from "../runtime"

/** 顶栏项类型。 */
export type StripItemKind = "settings" | "search" | "filter" | "manager"

export interface StripItem {
  kind: StripItemKind
  /** manager 项的管理器名（含 ALL_MANAGERS）；其余为 null */
  name: string | null
  label: string
  /** 是否当前选中的视图（manager 项才可能为 true） */
  active: boolean
}

export interface ManagerStripProps {
  items: StripItem[]
  /** 键盘聚焦项索引（对应 items）：聚焦项额外高亮；-1 表示焦点在表格 */
  stripFocus: number
  /** 是否处于过滤输入模式（true 时 input 获得焦点并接收键盘） */
  filterMode: boolean
  filterText: string
  /** 过滤输入框实例，供父组件在退出过滤模式时显式 blur */
  inputRef?: Ref<InputRenderable>
  /** 鼠标点击过滤框时回调：让 filterMode 跟上渲染器的真实焦点 */
  onFilterFocus?: () => void
  onFilter: (value: string) => void
  onButton: (kind: StripItemKind, name: string | null) => void
}

export function ManagerStrip(props: ManagerStripProps): ReactNode {
  const { items, stripFocus, filterMode, filterText, inputRef, onFilterFocus, onFilter, onButton } = props

  return (
    <box flexDirection="row" height={1} alignItems="center">
      {items.map((it, i) => {
        if (it.kind === "filter") {
          const filterFocused = stripFocus >= 0 && stripFocus === i
          return (
            <box key={`strip-${i}`} flexGrow={1}>
              <input
                ref={inputRef}
                placeholder={t("filter.placeholder")}
                value={filterText}
                onInput={onFilter}
                // 鼠标点击会让渲染器直接把焦点给 input，父组件的 filterMode
                // 不会自动跟上；这里回传以保持二者同步（否则打字时字符键会
                // 同时被主界面当快捷键执行）
                onMouseDown={onFilterFocus}
                // 仅在过滤输入模式时聚焦，避免 input 默认夺取焦点而吞掉
                // 表格所需的 ↑↓/s/u/d 等按键（OpenTUI 的 input 聚焦会消费 keyInput）
                focused={filterMode}
                backgroundColor={filterMode || filterFocused ? "#222" : "#111"}
                focusedBackgroundColor="#222"
                textColor="#eee"
              />
            </box>
          )
        }
        // 视觉高亮：active=当前选中视图；focused=键盘聚焦（顶栏模式 ← → 可到达）
        const focused = stripFocus >= 0 && stripFocus === i
        const bg = focused
          ? it.active
            ? "#3d7fc9"
            : "#4a4a4a"
          : it.active
            ? "#264f78"
            : "#1a1a1a"
        const fg = focused || it.active ? "#fff" : "#bbb"
        return (
          <text
            key={`strip-${i}`}
            fg={fg}
            bg={bg}
            onMouseDown={() => onButton(it.kind, it.name)}
          >{` ${it.label} `}</text>
        )
      })}
    </box>
  )
}

/** 在 MainScreen 中根据 reg/current 构造顶栏项列表。 */
export function buildStripItems(reg: ManagerRegistry, current: string): StripItem[] {
  const items: StripItem[] = [
    { kind: "settings", name: null, label: t("button.settings"), active: false },
    { kind: "search", name: null, label: t("button.search"), active: false },
    { kind: "filter", name: null, label: t("filter.placeholder"), active: false },
  ]
  items.push({
    kind: "manager",
    name: ALL_MANAGERS,
    label: reg.managerIcon(ALL_MANAGERS) + t("button.all"),
    active: current === ALL_MANAGERS,
  })
  for (const n of reg.names) {
    const st = reg.states.get(n)!
    if (!st.available || st.disabled) continue
    items.push({
      kind: "manager",
      name: n,
      label: reg.managerIcon(n) + n,
      active: current === n,
    })
  }
  return items
}
