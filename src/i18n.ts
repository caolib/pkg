/**
 * 国际化支持。
 *
 * 提供 t() 函数用于获取当前语言的翻译文本，支持简体中文和 English。
 * 语言自动检测系统 locale，可通过 setLanguage() 在运行时切换。
 * 对应原 Python 项目的 i18n.py。
 */

import zhCN from "./locales/zh_CN.json"
import enUS from "./locales/en_US.json"

type Strings = Record<string, string>

const _TABLES: Record<string, Strings> = {
  zh_CN: zhCN as Strings,
  en_US: enUS as Strings,
}

/** 当前语言代码。 */
let _language = detectLanguage()

function detectLanguage(): string {
  // Bun 无内置 POSIX locale；用 LANG / LC_ALL 环境变量粗略推断，默认中文
  try {
    const lang =
      process.env.LC_ALL ||
      process.env.LC_MESSAGES ||
      process.env.LANG ||
      ""
    const norm = lang.replace("-", "_")
    if (norm.startsWith("zh")) return "zh_CN"
    if (norm.startsWith("en")) return "en_US"
  } catch {
    // ignore
  }
  return "zh_CN"
}

/** 获取当前语言的翻译文本。
 *  Args: key 翻译键（如 "button.settings"）；params 替换文本中的 {name} 占位符。 */
export function t(key: string, params?: Record<string, string>): string {
  const table = _TABLES[_language] ?? _TABLES.zh_CN
  if (!table) return key
  let value = table[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replaceAll(`{${k}}`, v)
    }
  }
  return value
}

/** 运行时切换语言。 */
export function setLanguage(language: string): void {
  if (_TABLES[language]) {
    _language = language
  }
}

/** 返回当前语言代码。 */
export function currentLanguage(): string {
  return _language
}

/** 可选语言列表。 */
export function availableLanguages(): string[] {
  return Object.keys(_TABLES)
}
