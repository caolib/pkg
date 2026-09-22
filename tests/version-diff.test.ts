/**
 * 版本跨度分档（version-diff.ts）回归测试。
 *
 * 主界面"最新版本"列按 updateKind 着色 + 加符号（大 ▲ 橙 / 中 ● 黄 / 小 · 绿），
 * 这里守住定档规则与"无法定档 → null"的边界（调用方据此回退现状：绿、无符号），
 * 以及样式表不变量（三档齐全、颜色/符号互不相同、符号单列宽）。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { classifyUpdate, UPDATE_KIND_STYLES, type UpdateKind } from "../src/version-diff";
import { dispWidthStr } from "../src/width";

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
}

/** 断言 current→latest 的档位。 */
function expectKind(current: string, latest: string, want: UpdateKind | null) {
  const got = classifyUpdate(current, latest);
  check(got === want, `${current} → ${latest}：${want ?? "null"}（实际 ${got ?? "null"}）`);
}

test("三段版本：三档判定", () => {
  expectKind("1.0.0", "2.0.0", "major");
  expectKind("1.0.0", "1.1.0", "minor");
  expectKind("1.0.0", "1.0.1", "patch");
  expectKind("19.0.0", "19.1.3", "minor");
  expectKind("0.1.5", "0.1.7", "patch");
});

test("四段版本：第 1/2 段成档，第 3/4 段都算小版本", () => {
  expectKind("2.55.0.3", "3.0.0.0", "major");
  expectKind("2.55.0.3", "2.56.0.0", "minor");
  expectKind("2.55.0.3", "2.55.1.0", "patch"); // 第 3 段
  expectKind("2.55.0.3", "2.55.0.4", "patch"); // 第 4 段
});

test("两段版本与补 0 等价", () => {
  expectKind("1.0", "2.0", "major");
  expectKind("1.0", "1.1", "minor");
  expectKind("1.2", "1.2.1", "patch");
  // 数值等价：写法不同不算更新档位
  expectKind("1.2", "1.2.0", null);
  expectKind("1.0.0", "1.0.0.0", null);
});

test("v 前缀、空白、前导零", () => {
  expectKind("v1.0.0", "1.1.0", "minor");
  expectKind("V1.0.0", "2.0.0", "major");
  expectKind(" 1.0.0 ", "1.0.2", "patch");
  expectKind("01.02", "1.3", "minor");
});

test("无法定档 → null（回退现状：绿、无符号）", () => {
  expectKind("1.0.0", "1.0.0", null);
  // 预发布：同属一个版本号（"1.0.0" vs "1.0.0-beta.1"）不定档
  expectKind("1.0.0", "1.0.0-beta.1", null);
  expectKind("1.0.0-beta.1", "1.0.0", null);
  // 主段有差异时预发布后缀不影响定档
  expectKind("1.0.0", "1.1.0-beta.1", "minor");
  expectKind("1.0.0", "2.0.0-rc.1", "major");
  // 降级 / 版本方案变更
  expectKind("2.0.0", "1.9.9", null);
  expectKind("1.2.0", "1.1.9", null);
  // 不可解析
  expectKind("", "1.0.0", null);
  expectKind("1.0.0", "", null);
  expectKind("abc", "abc.1", null);
  expectKind("1.x", "1.2", null);
  expectKind("unknown", "2024.1.1", null);
});

test("日期型版本按位次自然落档（不特判）", () => {
  expectKind("2024.01.01", "2025.01.01", "major");
  expectKind("2024.01.01", "2024.02.01", "minor");
  expectKind("2024.01.01", "2024.01.02", "patch");
});

test("样式表不变量：三档齐全、颜色与符号互不相同、符号单列宽", () => {
  const kinds: UpdateKind[] = ["major", "minor", "patch"];
  const colors = new Set<string>();
  const markers = new Set<string>();
  for (const k of kinds) {
    const style = UPDATE_KIND_STYLES[k];
    check(style !== undefined, `${k} 有样式`);
    check(typeof style.color === "string" && style.color.length > 0, `${k} 有颜色 ${style.color}`);
    check(dispWidthStr(style.marker) === 1, `${k} 符号 "${style.marker}" 单列宽`);
    colors.add(style.color);
    markers.add(style.marker);
  }
  check(colors.size === 3, "三档颜色互不相同");
  check(markers.size === 3, "三档符号互不相同");
});
