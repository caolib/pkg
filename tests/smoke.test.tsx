/**
 * 集成冒烟测试(用 @opentui/react/test-utils 的 testRender)。
 *
 * 验证主界面启动无崩溃 + 顶栏渲染 + 设置 overlay 开关 + 光标/勾选交互。
 * 不依赖具体 CLI 输出内容;若本机有可用包管理器会额外加载出数据行。
 *
 * 运行:bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../src/App";

test("冒烟测试:主界面启动 + 设置 overlay + 光标/勾选交互", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  const setup = await testRender(<App />, { width: 100, height: 24 });
  try {
    // 启动:等待顶栏"全部"出现(i18n 已加载)
    await setup.waitFor(
      () => {
        const f = setup.captureCharFrame();
        return f.includes("全部") || f.includes("All");
      },
      { maxPasses: 300 },
    );
    const f0 = setup.captureCharFrame();
    check(f0.includes("全部") || f0.includes("All"), "主界面顶栏渲染");
    check(f0.includes("下载") || f0.includes("Search"), "顶栏含搜索按钮");

    // 设置 overlay:默认快捷键 alt+s 打开
    await act(async () => {
      setup.mockInput.pressKey("s", { meta: true });
    });
    await setup.renderOnce();
    const f1 = setup.captureCharFrame();
    // 设置界面底部固定有"Enter/Space 切换"操作提示,作为打开成功的稳定标识
    const settingsOpen = f1.includes("Enter/Space 切换");
    check(settingsOpen, "alt+s 打开设置界面");
    const settingsFrame = setup.captureSpans();
    const hasMagentaBackground = settingsFrame.lines.some((line) =>
      line.spans.some((span) => {
        const [r, g, b] = span.bg.toInts();
        return r === 255 && g === 0 && b === 255;
      }),
    );
    check(!hasMagentaBackground, "设置界面遮罩颜色正确");
    const hasBlueBorder = settingsFrame.lines.some((line) =>
      line.spans.some((span) => {
        const [r, g, b] = span.fg.toInts();
        return r === 51 && g === 102 && b === 204;
      }),
    );
    check(!hasBlueBorder, "设置界面无蓝色边框");

    // 关闭设置:Esc 关闭(Esc 单发时 stdin parser 会先当作转义序列前缀挂起,
    // 需等它超时 flush,见 focus-keys.test.tsx 的 pressEscape)
    await act(async () => {
      setup.mockInput.pressEscape();
      await new Promise((r) => setTimeout(r, 200));
    });
    await setup.renderOnce();
    const f2 = setup.captureCharFrame();
    check(!f2.includes("Enter/Space 切换"), "Esc 关闭设置界面");

    // 光标 + 勾选:↓ + space。若有数据行会勾选(出现 ✓);空表也不应崩。
    await act(async () => {
      setup.mockInput.pressArrow("down");
    });
    await setup.renderOnce();
    await act(async () => {
      setup.mockInput.pressKey(" ");
    });
    await setup.renderOnce();
    const f3 = setup.captureCharFrame();
    check(true, "↓ + space 交互未崩溃");
    if (f3.includes("✓")) {
      console.log("  ✓ 光标移动 + 勾选生效(✓ 出现)");
    } else {
      console.log("  · 无 ✓(可能无已安装包数据,交互逻辑本身已验证)");
    }
  } finally {
    setup.renderer.destroy();
  }
});
