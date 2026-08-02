/**
 * PackageTable 自动列宽 + 横向滚动回归测试。
 *
 * 运行：bun test
 */
import { ScrollBoxRenderable } from "@opentui/core";
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { PackageTable, type TableColumn } from "../src/components/PackageTable";
import { dispWidthStr } from "../src/width";

interface Row {
  key: string;
  name: string;
  desc: string;
}

const LONG_NAME = "A very very long package name"; // 27 列
const LONG_DESC = "A very long description text that goes on for quite a while"; // 58 列

const rows: Row[] = [
  { key: "1", name: LONG_NAME, desc: LONG_DESC },
  { key: "2", name: "short", desc: "-" },
];

const columns: TableColumn<Row>[] = [
  { key: "name", label: "Name", width: 30, render: (r) => r.name },
  { key: "desc", label: "Description", width: 40, render: (r) => r.desc },
];

function findScrollBox(node: { getChildren: () => unknown[] }): ScrollBoxRenderable | null {
  if (node instanceof ScrollBoxRenderable) return node;
  for (const child of node.getChildren()) {
    const found = findScrollBox(child as { getChildren: () => unknown[] });
    if (found) return found;
  }
  return null;
}

/** 在字符帧里找滚动条所在行（该行含 █ 滑块字符），返回 {y, xStart, xEnd}。 */
function findScrollbarRow(frame: string, barY: number): { xStart: number; xEnd: number } | null {
  const lines = frame.split("\n");
  const line = lines[barY];
  if (!line || !line.includes("█")) return null;
  let xStart = -1;
  let xEnd = -1;
  for (let x = 0; x < line.length; x++) {
    if (line[x] === "█") {
      if (xStart < 0) xStart = x;
      xEnd = x;
    }
  }
  return xStart >= 0 ? { xStart, xEnd } : null;
}

test("表格自动列宽 + 横向滚动", async () => {
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
    console.log("  ✓", message);
  };

  const scrollMoves: number[] = [];
  const setup = await testRender(
    <PackageTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      cursor={0}
      visibleRows={3}
      autoFitWidths
      scrollX
      onScrollMove={(delta) => scrollMoves.push(delta)}
    />,
    { width: 40, height: 8 },
  );

  try {
    await setup.renderOnce();
    const scrollbox = findScrollBox(setup.renderer.root);
    check(scrollbox !== null, "存在 ScrollBox 容器");

    if (scrollbox) {
      // 自动列宽 = 内容显示宽度 + 2 边距，但不超过默认上限 60（desc 列 59+2=61 被钳到 60）；
      // 两列之间还有默认 columnGap=2
      const nameW = dispWidthStr(LONG_NAME) + 2;
      const descW = Math.min(60, dispWidthStr(LONG_DESC) + 2);
      const expectWidth = nameW + descW + 2;
      check(
        scrollbox.scrollWidth === expectWidth,
        `自动列宽 = 内容宽度 + 边距 + 列间隔并受上限约束（期望 ${expectWidth}，实际 ${scrollbox.scrollWidth}）`,
      );
      check(scrollbox.scrollWidth > scrollbox.viewport.width, "内容超出视口宽度");
      check(scrollbox.horizontalScrollBar.visible === true, "内容溢出时横向滚动条可见");
      check(scrollbox.verticalScrollBar.visible === false, "纵向滚动条保持隐藏");

      // 横向滚轮（右）滚动：scrollLeft 增加
      await act(async () => {
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.renderOnce();
      });
      const afterWheel = scrollbox.scrollLeft;
      check(afterWheel > 0, `横向滚轮滚动生效（scrollLeft=${afterWheel}）`);

      await act(async () => {
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.renderOnce();
      });
      check(scrollbox.scrollLeft > afterWheel, "连续横向滚轮继续滚动");

      // 普通滚轮（纵向）移动光标行（每档 VSCROLL_STEP=3 行，加快滚动）
      await act(async () => {
        await setup.mockMouse.scroll(20, 2, "down");
        await setup.renderOnce();
      });
      check(scrollMoves.includes(3), "纵向滚轮每档触发 onScrollMove 移动 3 行");

      // 横向滚动条滑块拖动
      const frame = setup.captureCharFrame();
      const barRow = frame.split("\n").findIndex((l) => l.includes("█"));
      const bar = barRow >= 0 ? findScrollbarRow(frame, barRow) : null;
      check(bar !== null, "滚动条滑块渲染在底部一行");
      if (bar) {
        // 轨道背景设为 transparent，滑块两侧应为空白（而非实心灰条），让滚动条显得更细
        const barLine = frame.split("\n")[barRow];
        const leftTrack = barLine.slice(0, bar.xStart);
        const rightTrack = barLine.slice(bar.xEnd + 1);
        check(
          leftTrack.trim() === "" && rightTrack.trim() === "",
          "滚动条轨道透明（滑块两侧空白，无实心灰色条）",
        );
        const startLeft = scrollbox.scrollLeft;
        const dragTo = Math.max(bar.xEnd + 2, bar.xStart + 5);
        await act(async () => {
          await setup.mockMouse.drag(
            Math.round((bar.xStart + bar.xEnd) / 2),
            barRow,
            dragTo,
            barRow,
          );
          await setup.renderOnce();
        });
        check(
          scrollbox.scrollLeft > startLeft,
          `拖动滑块横向滚动生效（${startLeft} → ${scrollbox.scrollLeft}）`,
        );
      }

      // 拖到最右后 clamp 到边界
      await act(async () => {
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.mockMouse.scroll(20, 2, "right");
        await setup.renderOnce();
      });
      check(
        scrollbox.scrollLeft === scrollbox.scrollWidth - scrollbox.viewport.width,
        `滚动位置被夹到右边界（scrollLeft=${scrollbox.scrollLeft}）`,
      );
    }
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }

  // 内容不溢出时不显示滚动条
  const shortRows: Row[] = [{ key: "1", name: "a", desc: "b" }];
  const shortSetup = await testRender(
    <PackageTable
      columns={columns}
      rows={shortRows}
      rowKey={(r) => r.key}
      cursor={0}
      visibleRows={3}
      autoFitWidths
      scrollX
    />,
    { width: 40, height: 8 },
  );
  try {
    await shortSetup.renderOnce();
    const shortBox = findScrollBox(shortSetup.renderer.root);
    check(shortBox !== null, "短内容场景存在 ScrollBox");
    if (shortBox) {
      check(
        shortBox.horizontalScrollBar.visible === false,
        `内容未溢出时横向滚动条隐藏（scrollWidth=${shortBox.scrollWidth} ≤ viewport=${shortBox.viewport.width}）`,
      );
    }
  } finally {
    await act(async () => {
      shortSetup.renderer.destroy();
    });
  }
});
