/** 主界面同名包的来源归属与勾选清空。后端和配置持久化全部模拟，不碰本机包。 */
import { expect, spyOn, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../src/App";
import { ManagerRegistry } from "../src/runtime";
import { currentLanguage, setLanguage, t } from "../src/i18n";

async function withApp(run: (ui: Awaited<ReturnType<typeof createUI>>) => Promise<void>) {
  const language = currentLanguage();
  let reg!: ManagerRegistry;
  const calls: string[] = [];
  const load = spyOn(ManagerRegistry.prototype, "loadPersisted").mockImplementation(async function (
    this: ManagerRegistry,
  ) {
    reg = this;
    this.mergeNpmManagers = true;
    this.keybindings.open_settings = "z";
    for (const st of this.states.values()) {
      st.available = ["npm", "pnpm", "bun"].includes(st.name);
      st.checked = true;
      st.version = "1.0.0";
      const packages = st.available
        ? [
            {
              name: "opencode",
              version: st.name === "npm" ? "2.2.5" : "2.2.4",
            },
            ...(st.name === "npm" ? [{ name: "other", version: "1.0.0" }] : []),
          ]
        : [];
      st.instance.listInstalled = async () => packages;
      st.instance.listOutdated = async () => {
        calls.push(`${st.name}:outdated`);
        return st.name === "bun" ? [{ ...packages[0], latest_version: "2.2.5" }] : [];
      };
      st.instance.view = async (name) => {
        calls.push(`${st.name}:view:${name}`);
        return { name, latest_version: "2.2.5", description: `${st.name} detail` };
      };
      st.instance.updateCommand = (names) => `${st.name}:update ${names.join(" ")}`;
      st.instance.uninstallCommand = (names) => `${st.name}:uninstall ${names.join(" ")}`;
      st.instance.updateAll = async (names) =>
        names.map((name) => {
          calls.push(`${st.name}:update:${name}`);
          return { success: true, package: name };
        });
      st.instance.uninstall = async (name) => {
        calls.push(`${st.name}:uninstall:${name}`);
        return { success: true, package: name };
      };
    }
    return "zh_CN";
  });
  const ensure = spyOn(ManagerRegistry.prototype, "ensureConfig").mockResolvedValue(undefined);
  const persist = spyOn(ManagerRegistry.prototype, "persist").mockResolvedValue(undefined);
  const availability = spyOn(ManagerRegistry.prototype, "checkAvailability").mockResolvedValue(
    undefined,
  );
  let ui: Awaited<ReturnType<typeof createUI>> | undefined;
  try {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<App />, { width: 110, height: 30 });
    });
    ui = createUI(setup, () => reg, calls);
    await ui.pump();
    expect(ui.frame()).toContain("opencode");
    await run(ui);
  } finally {
    if (ui) await act(async () => ui!.setup.renderer.destroy());
    load.mockRestore();
    ensure.mockRestore();
    persist.mockRestore();
    availability.mockRestore();
    setLanguage(language);
  }
}

function createUI(
  setup: Awaited<ReturnType<typeof testRender>>,
  getReg: () => ManagerRegistry,
  calls: string[],
) {
  const pump = async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await setup.renderOnce();
    }
  };
  const press = async (key: string) => {
    await act(async () => {
      setup.mockInput.pressKey(key);
    });
    await pump();
  };
  const arrow = async (dir: "left" | "right" | "up" | "down") => {
    await act(async () => setup.mockInput.pressArrow(dir));
    await pump();
  };
  const pressEscape = async () => {
    await act(async () => {
      setup.mockInput.pressEscape();
      await new Promise((r) => setTimeout(r, 200));
    });
    await pump();
  };
  const frame = () => setup.captureCharFrame();
  const checked = () =>
    frame()
      .split("\n")
      .filter((line) => line.includes("✓") && line.includes("opencode"));
  return { setup, getReg, calls, pump, press, arrow, pressEscape, frame, checked };
}

for (const representative of [false, true]) {
  test(`安装记录：${representative ? "npm 合并" : "全部"}视图的详情/单行/批量操作各归本源`, async () => {
    await withApp(async (ui) => {
      if (representative) await ui.arrow("right");
      // 全部为 bun/npm/other/pnpm；代表视图为 npm/other/bun/pnpm。
      const order = representative ? ["npm", "bun", "pnpm"] : ["bun", "npm", "pnpm"];
      for (let i = 0; i < order.length; i++) {
        const source = order[i];
        await ui.press("\r");
        expect(ui.calls.at(-1)).toBe(`${source}:view:opencode`);
        expect(ui.frame()).toContain(`${source} detail`);
        await ui.pressEscape();
        for (const [key, action] of [
          ["u", "update"],
          ["d", "uninstall"],
        ]) {
          await ui.press(key);
          expect(ui.frame()).toContain(`${source}:${action} opencode`);
          for (const other of order.filter((s) => s !== source)) {
            expect(ui.frame()).not.toContain(` ${other}:${action} opencode`);
          }
          expect(ui.calls.some((c) => c.includes(`:${action}:`))).toBe(false);
          await ui.pressEscape();
        }
        if (i < order.length - 1) {
          await ui.arrow("down");
          if (source === "npm") await ui.arrow("down"); // 跳过 other
        }
      }
      const selectAllSources = async () => {
        for (let i = 0; i < order.length; i++) {
          await ui.press(" ");
          expect(ui.checked()).toHaveLength(i + 1);
          if (i < order.length - 1) {
            await ui.arrow("down");
            if (order[i] === "npm") await ui.arrow("down");
          }
        }
      };
      for (let i = 0; i < 3; i++) await ui.arrow("up");
      await selectAllSources();
      await ui.press("u");
      for (const source of order) expect(ui.frame()).toContain(`${source}:update opencode`);
      await ui.press("\r");
      expect(ui.calls.filter((c) => c.includes(":update:"))).toEqual(
        order.map((s) => `${s}:update:opencode`),
      );
      expect(ui.checked()).toHaveLength(0);

      // 更新后光标重置到首行；再勾选三源，检查卸载确认与实际模拟调用。
      await selectAllSources();
      await ui.press("d");
      for (const source of order) expect(ui.frame()).toContain(`${source}:uninstall opencode`);
      expect(ui.calls.some((c) => c.includes(":uninstall:"))).toBe(false);
      await ui.press("\r");
      expect(ui.calls.filter((c) => c.includes(":uninstall:"))).toEqual(
        order.map((s) => `${s}:uninstall:opencode`),
      );
      expect(ui.checked()).toHaveLength(0);
    });
  }, 20000);
}

test("勾选：切换管理器/更新过滤/文本过滤均清空，隐藏记录不参与操作", async () => {
  await withApp(async (ui) => {
    await ui.press(" ");
    expect(ui.checked()).toHaveLength(1);
    await ui.arrow("right");
    expect(ui.checked()).toHaveLength(0);
    await ui.arrow("left");
    expect(ui.checked()).toHaveLength(0);

    await ui.arrow("down"); // npm，无可用更新
    await ui.press(" ");
    expect(ui.checked()).toHaveLength(1);
    await ui.press("f");
    expect(ui.checked()).toHaveLength(0);
    await ui.press("u");
    expect(ui.frame()).toContain("bun:update opencode");
    expect(ui.frame()).not.toContain("npm:update opencode");
    await ui.pressEscape();
    await ui.press(" ");
    expect(ui.checked()).toHaveLength(1);
    await ui.press("f");
    expect(ui.checked()).toHaveLength(0);

    await ui.press(" ");
    await ui.press("/");
    for (const ch of "other") await ui.press(ch);
    await ui.pressEscape();
    expect(ui.checked()).toHaveLength(0);
    await ui.press("d");
    expect(ui.frame()).toContain("npm:uninstall other");
    expect(ui.frame()).not.toContain("uninstall opencode");
    expect(ui.calls.some((c) => c.includes(":uninstall:"))).toBe(false);
    await ui.pressEscape();
  });
}, 15000);

test("勾选：无改动关闭设置保留选择，切换合并开关清空且不重查更新", async () => {
  await withApp(async (ui) => {
    await ui.press(" ");
    expect(ui.checked()).toHaveLength(1);
    const countQueries = () => ui.calls.filter((c) => c.endsWith(":outdated")).length;
    const before = countQueries();
    await ui.press("z");
    await ui.pressEscape();
    expect(ui.checked()).toHaveLength(1);
    expect(countQueries()).toBe(before);

    for (const merge of [false, true]) {
      await ui.press("z");
      await ui.arrow("up"); // 设置列表循环到最后一项：合并 npm 系
      expect(ui.frame()).toContain(t("settings.merge_npm"));
      await ui.press("\r");
      expect(ui.getReg().mergeNpmManagers).toBe(merge);
      await ui.pressEscape();
      expect(ui.checked()).toHaveLength(0);
      expect(countQueries()).toBe(before);
      await ui.press(" ");
      expect(ui.checked()).toHaveLength(1);
    }
  });
}, 15000);
