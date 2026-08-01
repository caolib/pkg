/**
 * 日期显示格式化工具。
 *
 * npm registry 等来源的日期是 ISO 8601 字符串（如 "2026-02-17T10:06:59.990Z"），
 * 直接展示过长。这里统一提供相对时间（"3 天前"）格式化，解析失败时原样返回。
 * 文案经 i18n 本地化（zh_CN/en_US 的 time.* 键）。
 */

import { currentLanguage, t } from "./i18n"

function parseDate(value: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** 把毫秒差格式化为相对时间文案（i18n）；英文单数形式用 *_ago_1 键。 */
function formatAgo(diff: number): string {
  if (diff < MINUTE) return t("time.just_now")
  const units: [number, number, string][] = [
    [MINUTE, HOUR, "minutes"],
    [HOUR, DAY, "hours"],
    [DAY, WEEK, "days"],
    [WEEK, MONTH, "weeks"],
    [MONTH, YEAR, "months"],
    [YEAR, Infinity, "years"],
  ]
  for (const [unitMs, limitMs, unit] of units) {
    if (diff < limitMs) {
      const n = Math.floor(diff / unitMs)
      return n === 1 && currentLanguage() === "en_US"
        ? t(`time.${unit}_ago_1`)
        : t(`time.${unit}_ago`, { n: String(n) })
    }
  }
  return t("time.years_ago", { n: String(Math.floor(diff / YEAR)) })
}

/** 格式化为相对时间（"刚刚"/"3 天前"）；未来时间（时钟偏差）按"刚刚"处理。 */
export function formatRelativeTime(value: string, now: Date = new Date()): string {
  const d = parseDate(value)
  if (!d) return value
  return formatAgo(Math.max(0, now.getTime() - d.getTime()))
}
