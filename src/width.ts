/**
 * 终端显示宽度工具：CJK/全角/emoji 等宽字符按 2 列计，其余按 1 列。
 *
 * 用于表格自动列宽测量、CLI 表格按显示列切列（winget 中文表头）等场景。
 * 注意是"显示宽度"而非字符个数，含 emoji 的字符串用 charAt/for..of 切片
 * 会错位，务必以本模块的 dispWidthStr 为准。
 */

/** 单字符是否占 2 列（宽字符）。 */
export function isWideChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) || // 韩文 Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK 部首/标点
    (code >= 0x3040 && code <= 0x33bf) || // 日文假名/全角符号
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x4e00 && code <= 0xa4cf) || // CJK 统一表意等
    (code >= 0xa960 && code <= 0xa97f) || // 谚文扩展
    (code >= 0xac00 && code <= 0xd7a3) || // 谚文音节
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK 兼容标点
    (code >= 0xff00 && code <= 0xff60) || // 全角 ASCII/片假名
    (code >= 0xffe0 && code <= 0xffe6) || // 全角符号
    (code >= 0x1f000 && code <= 0x1faff) || // 麻将/emoji 扩展
    (code >= 0x20000 && code <= 0x3fffd) // CJK 扩展 B 及之后
  );
}

/** 单字符显示宽度。 */
export function dispWidthChar(ch: string): number {
  return isWideChar(ch) ? 2 : 1;
}

/** 字符串的终端显示宽度。 */
export function dispWidthStr(s: string): number {
  let sum = 0;
  for (const ch of s) sum += dispWidthChar(ch);
  return sum;
}

/** 按显示列区间 [startCol, endCol) 从字符串切片（不截断宽字符）。 */
export function sliceByDisp(line: string, startCol: number, endCol: number): string {
  const out: string[] = [];
  let col = 0;
  for (const ch of line) {
    const w = dispWidthChar(ch);
    if (col + w > startCol && col < endCol) out.push(ch);
    col += w;
    if (col >= endCol) break;
  }
  return out.join("");
}
