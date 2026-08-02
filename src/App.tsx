/**
 * 主应用 App：持有 ManagerRegistry 运行时状态，渲染顶栏 + 已安装表格 + 底栏，
 * 统一用 useKeyboard 分发按键，管理 overlay（搜索/详情/确认）与 toast。
 *
 * 对应原 Python 项目 pkg_tui/app.py 的主界面与操作编排。
 */

import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { InputRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { isTextInputFocused } from "./focus";
import { getTerminalBackground } from "./terminal-colors";
import { dispWidthChar, dispWidthStr } from "./width";
import { t, setLanguage, currentLanguage } from "./i18n";
import {
  ALL_MANAGERS,
  ManagerRegistry,
  buildInstalledRows,
  doUpdateAll,
  doUninstallAll,
  previewCommands,
  type InstalledRow,
  type ManagerGroups,
} from "./runtime";
import type { PackageManager } from "./managers";
import { PackageTable, type TableColumn } from "./components/PackageTable";
import {
  ManagerStrip,
  buildStripItems,
  type StripItem,
  type StripItemKind,
} from "./components/ManagerStrip";
import { LoadingIndicator } from "./components/LoadingIndicator";
import { ConfirmDialog } from "./screens/ConfirmDialog";
import { SearchScreen } from "./screens/SearchScreen";
import { DetailScreen } from "./screens/DetailScreen";
import { SettingsScreen, type SettingsResult } from "./screens/SettingsScreen";

// ---------------------------------------------------------------------------
// overlay 类型
// ---------------------------------------------------------------------------

type Overlay =
  | { kind: "search" }
  | { kind: "settings" }
  | {
      kind: "detail";
      manager: PackageManager;
      name: string;
      managerName: string | null;
      title: string;
    }
  | {
      kind: "confirm";
      message: string;
      commands?: string[];
      onConfirm: () => void;
      onCancel: () => void;
    };

interface Toast {
  id: number;
  message: string;
  severity: "info" | "warn" | "error";
}

const PROGRESS_TIMEOUT_MS = 60_000;

/** 进度通知的消息：多条命令用 " && " 连接，超宽按显示列截断加省略号。
 *  toast 卡片 maxWidth=80（含内边距），截到 72 列可完整显示省略号。 */
function joinCommands(cmds: string[]): string {
  const joined = cmds.join(" && ");
  if (dispWidthStr(joined) <= 72) return joined;
  const out: string[] = [];
  let col = 0;
  for (const ch of joined) {
    const w = dispWidthChar(ch);
    if (col + w > 71) break;
    out.push(ch);
    col += w;
  }
  return out.join("") + "…";
}

export function App() {
  const renderer = useRenderer();
  const { height } = useTerminalDimensions();

  // 运行时（单例，跨渲染稳定）
  const regRef = useRef<ManagerRegistry | null>(null);
  if (regRef.current === null) regRef.current = new ManagerRegistry();
  const reg = regRef.current;

  // 视图状态
  const [, force] = useState(0); // 强制刷新触发器
  const rerender = () => force((n) => n + 1);

  const [current, setCurrent] = useState<string>(ALL_MANAGERS);
  const [cursor, setCursor] = useState(0);
  const [stripFocus, setStripFocus] = useState(-1); // -1=表格聚焦；>=0=顶栏按钮聚焦索引
  const [filterMode, setFilterMode] = useState(false); // true=过滤框聚焦输入
  const [filterText, setFilterText] = useState("");
  const [filterUpdates, setFilterUpdates] = useState(false);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [loadingHint, setLoadingHint] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // 顶栏过滤输入框实例：退出过滤模式时需显式 blur（鼠标点击聚焦的情况下
  // focused prop 本就是 false，React 不会 diff 出变化，只能手动 blur）
  const filterInputRef = useRef<InputRenderable | null>(null);

  /** 退出过滤输入模式：同步 state 与渲染器真实焦点，交还表格。 */
  function exitFilterMode() {
    setFilterMode(false);
    setStripFocus(-1);
    filterInputRef.current?.blur();
  }

  /** 进入过滤输入模式：聚焦输入框，顶栏焦点落在过滤框上。 */
  function enterFilterMode() {
    setFilterMode(true);
    const idx = stripItems.findIndex((it) => it.kind === "filter");
    if (idx >= 0) setStripFocus(idx);
  }

  /** 从表格首行按 ↑ 回顶栏：聚焦当前管理器的按钮。 */
  function focusStripCurrentManager() {
    let idx = stripItems.findIndex((it) => it.kind === "manager" && it.name === current);
    if (idx < 0) idx = stripItems.findIndex((it) => it.kind === "manager");
    if (idx < 0) idx = 0;
    setStripFocus(idx);
  }

  // 用于 search/detail 拿到全部可用管理器（即时读取，避免 useMemo 缓存陈旧的 available）
  function getAvailableManagers(): PackageManager[] {
    return reg.names
      .map((n) => reg.states.get(n)!)
      .filter((s) => s.available && !s.disabled)
      .map((s) => s.instance);
  }

  // ------------------------------------------------------------------
  // 初始化
  // ------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const lang = await reg.loadPersisted();
      // 语言优先配置，否则 i18n 已自动检测（无需动）
      if (lang) setLanguage(lang);
      // 首次启动若配置文件不存在，用默认值写入磁盘
      await reg.ensureConfig();
      await reg.checkAvailability();
      // 提前触发终端背景色检测并缓存——搜索 overlay 打开时即可同步读到，
      // 避免先用 FALLBACK_BACKGROUND 渲染一帧深色再切到真实背景的闪烁
      getTerminalBackground(renderer);
      rerender();
      await loadCurrentView();
    })();
    return () => {
      if (toastTimer) clearTimeout(toastTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(message: string, severity: Toast["severity"] = "info", timeout = 4000) {
    if (toastTimer) clearTimeout(toastTimer);
    const id = Math.floor(performance.now() * 1000);
    setToast({ id, message, severity });
    const tm = setTimeout(() => {
      setToast(null);
      setToastTimer(null);
    }, timeout);
    setToastTimer(tm);
  }

  // ------------------------------------------------------------------
  // 数据加载
  // ------------------------------------------------------------------
  async function loadCurrentView() {
    rerender();
    const managers = reg.activeManagers(current);
    // 先清未加载管理器的 installed
    for (const st of managers) {
      if (!st.loadedInstalled) st.installed = [];
    }
    rerender();
    setLoadingHint(true);
    // 逐个加载 installed，完成即刷新
    for (const st of managers) {
      if (st.loadedInstalled) continue;
      try {
        st.installed = await st.instance.listInstalled();
        st.loadedInstalled = true;
      } catch {
        st.installed = [];
        st.loadedInstalled = true;
      }
      setCursor(0);
      rerender();
    }
    // 逐个检查 outdated，完成即刷新
    for (const st of managers) {
      if (st.loadedOutdated) continue;
      try {
        st.outdated = await st.instance.listOutdated();
        st.outdatedMap = new Map(st.outdated.map((p) => [p.name, p]));
        st.loadedOutdated = true;
      } catch {
        st.outdated = [];
        st.outdatedMap = new Map();
        st.loadedOutdated = true;
      }
      rerender();
    }
    setLoadingHint(false);
  }

  function reloadAll() {
    reg.invalidateAll();
    loadCurrentView();
  }

  /** 只失效并重载指定管理器的缓存（如安装/更新/卸载只影响目标管理器）。 */
  function reloadManagers(names: Iterable<string>) {
    for (const n of names) reg.invalidate(n);
    loadCurrentView();
  }

  // ------------------------------------------------------------------
  // 表格行 + 列
  // ------------------------------------------------------------------
  const isAll = current === ALL_MANAGERS;
  // 每次渲染即时计算：reg 内部 installed/outdated 随加载而变，不能用 useMemo 缓存
  const rows: InstalledRow[] = buildInstalledRows(reg, {
    current,
    filterUpdates,
    filterText: filterText.trim().toLowerCase(),
    checkedKeys,
    isAll,
  });

  // 行数变化时光标不越界
  useEffect(() => {
    if (cursor > rows.length - 1) setCursor(Math.max(0, rows.length - 1));
  }, [rows.length, cursor]);

  const columns: TableColumn<InstalledRow>[] = isAll
    ? [
        {
          key: "name",
          label: t("col.name"),
          width: 36,
          render: (r) => r.pkg.display_name || r.pkg.name,
        },
        { key: "version", label: t("col.version"), width: 16, render: (r) => r.pkg.version || "-" },
        {
          key: "latest",
          label: t("col.latest"),
          width: 16,
          render: (r) => r.latestVersion || "-",
          fgOverride: (r) => (r.hasUpdate ? "#6b6" : undefined),
        },
        { key: "manager", label: t("col.manager"), width: 12, render: (r) => r.managerName },
      ]
    : [
        {
          key: "name",
          label: t("col.name"),
          width: 40,
          render: (r) => r.pkg.display_name || r.pkg.name,
        },
        { key: "version", label: t("col.version"), width: 18, render: (r) => r.pkg.version || "-" },
        {
          key: "latest",
          label: t("col.latest"),
          width: 18,
          render: (r) => r.latestVersion || "-",
          fgOverride: (r) => (r.hasUpdate ? "#6b6" : undefined),
        },
      ];

  const stripItems: StripItem[] = buildStripItems(reg, current);

  const tableVisibleRows = Math.max(4, height - 4); // 顶栏1 + 底栏1 + 表头1 + 边距

  // ------------------------------------------------------------------
  // 管理器切换
  // ------------------------------------------------------------------
  function switchManager(name: string) {
    if (name === current) return;
    if (name !== ALL_MANAGERS) {
      const st = reg.states.get(name);
      if (!st || !st.available || st.disabled) return;
    }
    setCurrent(name);
    setFilterText("");
    setCursor(0);
    exitFilterMode(); // 切换管理器后回到表格模式
    loadCurrentView();
  }

  // ------------------------------------------------------------------
  // 行选中 → 详情
  // ------------------------------------------------------------------
  function viewRow(row: InstalledRow | undefined) {
    if (!row) return;
    const found = reg.findSelected(current, row.key);
    if (!found) {
      showToast(t("notify.no_package_manager"), "warn");
      return;
    }
    setOverlay({
      kind: "detail",
      manager: found.manager,
      name: found.pkg.name,
      managerName: found.state.name,
      title: found.pkg.display_name || found.pkg.name,
    });
  }

  function viewSelected() {
    viewRow(rows[cursor]);
  }

  // ------------------------------------------------------------------
  // 勾选
  // ------------------------------------------------------------------
  function toggleSelect() {
    const row = rows[cursor];
    if (!row) return;
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  }

  // ------------------------------------------------------------------
  // 更新 / 卸载：构造 groups 与确认框
  // ------------------------------------------------------------------
  function groupsFromCheckedOrCurrent(useChecked: boolean): ManagerGroups | null {
    if (useChecked && checkedKeys.size > 0) {
      const groups: ManagerGroups = {};
      for (const key of checkedKeys) {
        const found = reg.findSelected(current, key);
        if (!found) continue;
        (groups[found.state.name] ??= []).push(found.pkg.name);
      }
      return Object.keys(groups).length > 0 ? groups : null;
    }
    const row = rows[cursor];
    if (!row) return null;
    const found = reg.findSelected(current, row.key);
    if (!found) return null;
    return { [found.state.name]: [found.pkg.name] };
  }

  function confirmUpdate() {
    const groups = groupsFromCheckedOrCurrent(true);
    if (!groups) {
      showToast(t("notify.no_selection"), "warn");
      return;
    }
    const total = Object.values(groups).reduce((a, v) => a + v.length, 0);
    const cmds = previewCommands(reg, groups, "update");
    setOverlay({
      kind: "confirm",
      message: t("confirm.update", { count: String(total) }),
      commands: cmds,
      onConfirm: () => {
        setOverlay(null);
        runUpdate(groups);
      },
      onCancel: () => setOverlay(null),
    });
  }

  function confirmUninstall() {
    const groups = groupsFromCheckedOrCurrent(true);
    if (!groups) {
      showToast(t("notify.no_selection"), "warn");
      return;
    }
    const total = Object.values(groups).reduce((a, v) => a + v.length, 0);
    const cmds = previewCommands(reg, groups, "uninstall");
    setOverlay({
      kind: "confirm",
      message: t("confirm.uninstall_multi", { count: String(total) }),
      commands: cmds,
      onConfirm: () => {
        setOverlay(null);
        runUninstall(groups);
      },
      onCancel: () => setOverlay(null),
    });
  }

  async function runUpdate(groups: ManagerGroups) {
    showToast(joinCommands(previewCommands(reg, groups, "update")), "info", PROGRESS_TIMEOUT_MS);
    const summary = await doUpdateAll(reg, groups);
    setToast(null);
    if (toastTimer) clearTimeout(toastTimer);
    if (summary.fail === 0) {
      showToast(t("notify.updated_ok", { count: String(summary.ok) }), "info");
    } else {
      showToast(
        t("notify.updated_partial", { ok: String(summary.ok), fail: String(summary.fail) }),
        "warn",
        8000,
      );
    }
    setCheckedKeys(new Set());
    reloadManagers(Object.keys(groups));
  }

  async function runUninstall(groups: ManagerGroups) {
    showToast(joinCommands(previewCommands(reg, groups, "uninstall")), "info", PROGRESS_TIMEOUT_MS);
    const summary = await doUninstallAll(reg, groups);
    setToast(null);
    if (toastTimer) clearTimeout(toastTimer);
    if (summary.fail === 0) {
      showToast(t("notify.uninstalled_ok", { count: String(summary.ok) }), "info");
    } else {
      showToast(
        t("notify.uninstalled_partial", { ok: String(summary.ok), fail: String(summary.fail) }),
        "warn",
        8000,
      );
    }
    setCheckedKeys(new Set());
    reloadManagers(Object.keys(groups));
  }

  // 安装（由搜索界面触发）
  function doInstall(mgrName: string, name: string) {
    const st = reg.states.get(mgrName);
    if (!st) {
      showToast(t("notify.unknown_manager", { name: mgrName }), "error");
      return;
    }
    (async () => {
      showToast(st.instance.installCommand(name), "info", PROGRESS_TIMEOUT_MS);
      try {
        const res = await st.instance.install(name);
        setToast(null);
        if (toastTimer) clearTimeout(toastTimer);
        if (res.success) showToast(t("notify.installed", { name }), "info");
        else showToast(t("notify.install_failed", { message: res.message ?? "" }), "error", 8000);
      } catch (exc) {
        showToast(t("notify.install_error", { exc: String(exc) }), "error", 8000);
      }
      reloadManagers([mgrName]);
    })();
  }

  // 详情屏的更新/删除：关闭详情后走确认
  function detailUpdate(managerName: string, name: string) {
    setOverlay(null);
    setOverlay({
      kind: "confirm",
      message: t("confirm.update", { count: "1" }),
      commands: previewCommands(reg, { [managerName]: [name] }, "update"),
      onConfirm: () => {
        setOverlay(null);
        runUpdate({ [managerName]: [name] });
      },
      onCancel: () => setOverlay(null),
    });
  }

  function detailUninstall(managerName: string, name: string) {
    setOverlay(null);
    setOverlay({
      kind: "confirm",
      message: t("confirm.uninstall_multi", { count: "1" }),
      commands: previewCommands(reg, { [managerName]: [name] }, "uninstall"),
      onConfirm: () => {
        setOverlay(null);
        runUninstall({ [managerName]: [name] });
      },
      onCancel: () => setOverlay(null),
    });
  }

  // ------------------------------------------------------------------
  // 键盘分发（主界面）
  // ------------------------------------------------------------------
  useKeyboard((key) => {
    // 有 overlay 时主界面不处理（overlay 自带 useKeyboard）
    if (overlay !== null) return;

    const kb = reg.keybindings;

    // --- 顶栏聚焦模式：← → 循环导航（设置/搜索/过滤框/管理器按钮），↓/Esc 进表格 ---
    // 过滤框项被顶栏聚焦时会连带聚焦 input（显示光标，见 ManagerStrip），因此
    // 本分支必须先于下方的 input 焦点判断执行；OpenTUI 的全局 keyHandler
    // 先于聚焦 renderable 处理按键，这里 preventDefault 后 input 不会吞掉导航键。
    if (stripFocus >= 0) {
      const onFilter = stripItems[stripFocus]?.kind === "filter";
      if (key.name === "left") {
        setStripFocus((stripFocus - 1 + stripItems.length) % stripItems.length);
        key.preventDefault();
      } else if (key.name === "right") {
        setStripFocus((stripFocus + 1) % stripItems.length);
        key.preventDefault();
      } else if (key.name === "down" || key.name === "escape") {
        exitFilterMode(); // 交还表格（顺带 blur 过滤框）
        key.preventDefault();
      } else if (onFilter) {
        // 焦点在过滤框：与过滤输入模式一致——Enter 退出，其余键交给 input 输入
        if (key.name === "return") {
          exitFilterMode();
          key.preventDefault();
        }
        return;
      } else if (key.name === "return" || key.name === " ") {
        activateStrip(stripFocus);
        key.preventDefault();
      }
      return;
    }

    // --- 过滤输入模式（stripFocus < 0 时的兜底判据）：input 聚焦吃字符键，这里只处理退出 ---
    // 判据是渲染器的真实焦点，不能只看 filterMode：鼠标点击输入框会直接
    // 改变焦点而不经过 setFilterMode，只信 state 会让 d/u/f 等字符键在打字
    // 时被当成快捷键执行（见 src/focus.ts）。
    if (filterMode || isTextInputFocused(renderer)) {
      if (key.name === "escape" || key.name === "return") {
        exitFilterMode();
        key.preventDefault();
      }
      return; // 其余键交给 input 自身
    }

    // --- 表格模式：全局 useKeyboard 全权处理（input 未聚焦不吞键）---

    // 优先级最高的动作键
    if (matchBinding(key, kb.open_settings)) {
      openSettings();
      key.preventDefault();
      return;
    }
    if (matchBinding(key, kb.open_search)) {
      openSearch();
      key.preventDefault();
      return;
    }
    if (matchBinding(key, kb.refresh_all)) {
      reloadAll();
      key.preventDefault();
      return;
    }
    if (matchBinding(key, kb.toggle_filter_updates)) {
      setFilterUpdates((v) => !v);
      setCursor(0);
      key.preventDefault();
      return;
    }

    // 进入过滤输入模式
    if (key.name === "/" || key.name === "slash") {
      enterFilterMode();
      key.preventDefault();
      return;
    }

    // ← → 切换当前管理器视图（表格内快捷方式；顶栏聚焦时是按钮导航）
    if (key.name === "left") {
      switchManagerRelative(-1);
      key.preventDefault();
      return;
    }
    if (key.name === "right") {
      switchManagerRelative(1);
      key.preventDefault();
      return;
    }

    // ↑ ↓ 表格光标；↑ 在第一行时回顶栏
    if (key.name === "up") {
      if (cursor > 0) setCursor(cursor - 1);
      else focusStripCurrentManager();
      key.preventDefault();
      return;
    }
    if (key.name === "down") {
      if (cursor < rows.length - 1) setCursor(cursor + 1);
      key.preventDefault();
      return;
    }

    if (matchBinding(key, kb.toggle_select)) {
      toggleSelect();
      key.preventDefault();
      return;
    }
    if (matchBinding(key, kb.update_selected)) {
      confirmUpdate();
      key.preventDefault();
      return;
    }
    if (matchBinding(key, kb.uninstall_selected)) {
      confirmUninstall();
      key.preventDefault();
      return;
    }
    if (key.name === "return") {
      viewSelected();
      key.preventDefault();
      return;
    }
  });

  /** 在"全部"+各可用管理器间按方向循环切换（delta=±1）。 */
  function switchManagerRelative(delta: number) {
    // 可选视图序列：[ALL_MANAGERS, ...可用且未禁用的管理器名]
    const seq = [
      ALL_MANAGERS,
      ...reg.names.filter((n) => {
        const st = reg.states.get(n)!;
        return st.available && !st.disabled;
      }),
    ];
    let idx = seq.indexOf(current);
    if (idx < 0) idx = 0;
    idx = (idx + delta + seq.length) % seq.length;
    const next = seq[idx];
    if (next && next !== current) switchManager(next);
  }

  function openSearch() {
    if (getAvailableManagers().length === 0) {
      showToast(t("notify.no_managers"), "warn");
      return;
    }
    exitFilterMode(); // 交出焦点，避免 overlay 打开后底层过滤框仍在吃按键
    setOverlay({ kind: "search" });
  }

  function openSettings() {
    exitFilterMode();
    setOverlay({ kind: "settings" });
  }

  function onSettingsClosed(result: SettingsResult | null) {
    setOverlay(null);
    if (result === null) return;

    // --- 语言 ---
    const langChanged = result.language && result.language !== currentLanguage();
    if (langChanged) setLanguage(result.language);

    // --- 当前选中管理器若被禁用，回退到"全部" ---
    if (current !== ALL_MANAGERS) {
      const st = reg.states.get(current);
      if (st && st.disabled) switchManager(ALL_MANAGERS);
    }

    // --- 持久化 ---
    reg.config = {
      disabled_managers: [...reg.disabledManagers].sort(),
      keybindings: reg.keybindings,
      search_keybindings: reg.searchKeybindings,
      language: currentLanguage(),
      manager_icons: reg.managerIcons,
    };
    reg.persist();

    if (langChanged) {
      showToast(t("notify.restart_for_footer"), "info", 8000);
    }
    // 刷新顶栏按钮（可用性/禁用态可能变了）并重载数据
    rerender();
    reloadAll();
  }

  function activateStrip(index: number) {
    const it = stripItems[index];
    if (!it) return;
    handleStripButton(it.kind, it.name);
  }

  function handleStripButton(kind: StripItemKind, name: string | null) {
    if (kind === "settings") {
      openSettings();
      return;
    }
    if (kind === "search") {
      openSearch();
      return;
    }
    if (kind === "filter") {
      enterFilterMode();
      return;
    }
    if (kind === "manager" && name) {
      switchManager(name);
    }
  }

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------
  // 悬浮通知卡片配色：fg=正文色，bar=左侧级别色条（实心铺满、取较亮的纯色）
  const toastTheme = {
    info: { fg: "#9f9", bar: "#4caf50" },
    warn: { fg: "#fd6", bar: "#d9a02c" },
    error: { fg: "#f88", bar: "#e05555" },
  } as const;
  const ts = toastTheme[toast?.severity ?? "info"];

  return (
    <box flexDirection="column" height="100%" width="100%">
      {/* 顶栏 */}
      <ManagerStrip
        items={stripItems}
        stripFocus={stripFocus}
        filterMode={filterMode}
        filterText={filterText}
        inputRef={filterInputRef}
        onFilterFocus={enterFilterMode}
        onFilter={(v) => {
          setFilterText(v);
          setCursor(0);
        }}
        onButton={handleStripButton}
      />
      {/* 表格：数据有多少显示多少，加载态不阻塞表格 */}
      <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={1} paddingRight={1}>
        <PackageTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          cursor={cursor}
          checkedKeys={checkedKeys}
          checkColumnIndex={0}
          visibleRows={tableVisibleRows}
          emptyHint={t("search.status_no_results")}
          onRowClick={(_, index) => {
            exitFilterMode();
            setCursor(index);
          }}
          onRowDoubleClick={(row) => viewRow(row)}
          onScrollMove={(delta) => {
            const max = Math.max(0, rows.length - 1);
            setCursor((c) => Math.min(max, Math.max(0, c + delta)));
          }}
        />
      </box>
      {/* 底栏：快捷键提示 */}
      <box flexDirection="row" height={1} backgroundColor="#111" paddingLeft={1}>
        <text fg="#666">{renderBindingHints(reg.keybindings, filterMode)}</text>
      </box>

      {/* 加载指示器：右下角悬浮（不挡表格），installed+outdated 全部就绪后消失 */}
      {loadingHint ? (
        <box position="absolute" bottom={1} right={1}>
          <LoadingIndicator />
        </box>
      ) : null}

      {/* toast：右下角悬浮通知卡片（参照 opencode 的悬浮 Box 实现） */}
      {toast ? (
        <box
          position="absolute"
          bottom={2}
          right={1}
          minWidth={40}
          maxWidth={80}
          flexDirection="row"
        >
          {/* 左侧级别色条：实心背景铺满整卡高度，紧贴左缘（不用 border 字形，
              字形笔画在单元格内居中会露出左侧底色缝隙） */}
          <box width={1} backgroundColor={ts.bar} />
          <box
            flexDirection="row"
            alignItems="center"
            flexGrow={1}
            backgroundColor="#1d1d26"
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
          >
            <text fg={ts.fg}>{toast.message}</text>
          </box>
        </box>
      ) : null}

      {/* overlay */}
      {overlay?.kind === "confirm" ? (
        <ConfirmDialog
          message={overlay.message}
          commands={overlay.commands}
          onConfirm={overlay.onConfirm}
          onCancel={overlay.onCancel}
        />
      ) : null}
      {overlay?.kind === "search" ? (
        <SearchScreen
          managers={getAvailableManagers()}
          managerIcon={(name) => reg.managerIcon(name)}
          onClose={() => setOverlay(null)}
          onView={(mgr, name, title) =>
            setOverlay({
              kind: "detail",
              manager: mgr,
              name,
              managerName: null,
              title: title || name,
            })
          }
          onInstall={(mgrName, name) => {
            setOverlay(null);
            doInstall(mgrName, name);
          }}
        />
      ) : null}
      {overlay?.kind === "detail" ? (
        <DetailScreen
          manager={overlay.manager}
          name={overlay.name}
          managerName={overlay.managerName}
          title={overlay.title}
          onClose={() => setOverlay(null)}
          onUpdate={(mn, n) => detailUpdate(mn, n)}
          onUninstall={(mn, n) => detailUninstall(mn, n)}
          onToast={(m, sev) => showToast(m, sev)}
        />
      ) : null}
      {overlay?.kind === "settings" ? (
        <SettingsScreen
          reg={reg}
          onClose={onSettingsClosed}
          onToast={(m, sev) => showToast(m, sev)}
        />
      ) : null}
    </box>
  );
}

// ---------------------------------------------------------------------------
// 按键匹配工具
// ---------------------------------------------------------------------------

/** 把 OpenTUI KeyEvent 与 "ctrl+comma"/"s"/"space" 这样的绑定串匹配。 */
function matchBinding(
  key: { name: string; sequence?: string; ctrl?: boolean; shift?: boolean; meta?: boolean },
  binding: string,
): boolean {
  if (!binding) return false;
  const parts = binding.toLowerCase().split("+");
  const last = parts[parts.length - 1];
  const wantCtrl = parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  if (wantCtrl !== !!key.ctrl) return false;
  if (wantShift !== !!key.shift) return false;
  if (wantAlt !== !!key.meta) return false;
  // 名称归一：
  //  - comma：非修饰时 name=","；Ctrl+, 在终端编码为控制字符 \x1c（OpenTUI 解析为
  //    name="\\"、sequence="\x1c"），故用 sequence 判定 Ctrl+comma。
  //  - space：name="space"
  if (last === "comma") {
    if (wantCtrl) return key.sequence === "\x1c";
    return key.name === ",";
  }
  if (last === "space") return key.name === "space";
  return key.name === last;
}

/** 底栏快捷键提示文本。filterMode=true 时显示过滤模式提示。 */
function renderBindingHints(kb: Record<string, string>, filterMode: boolean): string {
  if (filterMode) {
    return `${t("filter.placeholder")}  |  Esc/${t("binding.back")}  Enter 确认`;
  }
  const seg = (label: string, keys: string) => `${keys} ${label}`;
  return [
    seg(t("binding.settings"), kb.open_settings ?? "alt+s"),
    seg(t("binding.search"), kb.open_search ?? "s"),
    seg(t("binding.refresh"), kb.refresh_all ?? "r"),
    seg(t("binding.update"), kb.update_selected ?? "u"),
    seg(t("binding.uninstall"), kb.uninstall_selected ?? "d"),
    seg(t("binding.toggle"), kb.toggle_select ?? "space"),
    seg(t("binding.filter"), kb.toggle_filter_updates ?? "f"),
    "← → 切换管理器",
    "/ 过滤",
  ].join("   ");
}
