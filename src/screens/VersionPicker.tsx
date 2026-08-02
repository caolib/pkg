/**
 * 版本选择器。
 *
 * 在详情界面内嵌弹出,列出包的所有历史版本(分页,一页 20 个),
 * 支持键盘/鼠标选择、翻页、输入过滤。选中后回传版本号。
 */

import { useKeyboard, useRenderer } from "@opentui/react";
import { useState } from "react";
import { t } from "../i18n";
import { isTextInputFocused } from "../focus";

export interface VersionPickerProps {
  versions: string[];
  /** 当前最新版本(用于高亮标注) */
  currentVersion: string;
  onSelect: (version: string) => void;
  onCancel: () => void;
}

const PAGE_SIZE = 20;

export function VersionPicker(props: VersionPickerProps) {
  const { versions, currentVersion, onSelect, onCancel } = props;
  const renderer = useRenderer();
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");

  const filtered = filter
    ? versions.filter((v) => v.toLowerCase().includes(filter.toLowerCase()))
    : versions;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel();
      key.preventDefault();
      return;
    }
    // 输入框聚焦时字符键归输入框,只处理导航/翻页/确认
    const inputFocused = isTextInputFocused(renderer);
    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1));
      key.preventDefault();
      return;
    }
    if (key.name === "down") {
      setCursor((c) => Math.min(pageItems.length - 1, c + 1));
      key.preventDefault();
      return;
    }
    if (key.name === "left") {
      setPage((p) => Math.max(0, p - 1));
      setCursor(0);
      key.preventDefault();
      return;
    }
    if (key.name === "right") {
      setPage((p) => Math.min(pageCount - 1, p + 1));
      setCursor(0);
      key.preventDefault();
      return;
    }
    if (key.name === "return") {
      const v = pageItems[cursor];
      if (v) onSelect(v);
      key.preventDefault();
      return;
    }
    if (inputFocused) {
      // 字符键交给输入框
      return;
    }
    // 未聚焦输入框时,可打印字符直接进过滤
    if (key.name.length === 1) {
      setFilter((f) => f + key.name);
      setPage(0);
      setCursor(0);
      key.preventDefault();
    }
  });

  return (
    <box
      position="absolute"
      top={2}
      left={4}
      width={40}
      flexDirection="column"
      backgroundColor="#222"
      padding={1}
    >
      <text fg="#fff">{t("version.title")}</text>
      <box marginTop={1}>
        <input
          value={filter}
          placeholder={t("version.filter_placeholder")}
          onInput={(v) => {
            setFilter(v);
            setPage(0);
            setCursor(0);
          }}
          focused
        />
      </box>
      <box flexDirection="column" marginTop={1} height={PAGE_SIZE}>
        {pageItems.map((v, i) => {
          const isCursor = i === cursor;
          const isCurrent = v === currentVersion;
          return (
            <box key={v} flexDirection="row" backgroundColor={isCursor ? "#264f78" : "transparent"}>
              <text fg={isCurrent ? "#6b6" : "#ddd"}>{v}</text>
              {isCurrent ? <text fg="#888"> {t("version.current")}</text> : null}
            </box>
          );
        })}
        {pageItems.length === 0 ? <text fg="#888">{t("version.no_match")}</text> : null}
      </box>
      <box flexDirection="row" marginTop={1} justifyContent="space-between">
        <text fg="#888">
          {t("version.page", { page: String(safePage + 1), total: String(pageCount) })}
        </text>
        <text fg="#666">{t("version.hint")}</text>
      </box>
    </box>
  );
}
