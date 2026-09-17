import type { ComposerState } from "./composer.js";
import { graphemes, graphemeWidth } from "./terminal-width.js";

type ComposerLayout = { lines: string[]; starts: number[]; cursor: { x: number; y: number } };
const layouts = new WeakMap<ComposerState, { text: string; cursor: number; width: number; layout: ComposerLayout }>();

/** Shared display rows keep input navigation aligned with the rendered caret. */
export function layoutComposer(state: ComposerState, width: number): ComposerLayout {
  width = Math.max(1, width);
  const cached = layouts.get(state);
  if (cached?.text === state.text && cached.cursor === state.cursor && cached.width === width) return cached.layout;
  const lines = [""];
  const starts = [0];
  let column = 0;
  let offset = 0;
  let cursor = { x: 0, y: 0 };
  for (const segment of graphemes(state.text)) {
    const cells = segment === "\t" ? 2 : graphemeWidth(segment);
    if (segment !== "\n" && column + cells > width) { lines.push(""); starts.push(offset); column = 0; }
    if (offset === state.cursor) cursor = { x: column, y: lines.length - 1 };
    if (segment === "\n") { lines.push(""); starts.push(offset + 1); column = 0; }
    else { lines[lines.length - 1] += segment === "\t" ? "  " : segment; column += cells; }
    offset += segment.length;
  }
  if (offset === state.cursor) {
    if (column >= width) { lines.push(""); starts.push(offset); column = 0; }
    cursor = { x: column, y: lines.length - 1 };
  }
  const layout = { lines, starts, cursor };
  layouts.set(state, { text: state.text, cursor: state.cursor, width, layout });
  return layout;
}
