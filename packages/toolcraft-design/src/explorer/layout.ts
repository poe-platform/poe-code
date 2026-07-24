export type ExplorerLayoutMode =
  | "wide"
  | "medium"
  | "narrow-vertical"
  | "narrow-list-only"
  | "too-narrow";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExplorerLayoutOptions {
  cols: number;
  rows: number;
  detailHidden?: boolean;
  focused?: "list" | "detail";
}

export interface ExplorerLayout {
  mode: ExplorerLayoutMode;
  header: Rect;
  list: Rect;
  detail: Rect;
  footer: Rect;
}

const HEADER_HEIGHT = 3;
const FOOTER_HEIGHT = 1;

export function computeExplorerLayout(opts: ExplorerLayoutOptions): ExplorerLayout {
  const cols = normalizeSize(opts.cols);
  const rows = normalizeSize(opts.rows);
  const mode = resolveMode(cols, rows);
  const footerHeight = rows > 0 ? Math.min(FOOTER_HEIGHT, rows) : 0;
  const headerHeight = Math.min(HEADER_HEIGHT, Math.max(0, rows - footerHeight));
  const contentY = headerHeight;
  const contentHeight = Math.max(0, rows - headerHeight - footerHeight);
  const footerY = headerHeight + contentHeight;
  const header: Rect = { x: 0, y: 0, width: cols, height: headerHeight };
  const footer: Rect = { x: 0, y: footerY, width: cols, height: footerHeight };

  if (mode === "too-narrow") {
    return {
      mode,
      header,
      list: { x: 0, y: contentY, width: cols, height: contentHeight },
      detail: { x: 0, y: contentY + contentHeight, width: 0, height: 0 },
      footer
    };
  }

  if (mode === "narrow-list-only") {
    const detailFocused = opts.focused === "detail";
    return {
      mode,
      header,
      list: detailFocused ? { x: 0, y: contentY, width: 0, height: contentHeight } : { x: 0, y: contentY, width: cols, height: contentHeight },
      detail: detailFocused ? { x: 0, y: contentY, width: cols, height: contentHeight } : { x: cols, y: contentY, width: 0, height: contentHeight },
      footer
    };
  }

  if (opts.detailHidden === true) {
    return {
      mode,
      header,
      list: { x: 0, y: contentY, width: cols, height: contentHeight },
      detail: { x: cols, y: contentY, width: 0, height: contentHeight },
      footer
    };
  }

  if (mode === "narrow-vertical") {
    const listHeight = Math.ceil(contentHeight / 2);
    const detailHeight = contentHeight - listHeight;

    return {
      mode,
      header,
      list: { x: 0, y: contentY, width: cols, height: listHeight },
      detail: { x: 0, y: contentY + listHeight, width: cols, height: detailHeight },
      footer
    };
  }

  const gutterWidth = 1;
  const availableWidth = Math.max(0, cols - gutterWidth);
  const listWidth =
    mode === "wide" ? Math.floor((availableWidth * 5) / 12) : Math.floor((availableWidth * 2) / 5);
  const detailWidth = availableWidth - listWidth;

  return {
    mode,
    header,
    list: { x: 0, y: contentY, width: listWidth, height: contentHeight },
    detail: { x: listWidth + gutterWidth, y: contentY, width: detailWidth, height: contentHeight },
    footer
  };
}

function resolveMode(cols: number, rows: number): ExplorerLayoutMode {
  if (cols < 60 || rows < 8) {
    return "too-narrow";
  }

  if (cols < 80) {
    return "narrow-list-only";
  }

  if (cols < 100) {
    return "narrow-vertical";
  }

  if (cols < 120) {
    return "medium";
  }

  return "wide";
}

function normalizeSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}
