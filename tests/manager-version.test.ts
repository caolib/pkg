/**
 * 管理器版本号解析（_cli.parseVersionOutput）回归测试。
 *
 * 设置界面显示各已安装管理器的版本号，取的是 `<cli> --version` 的输出——
 * 各家格式不统一（有的纯号、有的带名字/构建信息、scoop 是多行），这里用各管理器
 * 的真实输出守住解析规则与"取不到返回空串"的边界。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { parseVersionOutput } from "../src/managers/_cli";

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
}

/** 断言解析结果。 */
function expectVersion(raw: string, want: string) {
  const got = parseVersionOutput(raw);
  check(got === want, `${JSON.stringify(raw.slice(0, 48))} → ${want || "空"}（实际 ${got || "空"}）`);
}

test("各管理器真实输出都能解析出纯版本号", () => {
  expectVersion("11.11.0", "11.11.0"); // npm
  expectVersion("12.5.1", "12.5.1"); // pnpm
  expectVersion("1.4.2", "1.4.2"); // bun
  expectVersion("v1.29.290", "1.29.290"); // winget 带 v 前缀
  expectVersion("cargo 1.96.0 (30a34c682 2026-05-25)", "1.96.0"); // cargo 带名字与构建信息
  expectVersion("2.7.2", "2.7.2"); // choco
  expectVersion("uv 0.9.13 (7ca92dcf6 2025-11-26)", "0.9.13"); // uv
  expectVersion(
    [
      "Current Scoop version:",
      "b588a06e chore(release): Bump to version 0.5.3 (resync) (#6436)",
      "'main' bucket:",
      "06871092c3 scaleway-cli: Update to version 2.61.0",
    ].join("\n"),
    "0.5.3", // scoop 多行：版本号藏在提交行里，且不能被提交哈希的前几位骗到
  );
});

test("边界：空输出/无版本号/ANSI/前后缀版本", () => {
  expectVersion("", "");
  expectVersion("\n  \n", "");
  expectVersion("unknown command: --version", "");
  expectVersion("\x1b[32m0.5.3\x1b[0m", "0.5.3"); // 带 ANSI 颜色
  expectVersion("v1.0.0-beta.2", "1.0.0-beta.2"); // 预发布后缀保留
  expectVersion("1.2.3.4\r\n", "1.2.3.4"); // 四段版本 + CRLF
});
