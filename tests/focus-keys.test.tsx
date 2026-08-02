/**
 * 焦点 / 按键归属回归测试。
 *
 * 覆盖 bug：鼠标点击输入框后，渲染器焦点已在 input，但组件自己的
 * filterMode / focusOnTable 仍是旧值，导致字符键既进输入框又被当快捷键
 * 执行（输入 "opencode" 的 d 触发卸载）。见 src/focus.ts。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../src/App";

test(
  "焦点/按键归属回归",
  async () => {
    const check = (cond: boolean, msg: string) => {
      if (!cond) throw new Error(msg);
      console.log("  ✓", msg);
    };
    const setup = await testRender(<App />, { width: 100, height: 24 });
    /** 主界面动作被误触发的标志（确认框 / "没有选中的包" toast）。 */
    const actionFired = () => {
      const f = setup.captureCharFrame();
      return f.includes("没有选中的包") || f.includes("确定要卸载") || f.includes("确定要更新");
    };
    const press = async (ch: string) => {
      await act(async () => {
        setup.mockInput.pressKey(ch);
      });
      await setup.renderOnce();
    };
    const pressArrow = async (dir: "left" | "right" | "up" | "down") => {
      await act(async () => {
        setup.mockInput.pressArrow(dir);
      });
      await setup.renderOnce();
    };
    const type = async (text: string) => {
      for (const ch of text) await press(ch);
    };
    /** 等"没有选中的包"这类 toast 自动消失（toast 非 overlay，Esc 关不掉）。
     *  toast 自动消失靠 4s 定时器，并行跑测试时事件循环可能延迟，给到 15s；
     *  超时仍未消失则抛错（而非静默返回），避免残留 toast 让后续 actionFired 误判。 */
    const waitForToastGone = async (text: string, timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!setup.captureCharFrame().includes(text)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`toast "${text}" 在 ${timeoutMs}ms 内未自动消失`);
    };
    /** Esc 单发时 stdin parser 会先当作转义序列前缀挂起，需等它超时 flush。 */
    const pressEscape = async () => {
      await act(async () => {
        setup.mockInput.pressEscape();
        await new Promise((r) => setTimeout(r, 200));
      });
      await setup.renderOnce();
    };

    try {
      await setup.waitFor(
        () => {
          const f = setup.captureCharFrame();
          return f.includes("全部") || f.includes("All");
        },
        { maxPasses: 300 },
      );

      // --- 1. 鼠标点击顶栏过滤框后打字 ---
      await act(async () => {
        await setup.mockMouse.click(20, 0);
      });
      await setup.renderOnce();
      check(
        setup.renderer.currentFocusedRenderable?.constructor?.name === "InputRenderable",
        "点击过滤框后渲染器焦点在 input",
      );

      let fired = false;
      await type("opencode");
      fired = actionFired();
      check(!fired, "过滤框打字 'opencode' 不触发主界面快捷键（d 不再卸载）");
      check(setup.captureCharFrame().includes("opencode"), "字符完整进入过滤框");

      // --- 2. Esc 退出过滤 → 快捷键恢复 ---
      await pressEscape();
      check(
        setup.renderer.currentFocusedRenderable?.constructor?.name !== "InputRenderable",
        "Esc 后过滤框已 blur（焦点交还表格）",
      );
      await press("d");
      check(actionFired(), "退出过滤后 d 恢复为卸载快捷键");
      // 本机表格有真实包时 d 弹的是卸载确认框（overlay，Esc 可关）；
      // 无包时是 "没有选中的包" toast（Esc 关不掉，等它自动消失，否则
      // 残留 toast 会让用例 3 的 actionFired 误判为"打字触发快捷键"）。
      if (
        setup.captureCharFrame().includes("确定要卸载") ||
        setup.captureCharFrame().includes("确定要更新")
      ) {
        await pressEscape();
      } else {
        await waitForToastGone("没有选中的包");
      }

      // --- 3. 键盘 / 进入过滤模式后打字 ---
      await press("/");
      await type("opencode");
      check(!actionFired(), "/ 进入过滤模式打字同样不触发快捷键");
      await pressEscape();

      // --- 4. 全局搜索界面：← → 循环导航 + 输入框打字 ---
      await press("s");
      // 搜索界面占位符 "在 {names} 中搜索..." 可能被渲染层吞掉尾部字符
      // （本机 OpenTUI 原生缓冲的已知现象），检测不能只依赖 "中搜索"；
      // 搜索打开时渲染器焦点在搜索输入框（isInput），主界面过滤框此时必未聚焦。
      const isInput = () =>
        setup.renderer.currentFocusedRenderable?.constructor?.name === "InputRenderable";
      const f4 = setup.captureCharFrame();
      const inSearch =
        (f4.includes("中搜索") || f4.includes("Search in") || f4.includes("在 ")) && isInput();
      if (!inSearch) {
        console.log("  · 本机无可用包管理器，跳过搜索界面用例");
      } else {
        // 4a. ← → 循环导航：搜索框 ⇄ 范围条。范围条 = "全部" + 各可用管理器按钮；
        // 曾 bug：→ 只在按钮间循环、← 停在输入框，均无法绕一圈回来。
        // 先测导航再打字：此时查询为空，切换范围不会触发重搜（避免子进程开销）。
        check(isInput(), "搜索界面初始焦点在输入框");
        // 输入框 ← 循环到最右按钮
        await pressArrow("left");
        check(!isInput(), "输入框 ← 循环到范围条最右按钮");
        // 最右按钮 → 回输入框（此时 target=最右按钮）
        await pressArrow("right");
        check(isInput(), "范围条最右 → 回输入框");
        // 输入框 → 进范围条（曾 bug：落在当前 target=最右按钮上，导致 → 两次就
        // 绕回输入框、跳过中间的按钮；修复后必须从最左按钮开始走完整条）
        await pressArrow("right");
        check(!isInput(), "输入框 → 进范围条（从最左按钮开始）");
        let back = false;
        let steps = 0;
        for (let i = 0; i < 12 && !back; i++) {
          await pressArrow("right");
          steps++;
          back = isInput();
        }
        check(back && steps >= 3, `输入框 → 完整走遍范围条才回输入框（${steps} 步）`);
        // 反向：输入框 ← 进范围条，连续 ← 也能循环回输入框（目标范围回到"全部"）
        await pressArrow("left");
        check(!isInput(), "输入框 ← 再次进入范围条");
        back = false;
        for (let i = 0; i < 12 && !back; i++) {
          await pressArrow("left");
          back = isInput();
        }
        check(back, "连续 ← 从范围条完整循环回输入框");

        // 4b. 输入框打字不触发主界面快捷键
        await type("opencode");
        check(!actionFired(), "搜索界面输入框打字不触发主界面快捷键");
        check(setup.captureCharFrame().includes("opencode"), "字符完整进入搜索输入框");
        await pressEscape();
      }

      // --- 5. 顶栏 ← → 聚焦过滤框：input 连带聚焦显示光标，且导航不被吞 ---
      // 曾 bug：← → 切到过滤框只高亮背景、无光标（OpenTUI 光标只在聚焦的
      // renderable 上绘制）。修复：过滤框聚焦时连带 focus input；依赖全局
      // keyHandler 先于聚焦 input 处理按键，导航键 preventDefault 不被吞。

      // 5a. 表格首行 ↑ 进入顶栏模式
      await pressArrow("up");
      check(!isInput(), "↑ 后进入顶栏按钮模式（过滤框未聚焦）");

      // 5b. ← 循环导航直到过滤框：渲染器焦点应落到 input（光标出现）
      let gotInput = false;
      for (let i = 0; i < 12 && !gotInput; i++) {
        await pressArrow("left");
        gotInput = isInput();
      }
      check(gotInput, "← 循环导航可到达过滤框（渲染器焦点在 input）");
      let spans = setup.captureSpans();
      check(
        spans.cursor[0] > 1 && spans.cursor[1] === 1,
        "聚焦过滤框时光标定位在输入框内（captureSpans.cursor）",
      );

      // 5c. 继续 ← 应离开过滤框（聚焦的 input 不能吞掉导航键）
      await pressArrow("left");
      check(!isInput(), "过滤框 ← 继续导航到搜索按钮（input 未吞键）");
      await pressArrow("right");
      check(isInput(), "→ 回到过滤框仍连带聚焦 input");

      // 5d. 顶栏聚焦过滤框时直接打字 → 进入过滤框且不触发快捷键
      await type("abc");
      check(setup.captureCharFrame().includes("abc"), "顶栏聚焦过滤框时打字进入过滤框");
      check(!actionFired(), "顶栏聚焦过滤框打字不触发主界面快捷键");

      // 5e. Esc 退出 → blur 交还表格，快捷键恢复
      await pressEscape();
      check(!isInput(), "过滤框 Esc 退出（blur 交还表格）");
      await press("d");
      check(actionFired(), "Esc 退出后 d 恢复为卸载快捷键");
      // 同用例 2：本机表格有真实包时弹确认框（Esc 关），无包时弹 toast（等消失）
      if (
        setup.captureCharFrame().includes("确定要卸载") ||
        setup.captureCharFrame().includes("确定要更新")
      ) {
        await pressEscape();
      } else {
        await waitForToastGone("没有选中的包");
      }

      // 5f. 再次 ← 到过滤框，Enter 同样退出并 blur
      await pressArrow("up");
      for (let i = 0; i < 12; i++) {
        await pressArrow("left");
        if (isInput()) break;
      }
      check(isInput(), "再次 ← 到过滤框（input 聚焦）");
      await press("\r");
      check(!isInput(), "过滤框 Enter 退出并 blur");
    } finally {
      setup.renderer.destroy();
    }
  },
  // 用例含 Esc 转义超时等待与 toast 自动消失轮询，默认 5s 不够
  { timeout: 30000 },
);
