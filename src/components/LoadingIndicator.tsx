/**
 * 全局统一加载状态指示器。
 *
 * 视觉：一行方块字符，一个"高亮头"从左往右单方向扫描（到右端后从左端重新开始），
 * 身后拖一条透明度指数衰减的"尾巴"，整体颜色从一个基色派生。动画用 setInterval
 * 推进帧号 + React state 触发重绘；卸载时清掉计时器。
 *
 * 参考了 opencode 的 spinner 思路（frames + 按距离做 alpha 衰减），但改为单向扫描
 * （opencode 是来回双向 + hold）。OpenTUI 无内置 spinner，这里用富文本 <span> 的
 * 逐字符 fg 着色实现。
 *
 * 用法：<LoadingIndicator />（默认基色绿、宽 8 格）；<LoadingIndicator color="#3d7fc9" width={10} label="加载中..." />
 */

import { useEffect, useState, type ReactNode } from "react";

export interface LoadingIndicatorProps {
  /** 动画基色（十六进制或 CSS 颜色名），默认绿色 */
  color?: string;
  /** 扫描条格子数，默认 8 */
  width?: number;
  /** 动画帧间隔（毫秒），默认 70 */
  interval?: number;
  /** 尾部要显示的文本（已翻译），不传则只显示动画 */
  label?: string;
}

/** 单方向扫描的格子数 = width（一个周期）。 */
const TRAIL = 4;

/** 按距离算单格颜色：头部最亮，尾部指数衰减，远处暗淡底色。 */
function cellColor(baseHex: string, dist: number): string {
  if (dist === 0) return baseHex; // 头部，全亮
  if (dist < TRAIL) {
    // 尾部：alpha 指数衰减（0.6, 0.36, 0.21...）。用十六进制近似透明度
    // OpenTUI 的 fg 接受 #RRGGBB；要 alpha 需用 RGBA。这里直接调暗 RGB 模拟衰减。
    return dimHex(baseHex, Math.pow(0.5, dist));
  }
  return dimHex(baseHex, 0.18); // 暗淡底色
}

/** 把 hex 颜色按 factor 调暗（模拟 alpha 衰减，避免依赖 RGBA 透明合成）。 */
function dimHex(hex: string, factor: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function LoadingIndicator(props: LoadingIndicatorProps): ReactNode {
  const { color = "#3d7fc9", width = 8, interval = 70, label } = props;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % width), interval);
    return () => clearInterval(id);
  }, [width, interval]);

  // 每格：算离当前头部位置的距离（单向，头部就是 frame，距头部越远越暗）
  const cells: ReactNode[] = [];
  for (let i = 0; i < width; i++) {
    const dist = Math.abs(i - frame);
    const isHead = dist === 0;
    const ch = isHead ? "■" : "■"; // 全用方块；亮暗由颜色体现
    cells.push(
      <span key={i} fg={cellColor(color, dist)}>
        {ch}
      </span>,
    );
  }

  return (
    <box flexDirection="row" alignItems="center" columnGap={1}>
      <text>{cells}</text>
      {label ? <text fg="#888">{label}</text> : null}
    </box>
  );
}
