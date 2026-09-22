/**
 * 版本跨度分档：主界面"最新版本"列按更新大小着色（大/中版本再各加一个符号 ▲/●），
 * 一眼看出更新量级；小版本只着色不加符号（满屏 `·` 太吵）。
 *
 * 位次定档（位次与版本段数无关）：
 *  - 第 1 段不同 = 大版本 major（如 1.2.3 → 2.0.0）
 *  - 第 2 段不同 = 中版本 minor（1.2.3 → 1.3.0）
 *  - 第 3 段及以后不同 = 小版本 patch（1.2.3 → 1.2.4；4 段版本 1.2.3.4 的末两段同属小版本）
 *
 * 无法定档时返回 null，由调用方回退现状（"有更新"绿色、不加符号）：
 * 版本相等、数值等价（"1.2" vs "1.2.0"）、latest 反而更低（版本方案变更/回退）、
 * 任一段无法解析、以及仅预发布/构建后缀不同（"1.0.0" vs "1.0.0-beta.1"，同属一个版本号）。
 */

export type UpdateKind = "major" | "minor" | "patch";

/** 档位的展示样式。 */
export interface UpdateKindStyle {
  /** 单元格前景色（在光标行深蓝底 #264f78 上可读） */
  color: string;
  /** 版本号后的标记（宽 1 列，见 src/width.ts 的宽字符表）；
   *  "" 表示不加标记（仅靠颜色区分档位） */
  marker: string;
}

/** 档位样式：大/中版本加符号（▲/●），小版本只有颜色不加符号（满屏 `·` 太吵）。 */
export const UPDATE_KIND_STYLES: Record<UpdateKind, UpdateKindStyle> = {
  major: { color: "#f0883e", marker: "▲" },
  minor: { color: "#f9c74f", marker: "●" },
  patch: { color: "#6b6", marker: "" },
};

/** 按位次定档；无法定档返回 null（见文件头注释的 null 语义）。 */
export function classifyUpdate(current: string, latest: string): UpdateKind | null {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av === bv) continue;
    if (bv < av) return null; // latest 反而更低：版本方案变更/回退，不擅自定档
    return i === 0 ? "major" : i === 1 ? "minor" : "patch";
  }
  return null; // 数值相等（写法不同）或仅预发布/构建后缀不同
}

/** 去 v 前缀与 -pre/+build 后缀，按 "." 切段取前导数字；任一段无数字返回 null。 */
function parseVersion(v: string): number[] | null {
  const core = v.trim().replace(/^[vV]/, "").split(/[-+]/)[0] ?? "";
  const out: number[] = [];
  for (const part of core.split(".")) {
    const m = /^(\d+)/.exec(part);
    if (!m) return null;
    out.push(Number(m[1]));
  }
  return out;
}
