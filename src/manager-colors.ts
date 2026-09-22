/**
 * 包管理器专属前景色。
 *
 * 表格出现"管理器"列时（主页"全部"视图 / 合并显示的代表视图 / 搜索"全部"范围），
 * 管理器的名字按此表着色，便于用户一眼区分包的来源。
 *
 * 约定：
 *  - 键是管理器 name（不是显示名——显示名可被 config.json 的 manager_names 自定义，
 *    颜色跟随真实 name，改显示名不影响配色）；
 *  - 色相沿环均匀分布，取品牌色的提亮变体，保证深色终端上可读、彼此可区分，
 *    且在光标行深蓝底（#264f78）上仍清晰；
 *  - 未收录的管理器（用户自行扩展）返回 undefined，由调用方回退表格默认前景色。
 */

const MANAGER_COLORS: Record<string, string> = {
  npm: "#ff6b6b", // 红（npm 品牌红提亮）
  pnpm: "#f9c74f", // 橙黄（pnpm 品牌色）
  bun: "#ff9ecd", // 粉（奶油色品牌在深色终端上无区分度，取高区分粉色）
  winget: "#4dabf7", // 蓝（Windows 蓝提亮）
  scoop: "#4ec9b0", // 青（品牌蓝灰偏青）
  cargo: "#f0883e", // 橙（Rust 橙）
  choco: "#c678dd", // 紫（巧克力棕在深色终端上不可读，取紫）
  uv: "#7ee787", // 绿（品牌紫与 choco 冲突，取绿）
};

/** 管理器 name -> 颜色；未知管理器返回 undefined（用默认前景色）。 */
export function managerColor(name: string | null | undefined): string | undefined {
  return name ? MANAGER_COLORS[name] : undefined;
}
