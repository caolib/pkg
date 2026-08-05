/**
 * 搜索界面（SearchScreen）布局回归测试。
 *
 * 1. 范围条按 registry 分组：同 registry 的 pnpm/bun 并入 npm，不单独显示。
 * 2. 底栏：只保留操作提示（i 安装 / v 详情）+ 右侧搜索状态（结果计数），
 *    不再显示 ← → 切换范围 / 返回 Esc / 横向滚动提示。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { SearchScreen } from "../src/screens/SearchScreen";

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

test("搜索范围条：同 registry 并入代表按钮（不显示 pnpm/bun）", async () => {
  const managers = [
    { name: "npm", registry: "npm" },
    { name: "pnpm", registry: "npm" },
    { name: "bun", registry: "npm" },
    { name: "scoop", registry: "scoop" },
  ] as any[];

  const setup = await testRender(
    <SearchScreen managers={managers} onClose={() => {}} onView={() => {}} onInstall={() => {}} />,
    { width: 80, height: 20 },
  );
  try {
    for (let i = 0; i < 10; i++) {
      await tick();
      await setup.renderOnce();
    }
    const f = setup.captureCharFrame();
    check(f.includes("npm"), "范围条显示 npm（npm registry 代表）");
    check(f.includes("scoop"), "范围条显示 scoop（独立 registry）");
    check(!f.includes("pnpm"), "范围条不显示 pnpm（并入 npm）");
    check(!f.includes("bun"), "范围条不显示 bun（并入 npm）");
  } finally {
    setup.renderer.destroy();
  }
});

test("搜索底栏：左侧操作提示 + 右侧结果状态，无导航/滚动提示", async () => {
  const managers = [
    {
      name: "npm",
      registry: "npm",
      search: async () => [
        { name: "react", version: "19.0.0", description: "ui lib" },
        { name: "react-dom", version: "19.0.0", description: "dom" },
      ],
    },
  ] as any[];

  const setup = await testRender(
    <SearchScreen managers={managers} onClose={() => {}} onView={() => {}} onInstall={() => {}} />,
    { width: 80, height: 20 },
  );
  try {
    await pump(setup);
    // 输入查询并回车搜索
    await act(async () => {
      await setup.mockInput.typeText("react");
    });
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);

    const f = setup.captureCharFrame();
    check(f.includes("react"), "搜索结果显示在表格中");
    const bottom = f.replace(/\n+$/, "").split("\n").pop() ?? "";
    check(
      bottom.includes("找到 2 个结果") || bottom.includes("Found 2 results"),
      `结果计数显示在底栏（底行: ${bottom.trim()}）`,
    );
    check(bottom.includes("安装") || bottom.includes("Install"), "底栏保留安装/详情提示");
    check(!f.includes("切换范围") && !f.includes("switch scope"), "不再显示 ← → 切换范围");
    check(!f.includes("返回 Esc") && !f.includes("back Esc"), "不再显示 返回 Esc");
    check(!f.includes("滚轮") && !f.includes("wheel"), "不再显示横向滚动提示");
  } finally {
    setup.renderer.destroy();
  }
});

test("搜索界面：表格聚焦时 o 查看命令输出（与主界面一致）", async () => {
  let outputOpened = 0;
  const managers = [
    {
      name: "npm",
      registry: "npm",
      search: async () => [
        { name: "react", version: "19.0.0", description: "ui lib" },
      ],
    },
  ] as any[];

  const setup = await testRender(
    <SearchScreen
      managers={managers}
      onClose={() => {}}
      onView={() => {}}
      onInstall={() => {}}
      onViewOutput={() => outputOpened++}
    />,
    { width: 80, height: 20 },
  );
  try {
    await pump(setup);
    // 搜索：回车后焦点自动落到结果表格（doSearch 成功后 focusTable）
    await act(async () => {
      await setup.mockInput.typeText("react");
    });
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);
    check(setup.captureCharFrame().includes("react"), "搜索结果显示在表格中");
    check(
      setup.renderer.currentFocusedRenderable?.constructor?.name !== "InputRenderable",
      "搜索后焦点离开输入框（落在表格）",
    );

    // 表格聚焦时 o 触发查看输出
    await act(async () => {
      setup.mockInput.pressKey("o");
    });
    await pump(setup);
    check(outputOpened === 1, "表格聚焦时 o 触发 onViewOutput");
  } finally {
    setup.renderer.destroy();
  }
});

test("搜索界面：输入框聚焦打字时 o 不误触发查看输出", async () => {
  let outputOpened = 0;
  const managers = [{ name: "npm", registry: "npm" }] as any[];
  const setup = await testRender(
    <SearchScreen
      managers={managers}
      onClose={() => {}}
      onView={() => {}}
      onInstall={() => {}}
      onViewOutput={() => outputOpened++}
    />,
    { width: 80, height: 20 },
  );
  try {
    await pump(setup);
    check(
      setup.renderer.currentFocusedRenderable?.constructor?.name === "InputRenderable",
      "初始焦点在搜索输入框",
    );
    // 输入框聚焦时 o 应进入输入框、不触发查看输出（isTextInputFocused 门控）
    await act(async () => {
      setup.mockInput.pressKey("o");
    });
    await pump(setup);
    check(outputOpened === 0, "输入框聚焦时 o 不触发查看输出");
  } finally {
    setup.renderer.destroy();
  }
});

test("搜索界面：/ 从表格/范围条聚焦回搜索框，输入框聚焦时作字符输入", async () => {
  const managers = [
    {
      name: "npm",
      registry: "npm",
      search: async () => [{ name: "react", version: "1.0.0", description: "ui" }],
    },
  ] as any[];
  const setup = await testRender(
    <SearchScreen
      managers={managers}
      onClose={() => {}}
      onView={() => {}}
      onInstall={() => {}}
      onViewOutput={() => {}}
    />,
    { width: 80, height: 20 },
  );
  const isInput = () =>
    setup.renderer.currentFocusedRenderable?.constructor?.name === "InputRenderable";
  try {
    await pump(setup);
    check(isInput(), "初始焦点在搜索输入框");

    // 搜索后焦点落到表格
    await act(async () => {
      await setup.mockInput.typeText("react");
    });
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);
    check(!isInput(), "搜索后焦点在表格");

    // 表格聚焦时 / 聚焦回搜索框
    await act(async () => {
      setup.mockInput.pressKey("/");
    });
    await pump(setup);
    check(isInput(), "表格聚焦时 / 聚焦回搜索框");

    // 范围条聚焦时 / 也聚焦回搜索框
    await act(async () => {
      setup.mockInput.pressArrow("down");
    });
    await pump(setup);
    check(!isInput(), "↓ 进入范围条");
    await act(async () => {
      setup.mockInput.pressKey("/");
    });
    await pump(setup);
    check(isInput(), "范围条聚焦时 / 聚焦回搜索框");

    // 输入框聚焦时 / 作为搜索字符输入，不触发聚焦（已在输入框）
    await act(async () => {
      setup.mockInput.pressKey("f");
      setup.mockInput.pressKey("o");
      setup.mockInput.pressKey("o");
      setup.mockInput.pressKey("/");
      setup.mockInput.pressKey("b");
      setup.mockInput.pressKey("a");
      setup.mockInput.pressKey("r");
    });
    await pump(setup);
    check(
      setup.captureCharFrame().includes("foo/bar"),
      "输入框聚焦时 / 作为字符输入（foo/bar）",
    );
    check(isInput(), "输入框打字期间焦点保持在输入框");
  } finally {
    setup.renderer.destroy();
  }
});

test("搜索界面：增量显示——先完成的来源结果立刻出现，后完成的追加", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };
  // 两个代表：npm 立即返回，scoop 延迟返回。验证 npm 结果先显示
  let npmCallCount = 0;
  let scoopCallCount = 0;
  const managers = [
    {
      name: "npm",
      registry: "npm",
      search: async (q: string) => {
        npmCallCount++;
        return [{ name: "react", version: "1.0.0", description: "ui" }];
      },
    },
    {
      name: "scoop",
      registry: "scoop",
      search: (q: string) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve([{ name: "curl", version: "8.0", description: "tool" }]),
            80,
          ),
        ),
    },
  ] as any[];
  const setup = await testRender(
    <SearchScreen
      managers={managers}
      onClose={() => {}}
      onView={() => {}}
      onInstall={() => {}}
      onViewOutput={() => {}}
    />,
    { width: 80, height: 20 },
  );
  try {
    await pump(setup);
    await act(async () => {
      await setup.mockInput.typeText("foo");
    });
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);
    // npm 立即返回：react 应已显示
    check(setup.captureCharFrame().includes("react"), "先完成的来源（npm）结果立刻显示");
    // 等待 scoop 延迟完成
    await new Promise((r) => setTimeout(r, 150));
    await pump(setup);
    check(setup.captureCharFrame().includes("curl"), "后完成的来源（scoop）结果追加显示");
  } finally {
    setup.renderer.destroy();
  }
});

test("搜索界面：切换范围不重复搜索（命中缓存直接展示）", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };
  let npmCallCount = 0;
  let scoopCallCount = 0;
  const managers = [
    {
      name: "npm",
      registry: "npm",
      search: async () => {
        npmCallCount++;
        return [{ name: "react", version: "1.0.0", description: "ui" }];
      },
    },
    {
      name: "scoop",
      registry: "scoop",
      search: async () => {
        scoopCallCount++;
        return [{ name: "curl", version: "8.0", description: "tool" }];
      },
    },
  ] as any[];
  const setup = await testRender(
    <SearchScreen
      managers={managers}
      onClose={() => {}}
      onView={() => {}}
      onInstall={() => {}}
      onViewOutput={() => {}}
    />,
    { width: 80, height: 20 },
  );
  try {
    await pump(setup);
    // 在"全部"下搜索：npm + scoop 各搜一次
    await act(async () => {
      await setup.mockInput.typeText("foo");
    });
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);
    check(setup.captureCharFrame().includes("react"), "全部范围搜索显示结果");
    const npmAfterAll = npmCallCount;
    const scoopAfterAll = scoopCallCount;
    check(npmAfterAll === 1 && scoopAfterAll === 1, "全部范围搜索各代表各搜 1 次");

    // 切换到 npm：命中缓存，不应再调 npm search
    await act(async () => {
      setup.mockInput.pressArrow("left");
    });
    await pump(setup);
    check(npmCallCount === npmAfterAll, "切到 npm 不重搜（命中缓存）");
    // 切换到 scoop：同样命中缓存
    await act(async () => {
      setup.mockInput.pressArrow("left");
    });
    await pump(setup);
    check(scoopCallCount === scoopAfterAll, "切到 scoop 不重搜（命中缓存）");
    // 切回全部：命中缓存
    await act(async () => {
      setup.mockInput.pressArrow("left");
    });
    await pump(setup);
    check(
      npmCallCount === npmAfterAll && scoopCallCount === scoopAfterAll,
      "切回全部不重搜（命中缓存）",
    );
  } finally {
    setup.renderer.destroy();
  }
});
