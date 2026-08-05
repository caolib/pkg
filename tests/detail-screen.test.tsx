/**
 * 包详情界面（DetailScreen）按钮回归测试。
 *
 * 搜索来源（managerName=null）：按钮 [安装, 安装版本, 关闭]，"安装"默认聚焦，
 * Enter 直接安装最新版；→ 到"安装版本"Enter 打开版本选择器。
 * 已安装来源：按钮 [更新, 删除, 安装版本, 关闭]，"更新"默认聚焦。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { DetailScreen } from "../src/screens/DetailScreen";

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

/** view 拉取的后台数据（字段只需满足渲染不炸） */
const fakeManager = {
  view: async () => ({
    name: "foo",
    display_name: "foo",
    latest_version: "1.2.3",
    description: "demo package",
    versions: ["1.2.3", "1.2.2"],
  }),
};

function makeProps(overrides: Record<string, unknown>) {
  return {
    manager: fakeManager as any,
    name: "foo",
    managerName: null,
    title: "foo",
    onClose: () => {},
    onUpdate: () => {},
    onUninstall: () => {},
    onInstall: () => {},
    onInstallVersion: () => {},
    onToast: () => {},
    ...overrides,
  } as any;
}

test("详情界面（搜索来源）：安装按钮默认聚焦，Enter 装最新版", async () => {
  let installed = 0;
  const setup = await testRender(
    <DetailScreen {...makeProps({ onInstall: () => installed++ })} />,
    { width: 100, height: 30 },
  );
  try {
    await pump(setup);
    const f = setup.captureCharFrame();
    check(
      f.includes("安装版本") || f.includes("Install Version"),
      "显示安装版本按钮",
    );

    // 默认聚焦"安装"：Enter 直接触发安装最新版
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);
    check(installed === 1, "Enter 默认触发安装（最新版）");

    // → 移到"安装版本"，Enter 打开版本选择器
    await act(async () => {
      setup.mockInput.pressArrow("right");
    });
    await pump(setup);
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);
    check(
      setup.captureCharFrame().includes("选择版本") ||
        setup.captureCharFrame().includes("Select Version"),
      "→ 到安装版本，Enter 打开版本选择器",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("详情界面（已安装来源）：更新按钮默认聚焦", async () => {
  let updated = 0;
  const setup = await testRender(
    <DetailScreen {...makeProps({ managerName: "npm", onUpdate: () => updated++ })} />,
    { width: 100, height: 30 },
  );
  try {
    await pump(setup);
    check(
      setup.captureCharFrame().includes("更新") || setup.captureCharFrame().includes("Update"),
      "显示更新按钮",
    );
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await pump(setup);
    check(updated === 1, "Enter 默认触发更新");
  } finally {
    setup.renderer.destroy();
  }
});
