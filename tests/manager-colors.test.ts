/**
 * 管理器专属颜色（manager-colors.ts）回归测试。
 *
 * 表格"管理器"列的着色依赖这张表：新增管理器后端若忘了配色，"管理器"列会
 * 退化成默认前景色，与其他行混在一起。这里守住两条不变量：
 *  - 每个已注册管理器都有颜色，且颜色互不相同（防止复制粘贴重复）；
 *  - 未收录的管理器返回 undefined（调用方回退默认前景色，不能抛错）。
 *
 * 运行：bun test
 */
import { test } from "bun:test";
import { listManagers } from "../src/managers";
import { managerColor } from "../src/manager-colors";

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
}

test("每个已注册管理器都有专属颜色", () => {
  const names = Object.keys(listManagers());
  check(names.length >= 8, `已注册管理器数 >= 8（实际 ${names.length}）`);
  for (const name of names) {
    check(typeof managerColor(name) === "string", `${name} 有颜色`);
  }
});

test("管理器颜色互不相同", () => {
  const used = new Map<string, string>();
  for (const name of Object.keys(listManagers())) {
    const color = managerColor(name)!;
    const dup = used.get(color);
    check(dup === undefined, `${name} 的颜色 ${color} 未与 ${dup ?? "-"} 重复`);
    used.set(color, name);
  }
});

test("未知/空管理器返回 undefined（回退默认前景色）", () => {
  check(managerColor("nope") === undefined, "未知管理器无颜色");
  check(managerColor("") === undefined, "空字符串无颜色");
  check(managerColor(null) === undefined, "null 无颜色");
  check(managerColor(undefined) === undefined, "undefined 无颜色");
});
