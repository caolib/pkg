/**
 * formatRelativeTime 相对时间工具回归测试。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { setLanguage } from "../src/i18n";
import { formatRelativeTime } from "../src/date";

test("formatRelativeTime 相对时间", () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  const NOW = new Date("2026-02-17T10:00:00Z");

  try {
    setLanguage("zh_CN");
    check(formatRelativeTime("2026-02-17T10:00:00Z", NOW) === "刚刚", "zh: 0 秒前 → 刚刚");
    check(formatRelativeTime("2026-02-17T09:59:30Z", NOW) === "刚刚", "zh: 30 秒前 → 刚刚");
    check(formatRelativeTime("2026-02-17T09:58:00Z", NOW) === "2 分钟前", "zh: 2 分钟前");
    check(formatRelativeTime("2026-02-17T08:00:00Z", NOW) === "2 小时前", "zh: 2 小时前");
    check(formatRelativeTime("2026-02-15T10:00:00Z", NOW) === "2 天前", "zh: 2 天前");
    check(formatRelativeTime("2026-02-10T10:00:00Z", NOW) === "1 周前", "zh: 1 周前");
    check(formatRelativeTime("2026-01-15T10:00:00Z", NOW) === "1 个月前", "zh: 1 个月前");
    check(formatRelativeTime("2025-12-15T10:00:00Z", NOW) === "2 个月前", "zh: 2 个月前");
    check(formatRelativeTime("2025-01-15T10:00:00Z", NOW) === "1 年前", "zh: 1 年前");
    check(formatRelativeTime("2024-01-15T10:00:00Z", NOW) === "2 年前", "zh: 2 年前");

    setLanguage("en_US");
    check(formatRelativeTime("2026-02-17T10:00:00Z", NOW) === "just now", "en: 0 秒前 → just now");
    check(formatRelativeTime("2026-02-17T09:58:00Z", NOW) === "2 minutes ago", "en: 2 minutes ago");
    check(formatRelativeTime("2026-02-17T09:00:00Z", NOW) === "1 hour ago", "en: 单数 1 hour ago");
    check(formatRelativeTime("2026-02-17T08:00:00Z", NOW) === "2 hours ago", "en: 2 hours ago");
    check(formatRelativeTime("2026-02-15T10:00:00Z", NOW) === "2 days ago", "en: 2 days ago");
    check(formatRelativeTime("2026-02-10T10:00:00Z", NOW) === "1 week ago", "en: 1 week ago");
    check(formatRelativeTime("2026-01-15T10:00:00Z", NOW) === "1 month ago", "en: 1 month ago");
    check(formatRelativeTime("2025-01-15T10:00:00Z", NOW) === "1 year ago", "en: 1 year ago");

    // 解析失败原样返回；未来时间（时钟偏差）按"刚刚"
    check(formatRelativeTime("not-a-date", NOW) === "not-a-date", "解析失败原样返回");
    check(formatRelativeTime("", NOW) === "", "空串原样返回");
    setLanguage("zh_CN");
    check(formatRelativeTime("2026-02-17T11:00:00Z", NOW) === "刚刚", "zh 未来时间 → 刚刚");
  } finally {
    // 还原检测到的语言，避免污染其它测试
    setLanguage("zh_CN");
  }
});
