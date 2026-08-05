/**
 * overlay 栈与确认框多按钮模式回归测试。
 *
 * - SearchScreen active=false（被上层 overlay 压住）时不响应按键。
 * - ConfirmDialog options 模式（合并 registry 安装选管理器）：每个选项一个
 *   按钮 + 取消，← → 移动聚焦时命令预览随之切换，Enter 执行聚焦选项。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { SearchScreen } from "../src/screens/SearchScreen";
import { ConfirmDialog, type ConfirmOption } from "../src/screens/ConfirmDialog";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** stdin 解析器异步处理输入，事件后须多轮 tick+render 消化（同鼠标测试约定）。 */
async function pump(setup: Awaited<ReturnType<typeof testRender>>, rounds = 10) {
  for (let round = 0; round < rounds; round++) {
    await tick();
    await setup.renderOnce();
  }
}

const check = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
};

test("SearchScreen：active=false 时不响应按键（overlay 栈仅顶层交互）", async () => {
  let closed = 0;
  let installed = 0;
  let toggle: () => void = () => {};
  function Harness() {
    const [active, setActive] = useState(false);
    toggle = () => setActive((a) => !a);
    return (
      <SearchScreen
        managers={[]}
        active={active}
        onClose={() => closed++}
        onView={() => {}}
        onInstall={() => installed++}
      />
    );
  }

  const setup = await testRender(<Harness />, { width: 80, height: 20 });
  try {
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await pump(setup);
    check(closed === 0, "active=false 时 Esc 不触发 onClose");
    await act(async () => {
      setup.mockInput.pressKey("i");
    });
    await pump(setup);
    check(installed === 0, "active=false 时 i 不触发安装");

    // 切回顶层：恢复响应
    await act(async () => {
      toggle();
    });
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await pump(setup);
    check(closed === 1, "active=true 后 Esc 恢复触发 onClose");
  } finally {
    setup.renderer.destroy();
  }
});

test("ConfirmDialog options 模式：多按钮 + 预览随聚焦切换 + Enter 执行", async () => {
  let acted = "";
  let cancelled = 0;
  // 命令串刻意互不为子串（"pnpm install" 包含 "npm install" 后缀子串，踩过坑）
  const options: ConfirmOption[] = [
    { label: "npm", command: "npm i -g foo", action: () => { acted = "npm"; } },
    { label: "pnpm", command: "pnpm add -g foo", action: () => { acted = "pnpm"; } },
    { label: "bun", command: "bun add -g foo", action: () => { acted = "bun"; } },
  ];
  const setup = await testRender(
    <ConfirmDialog
      message="Install foo?"
      options={options}
      onCancel={() => cancelled++}
    />,
    { width: 80, height: 12 },
  );
  try {
    await pump(setup);
    let f = setup.captureCharFrame();
    check(
      f.includes("npm") && f.includes("pnpm") && f.includes("bun"),
      "三个管理器按钮都渲染",
    );
    check(f.includes("npm i -g foo"), "初始预览为聚焦项（npm）的命令");

    // → 聚焦 pnpm：预览切换为 pnpm 的命令；Enter 执行 pnpm
    await act(async () => {
      setup.mockInput.pressArrow("right");
    });
    await pump(setup);
    f = setup.captureCharFrame();
    check(
      f.includes("pnpm add -g foo") && !f.includes("npm i -g foo"),
      "→ 后预览切换为 pnpm 命令",
    );
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);
    check(acted === "pnpm", `Enter 执行聚焦选项 pnpm（实际 ${acted}）`);

    // Esc 取消
    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await pump(setup);
    check(cancelled === 1, "Esc 触发取消");
  } finally {
    setup.renderer.destroy();
  }
});
