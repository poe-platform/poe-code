import { ScreenBuffer } from "../../dashboard/buffer.js";
import type { CellStyle } from "../../dashboard/types.js";
import type { Rect } from "../layout.js";
import { fitToWidth, padEndCells } from "./text.js";

export function drawPaneFrame(
  screen: ScreenBuffer,
  rect: Rect,
  title: string,
  style: CellStyle = {}
): void {
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  if (rect.width === 1) {
    for (let y = 0; y < rect.height; y += 1) {
      screen.put(rect.x, rect.y + y, "│", style);
    }
    return;
  }

  const innerWidth = Math.max(0, rect.width - 2);
  const titleSegment = padEndCells(
    fitToWidth(`─ ${title} `, innerWidth, rect.x + 1),
    innerWidth,
    "─",
    rect.x + 1
  );
  screen.put(rect.x, rect.y, `┌${titleSegment}┐`, style);

  for (let y = 1; y < rect.height - 1; y += 1) {
    screen.put(rect.x, rect.y + y, "│", style);
    screen.put(rect.x + rect.width - 1, rect.y + y, "│", style);
  }

  if (rect.height > 1) {
    screen.put(rect.x, rect.y + rect.height - 1, `└${"─".repeat(innerWidth)}┘`, style);
  }
}

export function paneBodyRect(rect: Rect): Rect {
  return {
    x: rect.x + 2,
    y: rect.y + 1,
    width: Math.max(0, rect.width - 4),
    height: Math.max(0, rect.height - 2)
  };
}
