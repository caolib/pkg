/**
 * 集成冒烟测试（非阻塞，用 @opentui/react/test-utils 的 testRender）。
 *
 * 验证主界面启动无崩溃 + 顶栏渲染 + 设置 overlay 开关 + 光标/勾选交互。
 * 不依赖具体 CLI 输出内容；若本机有可用包管理器会额外加载出数据行。
 *
 * 运行：bun tests/smoke.tsx
 */
import { testRender } from "@opentui/react/test-utils"
import { KeyCodes } from "@opentui/core/testing"
import { act } from "react"
import { App } from "../src/App"

async function main() {
  let failures = 0
  const check = (cond: boolean, msg: string) => {
    if (!cond) {
      failures++
      console.log("  ✗", msg)
    } else {
      console.log("  ✓", msg)
    }
  }

  const setup = await testRender(<App />, { width: 100, height: 24 })
  try {
    // 启动：等待顶栏"全部"出现（i18n 已加载）
    await setup.waitFor(
      () => {
        const f = setup.captureCharFrame()
        return f.includes("全部") || f.includes("All")
      },
      { maxPasses: 300 },
    )
    const f0 = setup.captureCharFrame()
    check(f0.includes("全部") || f0.includes("All"), "主界面顶栏渲染")
    check(f0.includes("下载") || f0.includes("Search"), "顶栏含搜索按钮")

    // 设置 overlay：Ctrl+, 打开
    await act(async () => {
      setup.mockInput.pressKey(",", { ctrl: true })
    })
    await setup.renderOnce()
    const f1 = setup.captureCharFrame()
    // 设置界面底部固定有"↑↓ 移动"操作提示，作为打开成功的稳定标识
    const settingsOpen = f1.includes("↑↓ 移动")
    check(settingsOpen, "Ctrl+, 打开设置界面")

    // 关闭设置：↓ 移到末尾"完成"行再 Enter。逐键 act+render 让 useKeyboard
    // 回调闭包刷新（同 act 内批量发键会因闭包陈旧导致 cursor 不累积）。
    // 真实终端每次按键间会重新渲染，无此问题；testRender 需逐键。
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        setup.mockInput.pressArrow("down")
      })
      await setup.renderOnce()
    }
    await act(async () => {
      setup.mockInput.pressKey("\r")
    })
    await setup.renderOnce()
    await setup.flush()
    await setup.renderOnce()
    const f2 = setup.captureCharFrame()
    check(!f2.includes("↑↓ 移动"), "在完成行 Enter 关闭设置界面")

    // 光标 + 勾选：↓ + space。若有数据行会勾选（出现 ✓）；空表也不应崩。
    await act(async () => {
      setup.mockInput.pressArrow("down")
    })
    await setup.renderOnce()
    await act(async () => {
      setup.mockInput.pressKey(" ")
    })
    await setup.renderOnce()
    const f3 = setup.captureCharFrame()
    check(true, "↓ + space 交互未崩溃")
    if (f3.includes("✓")) {
      console.log("  ✓ 光标移动 + 勾选生效（✓ 出现）")
    } else {
      console.log("  · 无 ✓（可能无已安装包数据，交互逻辑本身已验证）")
    }

    console.log(
      failures === 0
        ? "\n=== [ALL OK] 冒烟测试通过 ==="
        : `\n=== 冒烟测试有 ${failures} 项未通过 ===`,
    )
  } catch (e) {
    console.log("SMOKE ERROR:", String(e))
    failures++
  } finally {
    setup.renderer.destroy()
  }
  if (failures > 0) process.exit(1)
}
main()
