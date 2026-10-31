/** 底栏窄屏只裁切右端，不分别压缩各快捷键；后端与配置均模拟。 */
import { expect, spyOn, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../src/App";
import { currentLanguage, setLanguage, t } from "../src/i18n";
import { opLog } from "../src/ops";
import { ManagerRegistry } from "../src/runtime";
import { dispWidthStr } from "../src/width";

for (const language of ["zh_CN", "en_US"]) {
  test(`底栏：${language} 窄屏保留左侧说明，任务状态不被挤掉，扩宽恢复`, async () => {
    const originalLanguage = currentLanguage();
    const load = spyOn(ManagerRegistry.prototype, "loadPersisted").mockImplementation(async function (
      this: ManagerRegistry,
    ) {
      this.keybindings = {};
      for (const st of this.states.values()) {
        st.available = false;
        st.checked = true;
      }
      return language;
    });
    const ensure = spyOn(ManagerRegistry.prototype, "ensureConfig").mockResolvedValue(undefined);
    const availability = spyOn(ManagerRegistry.prototype, "checkAvailability").mockResolvedValue(
      undefined,
    );
    opLog.clear();
    let setup: Awaited<ReturnType<typeof testRender>> | undefined;
    try {
      await act(async () => {
        setup = await testRender(<App />, { width: 80, height: 24 });
      });
      const ui = setup!;
      const pump = async () => {
        for (let i = 0; i < 10; i++) {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          await ui.renderOnce();
        }
      };
      const footer = () => ui.captureCharFrame().split("\n")[23].trim();
      const hints = [
        `alt+s ${t("binding.settings")}`,
        `s ${t("binding.search")}`,
        `o ${t("binding.output")}`,
        `r ${t("binding.refresh")}`,
        `c ${t("binding.check_updates")}`,
        `u ${t("binding.update")}`,
        `d ${t("binding.uninstall")}`,
        `space ${t("binding.toggle")}`,
        `f ${t("binding.filter")}`,
        "/ 搜索",
      ];
      await pump();
      /** 按整项裁切后应显示的提示（只保留完整放得下的项）。 */
      const expectedHints = (budget: number) => {
        let out = "";
        let used = 0;
        for (let i = 0; i < hints.length; i++) {
          const piece = i === 0 ? hints[i] : `   ${hints[i]}`;
          const w = dispWidthStr(piece);
          if (used + w > budget) break;
          out += piece;
          used += w;
        }
        return out;
      };
      /** 底栏 = 完整提示项 + 可选任务状态（不在某项中间截断）。 */
      const checkCut = (statusLabel: string | null, termWidth: number) => {
        const statusText = statusLabel ? `⠋ ${statusLabel}` : null;
        const budget = termWidth - 2 - (statusText ? dispWidthStr(statusText) + 1 : 0);
        const line = footer();
        const prefix = statusLabel ? line.slice(0, line.length - statusLabel.length - 2) : line;
        expect(prefix.trimEnd()).toBe(expectedHints(budget));
        if (statusLabel) expect(line.endsWith(statusLabel)).toBe(true);
      };

      checkCut(null, 80);
      expect(footer()).not.toContain(hints[8]);

      let entry!: ReturnType<typeof opLog.begin>;
      await act(async () => {
        entry = opLog.begin("mock task");
      });
      await pump();
      checkCut(t("task.running_1"), 80);

      await act(async () => opLog.fail(entry, "mock failure"));
      await pump();
      checkCut(t("task.failed"), 80);
      const outputSpan = ui.captureSpans().lines[23].spans.find((span) =>
        span.text.includes(hints[2]),
      );
      expect(outputSpan?.fg.toInts().slice(0, 3)).toEqual([221, 221, 221]);

      await act(async () => ui.resize(200, 24));
      await pump();
      checkCut(t("task.failed"), 200);
      expect(footer()).toContain(hints[8]);

      await act(async () => ui.resize(80, 24));
      await pump();
      checkCut(t("task.failed"), 80);
    } finally {
      if (setup) await act(async () => setup!.renderer.destroy());
      opLog.clear();
      load.mockRestore();
      ensure.mockRestore();
      availability.mockRestore();
      setLanguage(originalLanguage);
    }
  });
}
