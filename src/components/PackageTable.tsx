/**
 * 自建轻量交互表格组件 PackageTable。
 *
 * OpenTUI 没有内置 DataTable，这里用一个受控的 box+text 表格：
 *  - 表头行（加粗、黯淡色）；
 *  - 数据行以 box 横排单元格，光标行高亮整行背景、鼠标悬浮行灰色高亮；
 *  - 勾选行前缀 ✓；
 *  - 超过可见高度的行被裁剪，并自动滚动让光标行保持可见；
 *  - 单元格用 width 限定列宽、truncate 裁切超宽文本（无 ellipsis 字符）；
 *    相邻列之间用 columnGap（默认 2）留间隔；
 *  - 鼠标滚轮上下滚动移动光标（由父组件响应 onScrollMove 回写 cursor），
 *    每档滚动 VSCROLL_STEP 行，避免长列表滚起来太吃力；
 *  - autoFitWidths：按表头与内容（显示宽度，CJK/emoji 按 2 列）自动算列宽，
 *    内容比预设 width 更长时自动加宽，上限 maxColumnWidth；
 *  - scrollX：包一层 ScrollBox 支持横向滚动——内容超出视口时自动出现可
 *    拖动的横向滚动条（轨道点击/滑块拖动/Shift+滚轮均可），未超出时隐藏。
 *
 * 本组件负责渲染和行鼠标事件（单击/双击），键盘仍由父组件统一处理——
 * 光标移动与选中通过 cursor / onRowClick 回写，避免多组件抢占键盘。
 *
 * 注意：OpenTUI 的 <text> 不支持 backgroundColor（只能用 bg），且不支持
 * ellipsis；行高亮放在 <box> 的 backgroundColor 上，宽度靠 width 限定。
 */

import {
  MouseButton,
  TextAttributes,
  type MouseEvent,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { dispWidthStr } from "../width";

const DOUBLE_CLICK_INTERVAL_MS = 400;
/** autoFitWidths 时每列额外留出的左右边距（字符数） */
const AUTO_FIT_PADDING = 2;
/** autoFitWidths 时的列宽下限/上限 */
const AUTO_FIT_MIN_WIDTH = 6;
const AUTO_FIT_MAX_WIDTH = 60;
/** Shift+滚轮横向滚动每档步长（字符数） */
const HSCROLL_STEP = 8;
/** 滚轮每档纵向移动的行数（1 档 1 行太慢，长列表滚起来吃力） */
const VSCROLL_STEP = 3;

/** 一个列定义。 */
export interface TableColumn<R> {
  key: string;
  /** 表头文案（已翻译） */
  label: string;
  /** 列宽（字符数）；autoFitWidths 时仅作为测量不足时的保底值 */
  width: number;
  render: (row: R) => ReactNode;
  /** 单元格前景色覆盖（用于高亮可更新版本等），返回颜色串 */
  fgOverride?: (row: R) => string | undefined;
  /** autoFitWidths 时本列宽度上限，覆盖全局默认 */
  maxColumnWidth?: number;
}

export interface PackageTableProps<R> {
  columns: TableColumn<R>[];
  rows: R[];
  rowKey: (row: R, index: number) => string;
  /** 当前光标行索引 */
  cursor: number;
  /** 已勾选行的 key 集合（在 checkColumnIndex 列前缀 ✓） */
  checkedKeys?: Set<string>;
  /** 第几列显示勾选前缀（默认 0） */
  checkColumnIndex?: number;
  /** 可见数据行高度（不含表头） */
  visibleRows?: number;
  /** 空表格时显示的提示文案（字符串或富节点，如加载动画） */
  emptyHint?: ReactNode;
  /** 按内容自动测量列宽（显示宽度，CJK 计 2 列），超出 maxColumnWidth 上限 */
  autoFitWidths?: boolean;
  /** 相邻列之间的间隔（字符数，默认 2） */
  columnGap?: number;
  /** 启用横向滚动（内容超出视口时自动出现可拖动滚动条） */
  scrollX?: boolean;
  /** 鼠标左键单击数据行 */
  onRowClick?: (row: R, index: number) => void;
  /** 鼠标左键在限定时间内双击同一数据行 */
  onRowDoubleClick?: (row: R, index: number) => void;
  /** 鼠标滚轮滚动：delta 为步数（正=向下，负=向上） */
  onScrollMove?: (delta: number) => void;
}

/** 把单元格渲染内容转成纯文本以测量宽度；无法测量（富文本等）返回 null。 */
function renderText(node: ReactNode): string | null {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    let out = "";
    for (const child of node) {
      const s = renderText(child);
      if (s === null) return null;
      out += s;
    }
    return out;
  }
  return null;
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
    autoFitWidths = false,
    columnGap = 2,
    scrollX = false,
    onRowClick,
    onRowDoubleClick,
    onScrollMove,
  } = props;

  const windowStartRef = useRef(0);
  const lastClickRef = useRef<{ key: string; at: number } | null>(null);
  /** 鼠标悬浮的行索引（-1=无） */
  const [hoverIndex, setHoverIndex] = useState(-1);
  /** scrollX 模式的 ScrollBox 实例：Shift+滚轮横向滚动直接驱动它 */
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  // 修复 OpenTUI 0.4.5 ScrollBox 的滑块尺寸 bug：viewportSize setter 的
  // `value === this.viewportSize` 守卫会跳过对 slider 的更新，内容首次布局
  // （此时 slider.max-min 还是 0，viewPortSize 被钳到 0.01）后滑块永远只有
  // 最小宽度。方案：内容每次 resize 时（scrollSize/max 已更新）重刷一次。
  // 必须在提前 return 之前调用，保持 hooks 顺序稳定。
  // 另：内容未横向溢出时横向滚动条本应隐藏，但 ScrollBox 首布局时仍为它预留
  // 1 行（visible 切到 false 后布局未刷新），导致表格底部多一行空白。在内容
  // resize 时调 resetVisibilityControl() 重算可见性并重排，回收该预留行。
  useEffect(() => {
    if (!scrollX) return;
    const sb = scrollRef.current;
    if (!sb) return;
    const hBar = sb.horizontalScrollBar;
    const slider = hBar.slider;
    const apply = () => {
      hBar.resetVisibilityControl();
      slider.viewPortSize = hBar.viewportSize;
    };
    const content = sb.content;
    const orig = content.onSizeChange;
    content.onSizeChange = () => {
      orig?.();
      apply();
    };
    apply();
  }, [scrollX]);

  if (rows.length === 0) {
    windowStartRef.current = 0;
    lastClickRef.current = null;
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        {typeof emptyHint === "string" ? <text fg="#888">{emptyHint}</text> : (emptyHint ?? null)}
      </box>
    );
  }

  // autoFitWidths：按表头 + 全部行内容（显示宽度）取 max，再夹到 [min, max]
  const fitColumns: TableColumn<R>[] = autoFitWidths
    ? columns.map((col) => {
        let max = dispWidthStr(col.label);
        for (const row of rows) {
          const text = renderText(col.render(row));
          if (text !== null) max = Math.max(max, dispWidthStr(text));
        }
        const cap = col.maxColumnWidth ?? AUTO_FIT_MAX_WIDTH;
        const width = Math.min(cap, Math.max(AUTO_FIT_MIN_WIDTH, max + AUTO_FIT_PADDING));
        return { ...col, width };
      })
    : columns;

  // 计算滚动窗口：让光标行始终可见
  const viewHeight = visibleRows > 0 ? visibleRows : Math.max(rows.length, 1);
  const maxWindowStart = Math.max(0, rows.length - viewHeight);
  let windowStart = Math.min(windowStartRef.current, maxWindowStart);
  if (cursor < windowStart) windowStart = cursor;
  else if (cursor >= windowStart + viewHeight) windowStart = cursor - viewHeight + 1;
  windowStart = Math.max(0, Math.min(windowStart, maxWindowStart));
  windowStartRef.current = windowStart;
  const windowEnd = Math.min(windowStart + viewHeight, rows.length);
  const visible = rows.slice(windowStart, windowEnd);

  // 表头
  const headerCells: ReactNode[] = fitColumns.map((col) => (
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
  ));

  const bodyRows: ReactNode[] = visible.map((row, vi) => {
    const globalIndex = windowStart + vi;
    const isCursor = globalIndex === cursor;
    const key = rowKey(row, globalIndex);
    const isChecked = checkedKeys?.has(key) ?? false;
    // 高亮优先级：光标行 > 鼠标悬浮行 > 无
    const rowBg = isCursor ? "#264f78" : hoverIndex === globalIndex ? "#333" : "transparent";

    const cells = fitColumns.map((col, ci) => {
      const content = col.render(row);
      const colorOverride = col.fgOverride?.(row);
      const cellFg = colorOverride ?? (isCursor ? "#fff" : "#ddd");
      const display =
        ci === checkColumnIndex ? (
          <text width={col.width} fg={cellFg} truncate wrapMode="none">
            {isChecked ? "✓ " : "  "}
            {content}
          </text>
        ) : (
          <text width={col.width} fg={cellFg} truncate wrapMode="none">
            {content}
          </text>
        );
      return <box key={`c-${col.key}`}>{display}</box>;
    });

    return (
      <box
        key={`r-${key}`}
        flexDirection="row"
        columnGap={columnGap}
        backgroundColor={rowBg}
        onMouseOver={() => setHoverIndex(globalIndex)}
        onMouseOut={() => setHoverIndex((h) => (h === globalIndex ? -1 : h))}
        onMouseDown={(event) => {
          if (event.button !== MouseButton.LEFT) return;
          event.stopPropagation();

          onRowClick?.(row, globalIndex);

          const now = performance.now();
          const lastClick = lastClickRef.current;
          if (lastClick?.key === key && now - lastClick.at <= DOUBLE_CLICK_INTERVAL_MS) {
            lastClickRef.current = null;
            onRowDoubleClick?.(row, globalIndex);
          } else {
            lastClickRef.current = { key, at: now };
          }
        }}
      >
        {cells}
      </box>
    );
  });

  const handleScroll = (event: MouseEvent) => {
    if (event.type !== "scroll" || !event.scroll) return;
    event.preventDefault();
    event.stopPropagation();
    // 与 ScrollBox 原生约定一致：Shift+滚轮把纵向事件转成横向
    let { direction } = event.scroll;
    if (event.modifiers.shift) {
      direction =
        direction === "up"
          ? "left"
          : direction === "down"
            ? "right"
            : direction === "left"
              ? "down"
              : "up";
    }
    const { delta } = event.scroll;
    if (direction === "left") {
      scrollRef.current?.scrollBy({ x: -(delta || 1) * HSCROLL_STEP, y: 0 });
    } else if (direction === "right") {
      scrollRef.current?.scrollBy({ x: (delta || 1) * HSCROLL_STEP, y: 0 });
    } else if (direction === "up") {
      onScrollMove?.(-(delta || 1) * VSCROLL_STEP);
    } else if (direction === "down") {
      onScrollMove?.((delta || 1) * VSCROLL_STEP);
    }
  };

  const tableInner = (
    <box flexDirection="column" flexGrow={1} onMouseScroll={handleScroll}>
      <box flexDirection="row" columnGap={columnGap}>
        {headerCells}
      </box>
      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" flexGrow={1} columnGap={columnGap}>
          {bodyRows}
        </box>
      </box>
    </box>
  );

  if (scrollX) {
    // 内容超出视口宽度时 ScrollBox 自动显示横向滚动条（滑块可拖动，
    // 轨道可点击）；未超出时滚动条隐藏。纵向滚动由本组件自管理，故关掉。
    // 轨道背景设为 transparent，避免整行灰色实心条显得过粗——只留滑块可见。
    return (
      <scrollbox
        flexGrow={1}
        scrollX={true}
        scrollY={false}
        ref={scrollRef}
        contentOptions={{ flexDirection: "column" }}
        horizontalScrollbarOptions={{
          trackOptions: { backgroundColor: "transparent", foregroundColor: "#666" },
        }}
      >
        {tableInner}
      </scrollbox>
    );
  }

  return tableInner;
}
