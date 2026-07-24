import type { ScreenSurface as ScreenBuffer } from "../../screen/screen.js";
import type { CellStyle } from "../../dashboard/types.js";
import type { Rect } from "../layout.js";
import { fitToWidth, padEndCells } from "./text.js";

export function drawPaneFrame(
  screen: ScreenBuffer,
  rect: Rect,
  title: string,
  style: CellStyle = {},
  options: { focused?: boolean; indicator?: string } = {}
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
  const horizontal = options.focused ? "━" : "─";
  const indicator = options.indicator === undefined ? "" : ` ${options.indicator} `;
  const availableTitle = Math.max(0, innerWidth - indicator.length);
  const titleSegment = padEndCells(
    `${fitToWidth(`${horizontal} ${title} `, availableTitle, rect.x + 1)}${horizontal.repeat(Math.max(0, availableTitle - fitToWidth(`${horizontal} ${title} `, availableTitle, rect.x + 1).length))}${indicator}`,
    innerWidth,
    horizontal,
    rect.x + 1
  );
  screen.put(rect.x, rect.y, `${options.focused ? "┏" : "┌"}${titleSegment}${options.focused ? "┓" : "┐"}`, style);

  for (let y = 1; y < rect.height - 1; y += 1) {
    screen.put(rect.x, rect.y + y, options.focused ? "┃" : "│", style);
    screen.put(rect.x + rect.width - 1, rect.y + y, options.focused ? "┃" : "│", style);
  }

  if (rect.height > 1) {
    screen.put(rect.x, rect.y + rect.height - 1, `${options.focused ? "┗" : "└"}${horizontal.repeat(innerWidth)}${options.focused ? "┛" : "┘"}`, style);
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
