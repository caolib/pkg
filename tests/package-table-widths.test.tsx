/**
 * PackageTable 列宽模式（fit / flex）回归测试。
 *
 * 主界面布局：版本 / 最新版本 / 管理器三列贴合内容（fit），名称列吸收整行
 * 剩余宽度（flex）——这是"列宽"的口径，从 captureCharFrame 的字符网格读不出，
 * 因此直接遍历渲染树读每个单元格 text renderable 的实际宽度。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { PackageTable, type TableColumn } from "../src/components/PackageTable";

interface Row {
  key: string;
  name: string;
  version: string;
  latest: string;
  manager: string;
}

/** 名称列长度：22 = 60 宽终端下算出的 flex 宽度（下面按此校验完整显示/截断） */
const NAME_FITS = "a".repeat(20); // 20 + 勾选前缀 2 列 = 22，刚好放满
const NAME_OVERFLOW = "b".repeat(40);

const rows: Row[] = [
  { key: "a", name: NAME_FITS, version: "1.0.0", latest: "1.0.0", manager: "npm" },
  {
    key: "b",
    name: NAME_OVERFLOW,
    version: "10.0.0-beta.12",
    latest: "11.0.0",
    manager: "winget",
  },
];

const columns: TableColumn<Row>[] = [
  { key: "name", label: "name", widthMode: "flex", width: 10, render: (r) => r.name },
  { key: "version", label: "ver", widthMode: "fit", render: (r) => r.version },
  { key: "latest", label: "latest", widthMode: "fit", render: (r) => r.latest },
  { key: "manager", label: "mgr", widthMode: "fit", render: (r) => r.manager },
];

interface TreeLike {
  getChildren: () => unknown[];
}

/** 收集渲染树里所有文本节点的（纯文本，实际布局宽度），按遍历顺序。 */
function collectTexts(node: unknown, out: { text: string; width: number }[] = []) {
  const children = (node as TreeLike).getChildren?.() ?? [];
  for (const child of children) {
    const asText = child as { plainText?: string; width?: number; getChildren?: () => unknown[] };
    if (typeof asText.plainText === "string" && typeof asText.width === "number") {
      out.push({ text: asText.plainText, width: asText.width });
    }
    collectTexts(child, out);
  }
  return out;
}

async function renderTable(width: number, height = 8) {
  const setup = await testRender(
    <PackageTable columns={columns} rows={rows} rowKey={(r) => r.key} cursor={0} visibleRows={4} />,
    { width, height },
  );
  await setup.renderOnce();
  return setup;
}

test("列宽模式：fit 列贴合内容，flex 列吸收剩余宽度", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  // 终端 60 列（无内外边距），columnGap 2：
  //   ver      = max("ver"=3, "1.0.0"=5, "10.0.0-beta.12"=14) + 2 = 16
  //   latest   = max("latest"=6, "1.0.0"=5, "11.0.0"=6) + 2 = 8
  //   mgr      = max("mgr"=3, "npm"=3, "winget"=6) + 2 = 8
  //   name     = 60 - (16 + 8 + 8) - gap 2×3 = 22
  const setup = await renderTable(60);
  try {
    const texts = collectTexts(setup.renderer.root);

    const header = texts.slice(0, 4);
    check(
      header.map((t) => t.width).join(",") === "22,16,8,8",
      `表头列宽 = flex 剩余宽度 + 各 fit 列内容宽度（实际 ${header.map((t) => t.width).join(",")}）`,
    );
    const nameCell = texts.find((t) => t.text.endsWith(NAME_FITS));
    check(nameCell?.width === 22, `名称单元格宽度 = 整行剩余宽度（${nameCell?.width}）`);
    check(
      texts.filter((t) => t.width === 16 && t.text === "10.0.0-beta.12").length === 1,
      "最长版本号决定版本列宽（按全部行测量，非只看首行）",
    );

    const frame = setup.captureCharFrame();
    for (const line of frame.split("\n").slice(0, 4)) console.log(`  |${line}|`);
    check(frame.includes(`  ${NAME_FITS}`), "填满名称列的名字完整渲染（不截断）");
    check(!frame.includes(NAME_OVERFLOW), "超长名字被名称列截断，不挤压后面的列");
    check(frame.includes("...") || frame.includes("…"), "被截断的名字带省略标记");
    check(frame.includes("10.0.0-beta.12") && frame.includes("winget"), "fit 列内容完整显示");
  } finally {
    await setup.renderer.destroy();
  }
});

test("列宽模式：flex 列在窄终端下保留最小宽度", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  // 终端 30 列：fit 列合计 16+8+8+gap 6 = 38 已超出，flex 列按最小宽度 10 处理
  const setup = await renderTable(30);
  try {
    const header = collectTexts(setup.renderer.root).slice(0, 4);
    console.log("  表头列宽：", header.map((t) => t.width).join(","));
    check(header[0]!.width === 10, "flex 列退化到最小宽度（不被压成 0 / 负数）");
    check(
      header.slice(1).map((t) => t.width).join(",") === "16,8,8",
      "fit 列宽度不受窄终端影响（超出部分靠视口裁切）",
    );
  } finally {
    await setup.renderer.destroy();
  }
});

test("列宽模式：fit 列按 maxColumnWidth 封顶（超长版本串不撑爆列）", async () => {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
    console.log("  ✓", msg);
  };

  // 主界面的版本/最新版本列用它兜住 winget 那类超长版本串（见 App.tsx 的
  // MAX_VERSION_COL_WIDTH）：不封顶时该列会撑到内容宽度、把后面的列挤出屏幕。
  const longVersion = "26.10.26174.0747211111111111";
  const capRows: Row[] = [
    { key: "a", name: "pkg", version: longVersion, latest: longVersion, manager: "npm" },
  ];
  const capColumns: TableColumn<Row>[] = [
    { key: "name", label: "name", widthMode: "flex", width: 10, render: (r) => r.name },
    { key: "version", label: "ver", widthMode: "fit", maxColumnWidth: 12, render: (r) => r.version },
  ];

  const setup = await testRender(
    <PackageTable columns={capColumns} rows={capRows} rowKey={(r) => r.key} cursor={0} visibleRows={2} />,
    { width: 40, height: 5 },
  );
  try {
    await setup.renderOnce();
    const header = collectTexts(setup.renderer.root).slice(0, 2);
    console.log("  表头列宽：", header.map((t) => t.width).join(","));
    check(header[1]!.width === 12, `超长版本号列被 maxColumnWidth 封顶（${header[1]!.width} ≤ 12）`);
    // 省下来的宽度照样归 flex 列：40 - 12 - gap 2 = 26
    check(header[0]!.width === 26, `封顶后剩余宽度归名称列（${header[0]!.width}）`);
    check(!setup.captureCharFrame().includes(longVersion), "超长版本串按列宽截断显示");
  } finally {
    await setup.renderer.destroy();
  }
});
