/**
 * 自建轻量交互表格组件 PackageTable。
 *
 * OpenTUI 没有内置 DataTable，这里用一个受控的 box+text 表格：
 *  - 表头行（加粗、黯淡色）；
 *  - 数据行以 box 横排单元格，光标行高亮整行背景、鼠标悬浮行灰色高亮；
 *  - 勾选行前缀 ✓；
 *  - 超过可见高度的行被裁剪，并自动滚动让光标行保持可见；
 *  - 单元格用 width 限定列宽、truncate 裁切超宽文本（无 ellipsis 字符）；
 *  - 鼠标滚轮上下滚动移动光标（由父组件响应 onScrollMove 回写 cursor）。
 *
 * 本组件负责渲染和行鼠标事件（单击/双击），键盘仍由父组件统一处理——
 * 光标移动与选中通过 cursor / onRowClick 回写，避免多组件抢占键盘。
 *
 * 注意：OpenTUI 的 <text> 不支持 backgroundColor（只能用 bg），且不支持
 * ellipsis；行高亮放在 <box> 的 backgroundColor 上，宽度靠 width 限定。
 */

import { MouseButton, TextAttributes, type MouseEvent } from "@opentui/core"
import { useRef, useState, type ReactNode } from "react"

const DOUBLE_CLICK_INTERVAL_MS = 400

/** 一个列定义。 */
export interface TableColumn<R> {
  key: string
  /** 表头文案（已翻译） */
  label: string
  /** 列宽（字符数） */
  width: number
  render: (row: R) => ReactNode
  /** 单元格前景色覆盖（用于高亮可更新版本等），返回颜色串 */
  fgOverride?: (row: R) => string | undefined
}

export interface PackageTableProps<R> {
  columns: TableColumn<R>[]
  rows: R[]
  rowKey: (row: R, index: number) => string
  /** 当前光标行索引 */
  cursor: number
  /** 已勾选行的 key 集合（在 checkColumnIndex 列前缀 ✓） */
  checkedKeys?: Set<string>
  /** 第几列显示勾选前缀（默认 0） */
  checkColumnIndex?: number
  /** 可见数据行高度（不含表头） */
  visibleRows?: number
  /** 空表格时显示的提示文案 */
  emptyHint?: string
  /** 鼠标左键单击数据行 */
  onRowClick?: (row: R, index: number) => void
  /** 鼠标左键在限定时间内双击同一数据行 */
  onRowDoubleClick?: (row: R, index: number) => void
  /** 鼠标滚轮滚动：delta 为步数（正=向下，负=向上） */
  onScrollMove?: (delta: number) => void
}

export function PackageTable<R>(props: PackageTableProps<R>): ReactNode {
  const {
    columns,
    rows,
    rowKey,
    cursor,
    checkedKeys,
    checkColumnIndex = 0,
    visibleRows = 0,
    emptyHint,
    onRowClick,
    onRowDoubleClick,
    onScrollMove,
  } = props

  const windowStartRef = useRef(0)
  const lastClickRef = useRef<{ key: string; at: number } | null>(null)
  /** 鼠标悬浮的行索引（-1=无） */
  const [hoverIndex, setHoverIndex] = useState(-1)

  if (rows.length === 0) {
    windowStartRef.current = 0
    lastClickRef.current = null
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg="#888">{emptyHint ?? ""}</text>
      </box>
    )
  }

  // 计算滚动窗口：让光标行始终可见
  const viewHeight = visibleRows > 0 ? visibleRows : Math.max(rows.length, 1)
  const maxWindowStart = Math.max(0, rows.length - viewHeight)
  let windowStart = Math.min(windowStartRef.current, maxWindowStart)
  if (cursor < windowStart) windowStart = cursor
  else if (cursor >= windowStart + viewHeight) windowStart = cursor - viewHeight + 1
  windowStart = Math.max(0, Math.min(windowStart, maxWindowStart))
  windowStartRef.current = windowStart
  const windowEnd = Math.min(windowStart + viewHeight, rows.length)
  const visible = rows.slice(windowStart, windowEnd)

  // 表头
  const headerCells: ReactNode[] = columns.map((col) => (
    <text
      key={`h-${col.key}`}
      width={col.width}
      fg="#888"
      attributes={TextAttributes.BOLD}
      truncate
      wrapMode="none"
    >
      {col.label}
    </text>
  ))

  const bodyRows: ReactNode[] = visible.map((row, vi) => {
    const globalIndex = windowStart + vi
    const isCursor = globalIndex === cursor
    const key = rowKey(row, globalIndex)
    const isChecked = checkedKeys?.has(key) ?? false
    // 高亮优先级：光标行 > 鼠标悬浮行 > 无
    const rowBg = isCursor ? "#264f78" : hoverIndex === globalIndex ? "#333" : "transparent"

    const cells = columns.map((col, ci) => {
      const content = col.render(row)
      const colorOverride = col.fgOverride?.(row)
      const cellFg = colorOverride ?? (isCursor ? "#fff" : "#ddd")
      const display = ci === checkColumnIndex ? (
        <text width={col.width} fg={cellFg} truncate wrapMode="none">
          {isChecked ? "✓ " : "  "}
          {content}
        </text>
      ) : (
        <text width={col.width} fg={cellFg} truncate wrapMode="none">
          {content}
        </text>
      )
      return <box key={`c-${col.key}`}>{display}</box>
    })

    return (
      <box
        key={`r-${key}`}
        flexDirection="row"
        backgroundColor={rowBg}
        onMouseOver={() => setHoverIndex(globalIndex)}
        onMouseOut={() => setHoverIndex((h) => (h === globalIndex ? -1 : h))}
        onMouseDown={(event) => {
          if (event.button !== MouseButton.LEFT) return
          event.stopPropagation()

          onRowClick?.(row, globalIndex)

          const now = performance.now()
          const lastClick = lastClickRef.current
          if (lastClick?.key === key && now - lastClick.at <= DOUBLE_CLICK_INTERVAL_MS) {
            lastClickRef.current = null
            onRowDoubleClick?.(row, globalIndex)
          } else {
            lastClickRef.current = { key, at: now }
          }
        }}
      >
        {cells}
      </box>
    )
  })

  const handleScroll = (event: MouseEvent) => {
    if (event.type !== "scroll" || !event.scroll) return
    event.preventDefault()
    event.stopPropagation()
    const { direction, delta } = event.scroll
    if (direction === "up") onScrollMove?.(-(delta || 1))
    else if (direction === "down") onScrollMove?.(delta || 1)
  }

  return (
    <box flexDirection="column" flexGrow={1} onMouseScroll={handleScroll}>
      <box flexDirection="row">{headerCells}</box>
      <box flexDirection="column" flexGrow={1}>{bodyRows}</box>
    </box>
  )
}
