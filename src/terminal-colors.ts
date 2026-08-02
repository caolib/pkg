/**
 * 终端背景色。
 *
 * 主页根容器不设背景（透明，露出终端配色），因此"跟随主页"的 overlay 背景
 * 应取终端检测到的默认背景色，而不是写死颜色。检测失败/终端不支持时回退
 * 应用表面色 #1d1d26（同 toast）。
 */

import type { CliRenderer } from "@opentui/core";

/** 回退背景色：应用表面色（同 toast）。 */
export const FALLBACK_BACKGROUND = "#1d1d26";

let cached: string | null = null;

/** 同步读取已缓存的终端背景色；未检测过返回 null。供 overlay 在初始化时
 *  避免先用 FALLBACK_BACKGROUND 渲染一帧再切换（主页已触发检测时此值已就绪）。 */
export function getTerminalBackgroundSync(): string | null {
  return cached;
}

/** 取终端默认背景色（主页透明时露出的颜色），结果缓存。 */
export async function getTerminalBackground(renderer: CliRenderer): Promise<string> {
  if (cached) return cached;
  try {
    const colors = await renderer.getPalette({ size: 16 });
    cached = colors.defaultBackground ?? FALLBACK_BACKGROUND;
  } catch {
    cached = FALLBACK_BACKGROUND;
  }
  return cached;
}
