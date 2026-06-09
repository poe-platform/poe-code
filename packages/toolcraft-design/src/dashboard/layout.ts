import type { Rect } from "./types.js";

const DEFAULT_RIGHT_PANE_WIDTH = 25;
const DEFAULT_FOOTER_HEIGHT = 1;
const DEFAULT_BORDER_WIDTH = 1;
const MIN_LEFT_PANE_WIDTH = 20;

export type LayoutOptions = {
  totalWidth: number;
  totalHeight: number;
  rightPaneWidth?: number;
  footerHeight?: number;
  borderWidth?: number;
};

export type DashboardLayout = {
  outerBorder: Rect;
  leftPane: Rect;
  rightPane: Rect;
  divider: { x: number; top: number; bottom: number };
  footer: Rect;
  footerDivider: { y: number; left: number; right: number };
};

export function computeDashboardLayout(opts: LayoutOptions): DashboardLayout {
  const totalWidth = normalizeSize(opts.totalWidth);
  const totalHeight = normalizeSize(opts.totalHeight);
  const borderWidth = normalizeSize(opts.borderWidth ?? DEFAULT_BORDER_WIDTH);
  const footerHeight = normalizeSize(opts.footerHeight ?? DEFAULT_FOOTER_HEIGHT);
  const requestedRightPaneWidth = normalizeSize(opts.rightPaneWidth ?? DEFAULT_RIGHT_PANE_WIDTH);
  const maxX = Math.max(0, totalWidth - 1);
  const maxY = Math.max(0, totalHeight - 1);
  const outerBorder: Rect = { x: 0, y: 0, width: totalWidth, height: totalHeight };
  const innerWidth = Math.max(0, totalWidth - (borderWidth * 2));
  const innerHeight = Math.max(0, totalHeight - (borderWidth * 2));
  const innerX = clampCoordinate(borderWidth, maxX);
  const innerY = clampCoordinate(borderWidth, maxY);
  const dividerWidth = innerWidth > 0 ? 1 : 0;
  const availablePaneWidth = Math.max(0, innerWidth - dividerWidth);
  const leftPaneWidth = computeLeftPaneWidth(availablePaneWidth, requestedRightPaneWidth);
  const rightPaneWidth = Math.max(0, availablePaneWidth - leftPaneWidth);
  const actualFooterHeight = Math.min(footerHeight, innerHeight);
  const footerDividerHeight = innerHeight > actualFooterHeight ? 1 : 0;
  const contentHeight = Math.max(0, innerHeight - actualFooterHeight - footerDividerHeight);
  const leftPane: Rect = {
    x: innerX,
    y: innerY,
    width: leftPaneWidth,
    height: contentHeight
  };
  const dividerX = clampCoordinate(leftPane.x + leftPane.width, maxX);
  const rightPane: Rect = {
    x: clampCoordinate(dividerX + dividerWidth, maxX),
    y: innerY,
    width: rightPaneWidth,
    height: contentHeight
  };
  const dividerTop = innerY;
  const dividerBottom = clampCoordinate(dividerTop + Math.max(contentHeight - 1, 0), maxY);
  const footerDividerY = clampCoordinate(innerY + contentHeight, maxY);
  const footerY = clampCoordinate(footerDividerY + footerDividerHeight, maxY);
  const footerDividerLeft = innerX;
  const footerDividerRight = clampCoordinate(Math.max(innerX, totalWidth - borderWidth - 1), maxX);

  return {
    outerBorder,
    leftPane,
    rightPane,
    divider: {
      x: dividerX,
      top: dividerTop,
      bottom: dividerBottom
    },
    footer: {
      x: innerX,
      y: footerY,
      width: innerWidth,
      height: actualFooterHeight
    },
    footerDivider: {
      y: footerDividerY,
      left: footerDividerLeft,
      right: footerDividerRight
    }
  };
}

function computeLeftPaneWidth(availablePaneWidth: number, requestedRightPaneWidth: number): number {
  if (availablePaneWidth <= 0) {
    return 0;
  }

  const maxRightPaneWidth = Math.max(0, availablePaneWidth - MIN_LEFT_PANE_WIDTH);
  const rightPaneWidth = Math.min(requestedRightPaneWidth, maxRightPaneWidth);

  return Math.max(0, availablePaneWidth - rightPaneWidth);
}

function normalizeSize(value: number): number {
  return Math.max(0, Math.floor(value));
}

function clampCoordinate(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}
