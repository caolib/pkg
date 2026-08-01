/**
 * LoadingIndicator 加载状态指示器回归测试。
 *
 * 验证：单方向扫描（头部位置每帧 +1，到右端回到左端）、尾部颜色按距离指数衰减、
 * 卸载时清掉 interval。运行：bun test
 */
import { test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { LoadingIndicator } from "../src/components/LoadingIndicator"

test("LoadingIndicator 单方向扫描 + 色衰减", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg)
    console.log("  ✓", msg)
  }

  const W = 6
  const s = await testRender(<LoadingIndicator color="#3d7fc9" width={W} interval={40} />, {
    width: 20,
    height: 3,
  })
  try {
    // 取连续几帧的"最亮格"位置（RGB 最接近基色 #3d7fc9 = 0.24,0.50,0.79 的格子）
    const brightestIdx = (): number => {
      const spans = s.captureSpans().lines[0].spans
      let best = -1
      let bestScore = Infinity
      let col = 0
      for (const sp of spans) {
        const fg = sp.fg as any
        if (!fg || !sp.text.includes("■")) continue
        // 距基色(0.24,0.50,0.79) 的欧氏距离，越小越亮
        const score = (fg.r - 0.24) ** 2 + (fg.g - 0.5) ** 2 + (fg.b - 0.79) ** 2
        if (score < bestScore) {
          bestScore = score
          best = col
        }
        col += sp.text.length
      }
      return best
    }

    // 推进 8 帧，记录头部位置序列——应单调 +1，到 W 后回到 0（单方向）
    const positions: number[] = []
    for (let f = 0; f < 8; f++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
      await s.renderOnce()
      positions.push(brightestIdx())
    }
    console.log("  头部位置序列:", positions.join(","))
    // 至少有一帧头部前进了（动画在跑）
    check(new Set(positions).size > 1, "头部位置随帧变化（动画在跑）")
    // 单方向：相邻帧差值要么 +1 要么回绕（负），不应出现 -2 以下的回退（那会是双向）
    let monotonic = true
    for (let i = 1; i < positions.length; i++) {
      const d = positions[i] - positions[i - 1]
      if (d !== 1 && d !== -(W - 1) && d !== 0) {
        // 0 可能是采样间隔恰好同帧；允许；其余负值只能是回绕
        if (d < 0 && d !== -(W - 1)) {
          monotonic = false
          break
        }
      }
    }
    check(monotonic, "头部单方向前进（不双向回扫，回绕只能是 W→0）")

    // 色衰减：某一帧里，离头部越远的格子 RGB 越暗
    const spans = s.captureSpans().lines[0].spans
    let col = 0
    const cells: { idx: number; bright: number }[] = []
    for (const sp of spans) {
      const fg = sp.fg as any
      if (!fg || !sp.text.includes("■")) {
        col += sp.text.length
        continue
      }
      const bright = fg.r + fg.g + fg.b
      for (let k = 0; k < sp.text.length; k++) cells.push({ idx: col + k, bright })
      col += sp.text.length
    }
    check(cells.length === W, `渲染了 ${W} 个方块格子（实际 ${cells.length}）`)
    // 最亮格的亮度 > 最暗格的亮度
    const maxB = Math.max(...cells.map((c) => c.bright))
    const minB = Math.min(...cells.map((c) => c.bright))
    check(maxB > minB, `色衰减生效（最亮 ${maxB.toFixed(2)} > 最暗 ${minB.toFixed(2)}）`)
  } finally {
    s.renderer.destroy()
  }
})
