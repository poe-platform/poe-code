import { ScreenBuffer } from "../buffer.js";
import { plainTerminalText } from "../ansi.js";
import type { Rect } from "../types.js";
import { computeVisualLines } from "./output-pane.js";
import { truncateToWidth } from "../terminal-width.js";

/** Reserve fixed plan context while keeping room for the live output. */
export function renderContextPane(buffer: ScreenBuffer, rect: Rect, context: string[]): Rect {
  if (context.length === 0 || rect.width <= 0 || rect.height <= 1) return rect;
  const available = Math.max(1, Math.floor(rect.height / 2));
  const entries = context.map(text => computeVisualLines([{ kind: "info", text, ts: 0 }], rect.width + 3));
  const lines = entries.flat();
  const visible = lines.slice(0, available);
  if (lines.length > available) {
    const last = visible[available - 1]!;
    const text = entries[0]!.length >= available
      ? truncateToWidth(`${available === 1 ? plainTerminalText(context[0]!) : last.text}…`, rect.width)
      : truncateToWidth(`… more plans (${context.length - 1} queued)`, rect.width);
    visible[available - 1] = { ...last, text };
  }
  buffer.clearRect({ ...rect, height: visible.length });
  visible.forEach((line, row) => buffer.putInRect(rect, row, line.text, { dim: row > 0 }));
  return { ...rect, y: rect.y + visible.length, height: rect.height - visible.length };
}
