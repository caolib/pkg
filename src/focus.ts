/**
 * 焦点判定工具。
 *
 * OpenTUI 的**真实焦点**由渲染器持有（`renderer.currentFocusedRenderable`），
 * 鼠标点击输入框会直接改变它，而组件自己的 `filterMode`/`focusOnTable` 之类
 * 的 state 不会跟着变。若全局 `useKeyboard` 只信任本地 state 判断"是否正在
 * 输入文本"，就会出现字符键**既进输入框又被当成快捷键执行**的 bug
 * （例：在顶栏过滤框里点一下再输入 "opencode"，其中的 d 触发了卸载）。
 *
 * 因此所有全局键盘分发一律用本函数判断是否有文本输入正在接收按键。
 */

import { InputRenderable, TextareaRenderable, type CliRenderer } from "@opentui/core"

/** 当前渲染器焦点是否落在文本输入类组件（input / textarea）上。 */
export function isTextInputFocused(renderer: CliRenderer): boolean {
  const focused = renderer.currentFocusedRenderable
  return focused instanceof InputRenderable || focused instanceof TextareaRenderable
}
