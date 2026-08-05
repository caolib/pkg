/**
 * 全局搜索界面。
 *
 * 由顶栏「搜索」按钮打开的 overlay：默认并发搜索所有可用包管理器；相同 registry
 * 的管理器（如 npm/pnpm/bun）只搜一次（默认用 npm），不同 registry 各自搜索。
 * 结果按包名合并并标注来源管理器；回车/i 直接用代表管理器安装，
 * v/双击查看详情，Esc 返回。
 *
 * 搜索范围条（"全部" + 各 registry 代表：同 registry 的 pnpm/bun 并入 npm，
 * 不单独显示）位于搜索框右侧，参考首页顶栏布局，默认 "全部"。搜索框聚焦时
 * → 进范围条；范围条 ← → 直接切换并高亮、最左项再 ←
 * 回输入框、↓ 进表格、↑ 回输入框；结果表格聚焦时 ← → 也切换搜索范围：选中
 * 具体管理器则只用该管理器搜索，已搜索过的查询会自动对新范围重新搜索。
 * 对应原 Python 项目的 screens/search_screen.py。
 */

import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { InputRenderable } from "@opentui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { isTextInputFocused } from "../focus";
import { t } from "../i18n";
import { formatRelativeTime } from "../date";
import {
  FALLBACK_BACKGROUND,
  getTerminalBackground,
  getTerminalBackgroundSync,
} from "../terminal-colors";
import type { PackageManager, SearchResult } from "../managers";
import { shownResultName } from "../managers";
import { ALL_MANAGERS, buildSearchGroups, type SearchGroup } from "../runtime";
import { PackageTable, type TableColumn } from "../components/PackageTable";
import { LoadingIndicator } from "../components/LoadingIndicator";

interface SearchRow {
  key: string;
  sourceLabel: string;
  repName: string;
  rep: PackageManager;
  result: SearchResult;
}

export interface SearchScreenProps {
  managers: PackageManager[];
  /** 范围条按钮的图标前缀（含尾随空格），缺省时用管理器自带 icon */
  managerIcon?: (name: string) => string;
  /** 管理器显示名（配置自定义），缺省用默认 name */
  managerName?: (name: string) => string;
  /** false=被上层 overlay（详情/确认框等）压住：不响应按键、输入框不聚焦 */
  active?: boolean;
  onClose: () => void;
  onView: (manager: PackageManager, name: string, title: string) => void;
  onInstall: (managerName: string, name: string) => void;
  /** o 查看命令输出（与主界面 view_output 一致）：输入框聚焦打字时不触发 */
  onViewOutput?: () => void;
}

/** 范围条项：name 为 ALL_MANAGERS 表示"全部"，否则为具体管理器名。 */
interface ScopeItem {
  name: string;
  label: string;
}

export function SearchScreen(props: SearchScreenProps) {
  const { managers, managerIcon, managerName, active = true, onClose, onView, onInstall, onViewOutput } = props;

  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const { groups } = useMemo(() => buildSearchGroups(managers), [managers]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [focusOnTable, setFocusOnTable] = useState(false);
  // 搜索范围条键盘聚焦项索引（-1=焦点不在范围条）
  const [stripFocus, setStripFocus] = useState(-1);
  // 当前搜索范围：ALL_MANAGERS 或具体管理器名
  const [target, setTarget] = useState<string>(ALL_MANAGERS);
  // 最近一次实际执行的查询（切换范围时据此自动重搜）
  const [lastQuery, setLastQuery] = useState("");
  // 搜索结果缓存：按查询词分组，每组内按 registry 代表名存该代表搜到的结果。
  // 切换范围时若该查询已有缓存则直接从缓存筛选展示，不重复发起子进程搜索。
  // cache 为 ref（跨渲染稳定、不触发重渲），其变更后由 setRows 驱动渲染。
  // results=null 表示该代表搜索失败（仍记入缓存，避免重试，失败来源由状态提示）
  const cacheRef = useRef<
    Map<string, Map<string, { sourceLabel: string; results: SearchResult[] | null }>>
  >(new Map());
  // 已完成搜索的代表集合（针对当前查询）：用于状态提示"还有 N 个来源搜索中"
  const [doneReps, setDoneReps] = useState<string[]>([]);
  // 当前正在执行的搜索（用于切换范围/新查询时取消上一个未完成的搜索）
  const searchSeqRef = useRef(0);
  const inputRef = useRef<InputRenderable | null>(null);
  // 背景色跟随主页（终端默认背景色）。主页打开时已触发 getTerminalBackground
  // 并模块级缓存，这里直接同步读缓存初始化，避免先渲染一帧 FALLBACK（深色闪烁）
  // 再切换到真实背景；缓存未就绪时回退 FALLBACK，effect 再补正。
  const [termBg, setTermBg] = useState<string>(
    () => getTerminalBackgroundSync() ?? FALLBACK_BACKGROUND,
  );

  useEffect(() => {
    const bg = getTerminalBackgroundSync();
    if (bg && bg !== termBg) setTermBg(bg);
    getTerminalBackground(renderer).then((b) => {
      if (b !== termBg) setTermBg(b);
    });
  }, [renderer]);

  /** 范围条项："全部" + 各 registry 代表（同 registry 的 pnpm/bun 并入 npm，
   *  不单独占按钮——搜哪个都是同一 registry）。 */
  const stripItems: ScopeItem[] = useMemo(() => {
    const showIcons = width >= 100;
    const items: ScopeItem[] = [
      {
        name: ALL_MANAGERS,
        label: (showIcons ? (managerIcon?.(ALL_MANAGERS) ?? "◈ ") : "") + t("button.all"),
      },
    ];
    for (const g of groups) {
      const rep = g.rep;
      const icon = showIcons ? (managerIcon?.(rep.name) ?? (rep.icon ? `${rep.icon} ` : "")) : "";
      items.push({ name: rep.name, label: icon + (managerName?.(rep.name) ?? rep.name) });
    }
    return items;
  }, [groups, managerIcon, managerName, width]);

  /** 当前 target 在范围条中的索引。 */
  function targetIndex(): number {
    const i = stripItems.findIndex((it) => it.name === target);
    return i < 0 ? 0 : i;
  }

  /** 焦点交给输入框。 */
  function focusInput() {
    setFocusOnTable(false);
    setStripFocus(-1);
  }

  /** 焦点交给范围条（停留在当前选中项）。 */
  function focusStrip() {
    focusStripAt(targetIndex());
  }

  /** 焦点交给范围条指定索引（← 从输入框循环到最右按钮时用）。 */
  function focusStripAt(index: number) {
    setFocusOnTable(false);
    setStripFocus(index);
    inputRef.current?.blur();
  }

  /** 焦点交给结果表格：state 与渲染器真实焦点一起切（鼠标点过 input 时
   * focused prop 已是 false，React diff 不出变化，必须显式 blur）。 */
  function focusTable() {
    setFocusOnTable(true);
    setStripFocus(-1);
    inputRef.current?.blur();
  }

  // 列宽由 autoFitWidths 按内容自动测量（显示宽度），width 仅作保底。
  // 只有"全部"范围才需要标注来源管理器，单管理器范围整列都是同一来源，隐藏。
  const showManagerCol = target === ALL_MANAGERS;
  const managerColumn: TableColumn<SearchRow> = {
    key: "manager",
    label: t("col.manager"),
    width: 12,
    render: (r) => managerName?.(r.sourceLabel) ?? r.sourceLabel,
  };
  const columns: TableColumn<SearchRow>[] = [
    ...(showManagerCol ? [managerColumn] : []),
    { key: "name", label: t("col.name"), width: 30, render: (r) => shownResultName(r.result) },
    { key: "version", label: t("col.version"), width: 14, render: (r) => r.result.version || "-" },
    {
      key: "date",
      label: t("col.date"),
      width: 12,
      render: (r) => (r.result.date ? formatRelativeTime(r.result.date) : "-"),
    },
    // 描述放最后一列，避免挤压后面列；也受益于 autoFitWidths 的内容测量
    {
      key: "description",
      label: t("col.description"),
      width: 40,
      render: (r) => r.result.description || "-",
      maxColumnWidth: 80,
    },
  ];

  /** 根据搜索范围计算要并发搜索的 registry 代表组。 */
  function searchTargets(targetName: string): SearchGroup[] {
    if (targetName === ALL_MANAGERS) return groups;
    const g = groups.find((x) => x.rep.name === targetName);
    return g ? [g] : [];
  }

  /** 从缓存按当前范围重新组装展示行（不发起子进程搜索）。 */
  function rebuildRowsFromCache(q: string, targetName: string): SearchRow[] {
    const byRep = cacheRef.current.get(q);
    if (!byRep) return [];
    const targets = searchTargets(targetName);
    const merged: SearchRow[] = [];
    const seen = new Set<string>();
    for (const g of targets) {
      const hit = byRep.get(g.rep.name);
      if (!hit || hit.results === null) continue;
      for (const r of hit.results) {
        if (seen.has(r.name)) continue;
        seen.add(r.name);
        merged.push({
          key: r.name,
          sourceLabel: hit.sourceLabel,
          repName: g.rep.name,
          rep: g.rep,
          result: r,
        });
      }
    }
    return merged;
  }

  /** 计算当前范围内已知失败的代表列表（来自缓存）。 */
  function failedRepsFromCache(q: string, targetName: string): string[] {
    const byRep = cacheRef.current.get(q);
    if (!byRep) return [];
    const targets = searchTargets(targetName);
    const failed: string[] = [];
    for (const g of targets) {
      const hit = byRep.get(g.rep.name);
      if (hit && hit.results === null) {
        failed.push(managerName?.(g.sourceLabel) ?? g.sourceLabel);
      }
    }
    return failed;
  }

  /** 更新状态文案：根据已完成数 / 失败来源 / 结果计数组合。 */
  function refreshStatus(q: string, targetName: string, currentRows: SearchRow[], done: string[]) {
    const targets = searchTargets(targetName);
    const totalReps = targets.length;
    const failed = failedRepsFromCache(q, targetName);
    const failedNote =
      failed.length > 0 ? t("search.status_partial_failed", { names: failed.join(", ") }) : "";
    if (done.length < totalReps) {
      // 仍有来源搜索中：显示"搜索中" + 已找到数
      setStatus(t("search.status_searching", { query: q }) + ` (${currentRows.length})`);
    } else {
      setStatus(
        currentRows.length > 0
          ? t("search.status_results", { count: String(currentRows.length) }) + failedNote
          : t("search.status_no_results") + failedNote,
      );
    }
  }

  async function doSearch(q: string, targetName?: string, focusAfter = true) {
    const tgt = targetName ?? target;
    const targets = searchTargets(tgt);
    // 缓存命中：直接展示，不重复搜索
    const cached = cacheRef.current.get(q);
    if (cached && targets.every((g) => cached.has(g.rep.name))) {
      const merged = rebuildRowsFromCache(q, tgt);
      setRows(merged);
      setCursor(0);
      setLoading(false);
      setLastQuery(q);
      setDoneReps([...cached.keys()]);
      refreshStatus(q, tgt, merged, [...cached.keys()]);
      if (merged.length > 0 && focusAfter) focusTable();
      return;
    }

    // 新查询或部分缓存：增量搜索。先清空展示，进入加载态。
    setLoading(true);
    setStatus(t("search.status_searching", { query: q }));
    setRows([]);
    setCursor(0);
    setLastQuery(q);
    setDoneReps([]);
    const byRep =
      cacheRef.current.get(q) ??
      new Map<string, { sourceLabel: string; results: SearchResult[] | null }>();
    cacheRef.current.set(q, byRep);

    // 取消上一个未完成的搜索：递增序号，闭包内捕获本序号，过期则忽略
    const seq = ++searchSeqRef.current;
    const done: string[] = [];

    // 并发搜索各 registry 代表，单个完成即增量展示
    targets.forEach((g) => {
      const repName = g.rep.name;
      // 该代表已缓存（如上一次"全部"已搜过）则直接标记完成，不重发搜索
      if (byRep.has(repName)) {
        done.push(repName);
        const merged = rebuildRowsFromCache(q, tgt);
        setRows(merged);
        setDoneReps([...done]);
        refreshStatus(q, tgt, merged, done);
        return;
      }
      g.rep
        .search(q)
        .then((results: SearchResult[]) => {
          // 序号过期：用户已发起新查询，丢弃本次结果
          if (seq !== searchSeqRef.current) return;
          byRep.set(repName, { sourceLabel: g.sourceLabel, results });
          done.push(repName);
          const merged = rebuildRowsFromCache(q, tgt);
          setRows(merged);
          setDoneReps([...done]);
          const allDone = done.length >= targets.length;
          if (allDone) setLoading(false);
          refreshStatus(q, tgt, merged, done);
          if (allDone && merged.length > 0 && focusAfter) focusTable();
        })
        .catch(() => {
          if (seq !== searchSeqRef.current) return;
          // 失败也记入缓存（results=null 标记失败），与 allSettled 不静默吞错一致
          byRep.set(repName, { sourceLabel: g.sourceLabel, results: null });
          done.push(repName);
          const merged = rebuildRowsFromCache(q, tgt);
          setRows(merged);
          setDoneReps([...done]);
          if (done.length >= targets.length) setLoading(false);
          refreshStatus(q, tgt, merged, done);
        });
    });
  }

  /** 切换搜索范围（±1 循环）。focusStrip=true 时焦点停留在范围条。 */
  function switchTarget(delta: number, focusStrip = false) {
    const idx = (targetIndex() + delta + stripItems.length) % stripItems.length;
    const name = stripItems[idx].name;
    setTarget(name);
    if (focusStrip) setStripFocus(idx);
    if (lastQuery) doSearch(lastQuery, name, false);
  }

  /** 鼠标点击范围条项：选中并（若已搜过）重搜，焦点模式不变。 */
  function selectTarget(name: string) {
    setTarget(name);
    if (lastQuery) doSearch(lastQuery, name, false);
  }

  useKeyboard((key) => {
    // 被上层 overlay 压住时不响应按键（overlay 栈仅顶层交互，见 App）
    if (!active) return;
    if (key.name === "escape") {
      onClose();
      key.preventDefault();
      return;
    }
    // o 查看命令输出（与主界面一致）：输入框聚焦打字时不触发，范围条/表格
    // 聚焦时均可。不传 onViewOutput 时不拦截（兼容旧调用方/测试）
    if (onViewOutput && key.name === "o" && !isTextInputFocused(renderer)) {
      onViewOutput();
      key.preventDefault();
      return;
    }
    // / 聚焦搜索框（与主界面 / 进入过滤模式一致）：从范围条/表格切回输入框。
    // 输入框聚焦打字时不拦截——/ 是合法搜索字符（如 "foo/bar"），归 input
    if ((key.name === "/" || key.name === "slash") && !isTextInputFocused(renderer)) {
      focusInput();
      key.preventDefault();
      return;
    }
    // --- 范围条聚焦：← → 切换范围（最左项 ← 回输入框，最右项 → 也回输入框），
    // ↓ 进表格，↑ 回输入框，enter 进表格 ---
    if (stripFocus >= 0 && !isTextInputFocused(renderer)) {
      if (key.name === "left") {
        if (stripFocus === 0) focusInput();
        else switchTarget(-1, true);
        key.preventDefault();
      } else if (key.name === "right") {
        if (stripFocus === stripItems.length - 1) focusInput();
        else switchTarget(1, true);
        key.preventDefault();
      } else if (key.name === "down") {
        focusTable();
        key.preventDefault();
      } else if (key.name === "up") {
        focusInput();
        key.preventDefault();
      } else if (key.name === "return" || key.name === " ") {
        focusTable();
        key.preventDefault();
      }
      return;
    }
    // 输入框正在接收文本时（含鼠标点击聚焦，此时 focusOnTable 可能仍为 true），
    // 字符键一律归 input，否则 i/v 等会在打字时被当成快捷键（见 src/focus.ts）
    if (!focusOnTable || isTextInputFocused(renderer)) {
      // Enter 由 input 的 onSubmit 处理；↓ 或 →（搜索框在左，横向导航）进范围条。
      // ← 反向循环到最右按钮；鼠标点击进输入框的编辑场景不拦截 ← →（保留文本光标移动）。
      if (key.name === "down") {
        focusStrip();
        key.preventDefault();
      } else if (key.name === "right" && !focusOnTable) {
        // 与 ← 对称：← 进范围条最右按钮，→ 进最左按钮（曾 bug：用 focusStrip()
        // 落在当前 target 上，从最右按钮绕回输入框后 target 仍是最后一个，再 → 就
        // 直接跳回最右，跳过中间的按钮）
        focusStripAt(0);
        key.preventDefault();
      } else if (key.name === "left" && !focusOnTable) {
        focusStripAt(stripItems.length - 1);
        key.preventDefault();
      }
      return;
    }
    // 表格内
    if (key.name === "left") {
      switchTarget(-1);
      key.preventDefault();
    } else if (key.name === "right") {
      switchTarget(1);
      key.preventDefault();
    } else if (key.name === "up") {
      if (cursor > 0) setCursor(cursor - 1);
      else focusStrip();
      key.preventDefault();
    } else if (key.name === "down") {
      if (cursor < rows.length - 1) setCursor(cursor + 1);
      key.preventDefault();
    } else if (key.name === "return") {
      const row = rows[cursor];
      if (row) onInstall(row.repName, row.result.name);
      key.preventDefault();
    } else if (key.name === "i") {
      const row = rows[cursor];
      if (row) onInstall(row.repName, row.result.name);
      key.preventDefault();
    } else if (key.name === "v") {
      const row = rows[cursor];
      if (row) onView(row.rep, row.result.name, shownResultName(row.result));
      key.preventDefault();
    }
  });

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={termBg}
      flexDirection="column"
    >
      {/* 整屏 overlay：用不透明的背景盖住主界面（主界面背景透明跟随终端主题，
          这里必须实底，否则底层表格会透出来）。背景取终端默认背景色以跟随主页
          （terminal-colors.ts），检测失败回退应用表面色 #1d1d26。
          顶部行与首页顶栏一样贴顶（无 paddingTop，否则顶部会多一条背景色黑带） */}
      <box flexDirection="row" alignItems="center" paddingLeft={1}>
        <box flexGrow={1}>
          <input
            ref={inputRef}
            placeholder={t("search.placeholder")}
            value={query}
            onInput={setQuery}
            onSubmit={
              ((v: string) => {
                const s = String(v);
                if (s.trim()) doSearch(s.trim());
              }) as any
            }
            // 点击输入框 = 回到输入模式（渲染器焦点已转移，state 需跟上）
            onMouseDown={focusInput}
            // 被上层 overlay 压住时不聚焦：否则字符键会穿过上层落进搜索框
            focused={active && !focusOnTable && stripFocus < 0}
            backgroundColor="#111"
            focusedBackgroundColor="#222"
            textColor="#eee"
          />
        </box>
        {stripItems.map((it, i) => {
          const active = it.name === target;
          const focused = stripFocus === i;
          const bg = focused ? (active ? "#3d7fc9" : "#4a4a4a") : active ? "#264f78" : "#2a2a2a";
          const fg = focused || active ? "#fff" : "#bbb";
          return (
            <text
              key={it.name}
              fg={fg}
              bg={bg}
              onMouseDown={() => selectTarget(it.name)}
            >{` ${it.label} `}</text>
          );
        })}
      </box>
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        <PackageTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          cursor={cursor}
          // 高度按终端动态算：输入行 1 + 底栏 1 = 2 行非表格区。
          // scrollX 开启但内容未横向溢出时，PackageTable 会回收横向滚动条的预留行
          //（见 PackageTable 的 resetVisibilityControl），故视口=容器，需 height-2 行数据
          // 填满；溢出时滚动条占 1 行，多渲染的 1 行被视口裁剪（无空白行）。
          visibleRows={Math.max(4, height - 2)}
          autoFitWidths
          scrollX
          emptyHint={loading ? <LoadingIndicator /> : status}
          onRowClick={(_, index) => {
            focusTable();
            setCursor(index);
          }}
          onRowDoubleClick={(row) => onView(row.rep, row.result.name, shownResultName(row.result))}
          onScrollMove={(delta) => {
            const max = Math.max(0, rows.length - 1);
            setCursor((c) => Math.min(max, Math.max(0, c + delta)));
          }}
        />
      </box>
      {/* 底栏：操作提示（左，同主页底栏布局）+ 搜索状态（右：搜索中/结果计数/失败标注） */}
      <box flexDirection="row" height={1} backgroundColor="#111" paddingLeft={1} paddingRight={1}>
        <text fg="#666">{`${t("binding.install")} i   ${t("binding.detail")} v   ${t("binding.output")} o   / ${t("binding.focus_search")}`}</text>
        <box flexGrow={1} />
        <text fg="#888">{loading ? t("search.status_searching", { query: query }) : status}</text>
      </box>
    </box>
  );
}
