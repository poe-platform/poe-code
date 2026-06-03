import { color, type Color } from "../components/color.js";
import { expandTabs, graphemes, graphemeWidth } from "./terminal-width.js";
import type { Cell, CellStyle, Rect } from "./types.js";

const EMPTY_CELL: Cell = { ch: " ", style: {} };

export class ScreenBuffer {
  private _width: number;
  private _height: number;
  private _cells: Cell[];

  constructor(width: number, height: number) {
    this._width = normalizeSize(width);
    this._height = normalizeSize(height);
    this._cells = createCells(this._width, this._height);
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  put(x: number, y: number, text: string, style?: CellStyle): void {
    if (!this.isInBoundsY(y) || text.length === 0) {
      return;
    }

    const normalizedStyle = normalizeStyle(style);
    let offset = 0;

    for (const ch of graphemes(expandTabs(text, Math.max(0, x)))) {
      const targetX = x + offset;
      const width = graphemeWidth(ch);
      offset += width;

      if (!this.isInBoundsX(targetX)) {
        continue;
      }

      this._cells[this.index(targetX, y)] = { ch, style: normalizedStyle };
      for (let continuation = 1; continuation < width; continuation += 1) {
        if (this.isInBoundsX(targetX + continuation)) {
          this._cells[this.index(targetX + continuation, y)] = { ch: "", style: normalizedStyle };
        }
      }
    }
  }

  get(x: number, y: number): Cell {
    if (!this.isInBounds(x, y)) {
      return cloneCell(EMPTY_CELL);
    }

    return cloneCell(this._cells[this.index(x, y)] ?? EMPTY_CELL);
  }

  clear(style?: CellStyle): void {
    this._cells = createCells(this._width, this._height, style);
  }

  clearRect(rect: Rect, style?: CellStyle): void {
    const startX = Math.max(0, rect.x);
    const startY = Math.max(0, rect.y);
    const endX = Math.min(this._width, rect.x + Math.max(0, rect.width));
    const endY = Math.min(this._height, rect.y + Math.max(0, rect.height));
    const normalizedStyle = normalizeStyle(style);

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        this._cells[this.index(x, y)] = { ch: " ", style: normalizedStyle };
      }
    }
  }

  resize(width: number, height: number): void {
    const nextWidth = normalizeSize(width);
    const nextHeight = normalizeSize(height);
    const nextCells = createCells(nextWidth, nextHeight);
    const copyWidth = Math.min(this._width, nextWidth);
    const copyHeight = Math.min(this._height, nextHeight);

    for (let y = 0; y < copyHeight; y += 1) {
      for (let x = 0; x < copyWidth; x += 1) {
        nextCells[(y * nextWidth) + x] = cloneCell(this._cells[this.index(x, y)] ?? EMPTY_CELL);
      }
    }

    this._width = nextWidth;
    this._height = nextHeight;
    this._cells = nextCells;
  }

  putInRect(rect: Rect, row: number, text: string, style?: CellStyle): void {
    if (row < 0 || row >= rect.height || text.length === 0 || rect.width <= 0) {
      return;
    }

    const y = rect.y + row;
    if (!this.isInBoundsY(y)) {
      return;
    }

    const normalizedStyle = normalizeStyle(style);
    const rectEndX = rect.x + rect.width;
    let offset = 0;

    for (const ch of graphemes(expandTabs(text))) {
      const targetX = rect.x + offset;
      const width = graphemeWidth(ch);
      offset += width;

      if (targetX + width > rectEndX) {
        break;
      }

      if (!this.isInBoundsX(targetX)) {
        continue;
      }

      this._cells[this.index(targetX, y)] = { ch, style: normalizedStyle };
      for (let continuation = 1; continuation < width; continuation += 1) {
        if (this.isInBoundsX(targetX + continuation)) {
          this._cells[this.index(targetX + continuation, y)] = { ch: "", style: normalizedStyle };
        }
      }
    }
  }

  private index(x: number, y: number): number {
    return (y * this._width) + x;
  }

  private isInBounds(x: number, y: number): boolean {
    return this.isInBoundsX(x) && this.isInBoundsY(y);
  }

  private isInBoundsX(x: number): boolean {
    return x >= 0 && x < this._width;
  }

  private isInBoundsY(y: number): boolean {
    return y >= 0 && y < this._height;
  }
}

export function diff(
  prev: ScreenBuffer,
  next: ScreenBuffer
): Array<{ x: number; y: number; cell: Cell }> {
  const changes: Array<{ x: number; y: number; cell: Cell }> = [];
  const width = Math.max(prev.width, next.width);
  const height = Math.max(prev.height, next.height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const previousCell = prev.get(x, y);
      const nextCell = next.get(x, y);

      if (!cellsEqual(previousCell, nextCell)) {
        changes.push({ x, y, cell: nextCell });
      }
    }
  }

  return changes;
}

export function cellToAnsi(cell: Cell): string {
  if (cell.ch.length === 0) {
    return "";
  }

  const style = cell.style ?? {};
  let painter = color;

  if (style.bold) {
    painter = painter.bold;
  }

  if (style.dim) {
    painter = painter.dim;
  }

  if (style.inverse) {
    painter = painter.inverse;
  }

  if (style.underline) {
    painter = painter.underline;
  }

  if (style.fg) {
    painter = applyForegroundColor(painter, style.fg);
  }

  if (style.bg) {
    painter = applyBackgroundColor(painter, style.bg);
  }

  return painter(cell.ch);
}

function createCells(width: number, height: number, style?: CellStyle): Cell[] {
  const normalizedStyle = normalizeStyle(style);
  return Array.from({ length: width * height }, () => ({ ch: " ", style: normalizedStyle }));
}

function cloneCell(cell: Cell): Cell {
  return {
    ch: cell.ch,
    style: normalizeStyle(cell.style)
  };
}

function normalizeStyle(style?: CellStyle): CellStyle {
  const next: CellStyle = {};

  if (style?.fg !== undefined) {
    next.fg = style.fg;
  }

  if (style?.bg !== undefined) {
    next.bg = style.bg;
  }

  if (style?.bold !== undefined) {
    next.bold = style.bold;
  }

  if (style?.dim !== undefined) {
    next.dim = style.dim;
  }
  if (style?.inverse !== undefined) {
    next.inverse = style.inverse;
  }
  if (style?.underline !== undefined) {
    next.underline = style.underline;
  }

  return next;
}

function normalizeSize(value: number): number {
  return Math.max(0, Math.floor(value));
}

function cellsEqual(left: Cell, right: Cell): boolean {
  return left.ch === right.ch
    && left.style.fg === right.style.fg
    && left.style.bg === right.style.bg
    && left.style.bold === right.style.bold
    && left.style.dim === right.style.dim
    && left.style.inverse === right.style.inverse
    && left.style.underline === right.style.underline;
}

function applyForegroundColor(instance: Color, ansiColor: string): Color {
  if (ansiColor.startsWith("#")) {
    return instance.hex(ansiColor);
  }

  const painter = (instance as unknown as Record<string, unknown>)[ansiColor];
  return typeof painter === "function" ? (painter as Color) : instance;
}

function applyBackgroundColor(instance: Color, ansiColor: string): Color {
  if (ansiColor.startsWith("#")) {
    return instance.bgHex(ansiColor);
  }

  const methodName = ansiColor.startsWith("bg")
    ? ansiColor
    : `bg${ansiColor.charAt(0).toUpperCase()}${ansiColor.slice(1)}`;
  const painter = (instance as unknown as Record<string, unknown>)[methodName];
  return typeof painter === "function" ? (painter as Color) : instance;
}
