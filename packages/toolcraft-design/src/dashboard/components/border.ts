import { ScreenBuffer } from "../buffer.js";
import type { DashboardLayout } from "../layout.js";
import type { CellStyle } from "../types.js";

export type BorderOptions = {
  leftTitle?: string;
  rightTitle?: string;
  style: CellStyle;
};

export function renderBorder(
  buffer: ScreenBuffer,
  layout: DashboardLayout,
  opts: BorderOptions
): void {
  const outer = layout.outerBorder;
  if (outer.width <= 0 || outer.height <= 0) {
    return;
  }

  const left = outer.x;
  const top = outer.y;
  const right = outer.x + outer.width - 1;
  const bottom = outer.y + outer.height - 1;

  renderTopBorder(buffer, left, top, right, layout, opts);
  renderSideBorders(buffer, left, right, top, bottom, opts.style);
  renderBottomBorder(buffer, left, top, right, bottom, layout, opts.style);
  renderVerticalDivider(buffer, layout, opts.style);
  renderFooterDivider(buffer, left, right, bottom, layout, opts.style);
}

function renderTopBorder(
  buffer: ScreenBuffer,
  left: number,
  top: number,
  right: number,
  layout: DashboardLayout,
  opts: BorderOptions
): void {
  if (left === right) {
    buffer.put(left, top, "┌", opts.style);
    return;
  }

  const hasTopJunction = hasInteriorRows(top, layout.outerBorder.y + layout.outerBorder.height - 1)
    && hasPaneDivider(layout, left, right)
    && layout.divider.top <= top + 1
    && layout.divider.bottom >= top + 1;

  if (!hasTopJunction) {
    buffer.put(left, top, `┌${renderTopSegment(right - left - 1, opts.leftTitle)}┐`, opts.style);
    return;
  }

  const leftWidth = layout.divider.x - left - 1;
  const rightWidth = right - layout.divider.x - 1;
  const row = [
    "┌",
    renderTopSegment(leftWidth, opts.leftTitle),
    "┬",
    renderTopSegment(rightWidth, opts.rightTitle),
    "┐"
  ].join("");

  buffer.put(left, top, row, opts.style);
}

function renderSideBorders(
  buffer: ScreenBuffer,
  left: number,
  right: number,
  top: number,
  bottom: number,
  style: CellStyle
): void {
  for (let y = top + 1; y < bottom; y += 1) {
    buffer.put(left, y, "│", style);
    buffer.put(right, y, "│", style);
  }
}

function renderBottomBorder(
  buffer: ScreenBuffer,
  left: number,
  top: number,
  right: number,
  bottom: number,
  layout: DashboardLayout,
  style: CellStyle
): void {
  if (bottom <= top) {
    return;
  }

  if (left === right) {
    buffer.put(left, bottom, "└", style);
    return;
  }

  buffer.put(left, bottom, "└", style);
  buffer.put(left + 1, bottom, "─".repeat(Math.max(0, right - left - 1)), style);
  buffer.put(right, bottom, "┘", style);

  if (
    hasInteriorRows(top, bottom)
    && hasPaneDivider(layout, left, right)
    && layout.divider.top <= bottom - 1
    && layout.divider.bottom >= bottom - 1
  ) {
    buffer.put(layout.divider.x, bottom, "┴", style);
  }
}

function renderVerticalDivider(
  buffer: ScreenBuffer,
  layout: DashboardLayout,
  style: CellStyle
): void {
  const left = layout.outerBorder.x;
  const right = layout.outerBorder.x + layout.outerBorder.width - 1;
  if (!hasPaneDivider(layout, left, right)) {
    return;
  }

  const startY = Math.max(layout.divider.top, layout.outerBorder.y + 1);
  const endY = Math.min(
    layout.divider.bottom,
    layout.outerBorder.y + layout.outerBorder.height - 2
  );

  for (let y = startY; y <= endY; y += 1) {
    buffer.put(layout.divider.x, y, "│", style);
  }
}

function renderFooterDivider(
  buffer: ScreenBuffer,
  left: number,
  right: number,
  bottom: number,
  layout: DashboardLayout,
  style: CellStyle
): void {
  const y = layout.footerDivider.y;
  if (y <= layout.outerBorder.y || y >= bottom) {
    return;
  }

  const width = layout.footerDivider.right - layout.footerDivider.left + 1;
  if (width > 0) {
    buffer.put(layout.footerDivider.left, y, "─".repeat(width), style);
  }

  buffer.put(left, y, "├", style);
  buffer.put(right, y, "┤", style);

  if (
    !hasPaneDivider(layout, left, right)
    || layout.divider.x < layout.footerDivider.left
    || layout.divider.x > layout.footerDivider.right
  ) {
    return;
  }

  const connectsAbove = layout.divider.bottom >= y - 1 && layout.divider.top <= y;
  const connectsBelow = layout.divider.bottom > y;

  if (connectsAbove && connectsBelow) {
    buffer.put(layout.divider.x, y, "┼", style);
    return;
  }

  if (connectsAbove) {
    buffer.put(layout.divider.x, y, "┴", style);
  }
}

function renderTopSegment(width: number, title?: string): string {
  if (width <= 0) {
    return "";
  }

  if (!title) {
    return "─".repeat(width);
  }

  const content = `─ ${title} `;
  if (content.length >= width) {
    return content.slice(0, width);
  }

  return `${content}${"─".repeat(width - content.length)}`;
}

function hasInteriorRows(top: number, bottom: number): boolean {
  return (bottom - top) > 1;
}

function hasPaneDivider(layout: DashboardLayout, left: number, right: number): boolean {
  return layout.leftPane.width > 0
    && layout.rightPane.width > 0
    && layout.divider.x > left
    && layout.divider.x < right;
}
