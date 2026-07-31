/**
 * 焦点 / 按键归属回归测试。
 *
 * 覆盖 bug：鼠标点击输入框后，渲染器焦点已在 input，但组件自己的
 * filterMode / focusOnTable 仍是旧值，导致字符键既进输入框又被当快捷键
 * 执行（输入 "opencode" 的 d 触发卸载）。见 src/focus.ts。
 *
 * 运行：bun tests/focus-keys.tsx
 */
import { testRender } from "@opentui/react/test-utils"
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
  /** 主界面动作被误触发的标志（确认框 / "没有选中的包" toast）。 */
  const actionFired = () => {
    const f = setup.captureCharFrame()
    return f.includes("没有选中的包") || f.includes("确定要卸载") || f.includes("确定要更新")
  }
  const press = async (ch: string) => {
    await act(async () => {
      setup.mockInput.pressKey(ch)
    })
    await setup.renderOnce()
  }
  const type = async (text: string) => {
    for (const ch of text) await press(ch)
  }
  /** Esc 单发时 stdin parser 会先当作转义序列前缀挂起，需等它超时 flush。 */
  const pressEscape = async () => {
    await act(async () => {
      setup.mockInput.pressEscape()
      await new Promise((r) => setTimeout(r, 200))
    })
    await setup.renderOnce()
  }

  try {
    await setup.waitFor(
      () => {
        const f = setup.captureCharFrame()
        return f.includes("全部") || f.includes("All")
      },
      { maxPasses: 300 },
    )

    // --- 1. 鼠标点击顶栏过滤框后打字 ---
    await act(async () => {
      await setup.mockMouse.click(20, 0)
    })
    await setup.renderOnce()
    check(
      setup.renderer.currentFocusedRenderable?.constructor?.name === "InputRenderable",
      "点击过滤框后渲染器焦点在 input",
    )

    let fired = false
    await type("opencode")
    fired = actionFired()
    check(!fired, "过滤框打字 'opencode' 不触发主界面快捷键（d 不再卸载）")
    check(setup.captureCharFrame().includes("opencode"), "字符完整进入过滤框")

    // --- 2. Esc 退出过滤 → 快捷键恢复 ---
    await pressEscape()
    check(
      setup.renderer.currentFocusedRenderable?.constructor?.name !== "InputRenderable",
      "Esc 后过滤框已 blur（焦点交还表格）",
    )
    await press("d")
    check(actionFired(), "退出过滤后 d 恢复为卸载快捷键")
    // 关掉确认框，避免影响后续用例
    await pressEscape()

    // --- 3. 键盘 / 进入过滤模式后打字 ---
    await press("/")
    await type("opencode")
    check(!actionFired(), "/ 进入过滤模式打字同样不触发快捷键")
    await pressEscape()

    // --- 4. 全局搜索界面输入框打字 ---
    await press("s")
    const inSearch = setup.captureCharFrame().includes("中搜索") || setup.captureCharFrame().includes("Search in")
    if (!inSearch) {
      console.log("  · 本机无可用包管理器，跳过搜索界面用例")
    } else {
      await type("opencode")
      check(!actionFired(), "搜索界面输入框打字不触发主界面快捷键")
      check(setup.captureCharFrame().includes("opencode"), "字符完整进入搜索输入框")
      await pressEscape()
    }

    console.log(
      failures === 0
        ? "\n=== [ALL OK] 焦点/按键归属测试通过 ==="
        : `\n=== 有 ${failures} 项未通过 ===`,
    )
  } catch (e) {
    console.log("ERROR:", String(e))
    failures++
  } finally {
    setup.renderer.destroy()
  }
  if (failures > 0) process.exit(1)
}
main()
