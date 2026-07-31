/**
 * 全局搜索界面。
 *
 * 由顶栏「搜索」按钮打开的 overlay：并发搜索所有可用包管理器；相同 registry
 * 的管理器（如 npm/pnpm/bun）只搜一次（默认用 npm），不同 registry 各自搜索。
 * 结果按包名合并并标注来源管理器；回车/双击 = 弹管理器选择安装（这里简化为
 * 直接用代表管理器安装，或同组第一个），v 查看详情，Esc 返回。
 * 对应原 Python 项目的 screens/search_screen.py。
 */

import { useKeyboard, useRenderer } from "@opentui/react"
import type { InputRenderable } from "@opentui/core"
import { useMemo, useRef, useState } from "react"
import { isTextInputFocused } from "../focus"
import { t } from "../i18n"
import type { PackageManager, SearchResult } from "../managers"
import { shownResultName } from "../managers"
import {
  buildSearchGroups,
  type SearchGroup,
} from "../runtime"
import { PackageTable, type TableColumn } from "../components/PackageTable"

interface SearchRow {
  key: string
  sourceLabel: string
  repName: string
  rep: PackageManager
  result: SearchResult
}

export interface SearchScreenProps {
  managers: PackageManager[]
  onClose: () => void
  onView: (manager: PackageManager, name: string, title: string) => void
  onInstall: (managerName: string, name: string) => void
}

export function SearchScreen(props: SearchScreenProps) {
  const { managers, onClose, onView, onInstall } = props

  const renderer = useRenderer()
  const { groups, repMap } = useMemo(() => buildSearchGroups(managers), [managers])
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<string>(t("search.status_initial"))
  const [rows, setRows] = useState<SearchRow[]>([])
  const [cursor, setCursor] = useState(0)
  const [loading, setLoading] = useState(false)
  const [focusOnTable, setFocusOnTable] = useState(false)
  const inputRef = useRef<InputRenderable | null>(null)

  /** 焦点交给结果表格：state 与渲染器真实焦点一起切（鼠标点过 input 时
   * focused prop 已是 false，React diff 不出变化，必须显式 blur）。 */
  function focusTable() {
    setFocusOnTable(true)
    inputRef.current?.blur()
  }

  const columns: TableColumn<SearchRow>[] = [
    { key: "manager", label: t("col.manager"), width: 12, render: (r) => r.sourceLabel },
    { key: "name", label: t("col.name"), width: 30, render: (r) => shownResultName(r.result) },
    { key: "version", label: t("col.version"), width: 14, render: (r) => r.result.version || "-" },
    { key: "description", label: t("col.description"), width: 40, render: (r) => r.result.description || "-" },
    { key: "date", label: t("col.date"), width: 12, render: (r) => r.result.date || "-" },
  ]

  async function doSearch(q: string) {
    setLoading(true)
    setStatus(t("search.status_searching", { query: q }))
    setRows([])
    setCursor(0)
    // 并发搜索各 registry 代表，单个失败不影响其余
    const results = await Promise.allSettled(groups.map((g) => g.rep.search(q)))
    const merged: SearchRow[] = []
    const seen = new Set<string>()
    groups.forEach((g, i) => {
      const res = results[i]
      if (res.status !== "fulfilled") return
      for (const r of res.value) {
        if (seen.has(r.name)) continue
        seen.add(r.name)
        merged.push({
          key: r.name,
          sourceLabel: g.sourceLabel,
          repName: g.rep.name,
          rep: g.rep,
          result: r,
        })
      }
    })
    setRows(merged)
    setLoading(false)
    setStatus(merged.length > 0 ? t("search.status_results", { count: String(merged.length) }) : t("search.status_no_results"))
    if (merged.length > 0) focusTable()
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose()
      key.preventDefault()
      return
    }
    // 输入框正在接收文本时（含鼠标点击聚焦，此时 focusOnTable 可能仍为 true），
    // 字符键一律归 input，否则 i/v 等会在打字时被当成快捷键（见 src/focus.ts）
    if (!focusOnTable || isTextInputFocused(renderer)) {
      // Enter 由 input 的 onSubmit 处理，这里只处理 ↓ 切到结果表格
      if (key.name === "down" && rows.length > 0) {
        focusTable()
        key.preventDefault()
      }
      return
    }
    // 表格内
    if (key.name === "up") {
      if (cursor > 0) setCursor(cursor - 1)
      else setFocusOnTable(false)
      key.preventDefault()
    } else if (key.name === "down") {
      if (cursor < rows.length - 1) setCursor(cursor + 1)
      key.preventDefault()
    } else if (key.name === "return") {
      const row = rows[cursor]
      if (row) onInstall(row.repName, row.result.name)
      key.preventDefault()
    } else if (key.name === "i") {
      const row = rows[cursor]
      if (row) onInstall(row.repName, row.result.name)
      key.preventDefault()
    } else if (key.name === "v") {
      const row = rows[cursor]
      if (row) onView(row.rep, row.result.name, shownResultName(row.result))
      key.preventDefault()
    }
  })

  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" backgroundColor="#0d0d0d" flexDirection="column">
      <box paddingLeft={1} paddingTop={1}>
        <input
          ref={inputRef}
          placeholder={t("search.placeholder", { names: managers.map((m) => m.name).join("/") })}
          value={query}
          onInput={setQuery}
          onSubmit={((v: string) => {
            const s = String(v)
            if (s.trim()) doSearch(s.trim())
          }) as any}
          // 点击输入框 = 回到输入模式（渲染器焦点已转移，state 需跟上）
          onMouseDown={() => setFocusOnTable(false)}
          focused={!focusOnTable}
          backgroundColor="#111"
          focusedBackgroundColor="#222"
          textColor="#eee"
        />
      </box>
      <box paddingLeft={1} height={1}>
        <text fg="#888">{loading ? t("search.status_searching", { query: query }) : status}</text>
      </box>
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        <PackageTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          cursor={cursor}
          visibleRows={20}
          emptyHint={loading ? t("detail.loading") : t("search.status_initial")}
        />
      </box>
      <box flexDirection="row" height={1} backgroundColor="#111" paddingLeft={1}>
        <text fg="#666">
          {`${t("binding.install")} i  ${t("binding.detail")} v  ${t("binding.back")} Esc`}
        </text>
      </box>
    </box>
  )
}
