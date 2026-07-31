/**
 * 自建轻量交互表格组件 PackageTable。
 *
 * OpenTUI 没有内置 DataTable，这里用一个受控的 box+text 表格：
 *  - 表头行（加粗、黯淡色）；
 *  - 数据行以 box 横排单元格，光标行高亮整行背景、奇数行斑马纹；
 *  - 勾选行前缀 ✓；
 *  - 超过可见高度的行被裁剪，并自动滚动让光标行保持可见；
 *  - 单元格用 width 限定列宽、truncate 裁切超宽文本（无 ellipsis 字符）。
 *
 * 本组件只负责渲染（受控），不处理键盘——光标移动与选中由父组件统一
 * 通过 useKeyboard 分发，再回写 cursor / onSelect，避免多组件抢占键盘。
 *
 * 注意：OpenTUI 的 <text> 不支持 backgroundColor（只能用 bg），且不支持
 * ellipsis；行高亮放在 <box> 的 backgroundColor 上，宽度靠 width 限定。
 */

import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"

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
  } = props

  if (rows.length === 0) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg="#888">{emptyHint ?? ""}</text>
      </box>
    )
  }

  // 计算滚动窗口：让光标行始终可见
  const viewHeight = visibleRows > 0 ? visibleRows : Math.max(rows.length, 1)
  let windowStart = 0
  if (cursor >= viewHeight) windowStart = cursor - viewHeight + 1
  if (windowStart < 0) windowStart = 0
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
    const zebra = globalIndex % 2 === 1
    const rowBg = isCursor ? "#264f78" : zebra ? "#1a1a1a" : "transparent"

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
      <box key={`r-${key}`} flexDirection="row" backgroundColor={rowBg}>
        {cells}
      </box>
    )
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row">{headerCells}</box>
      <box flexDirection="column" flexGrow={1}>{bodyRows}</box>
    </box>
  )
}
