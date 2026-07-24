import { graphemes, graphemeWidth } from "../dashboard/terminal-width.js";
import type { CellStyle, Rect } from "../dashboard/types.js";
import { background, foreground, styleToSgrDelta, type PackedStyle } from "./style.js";

export interface Cell { ch: string; width: 1 | 2; style: PackedStyle; fg: number; bg: number }
export interface ScreenSize { cols: number; rows: number }
export interface ScreenSurface {
  readonly width: number;
  readonly height: number;
  put(x: number, y: number, text: string, style?: CellStyle | PackedStyle): void;
  clearRect(rect: Rect, style?: CellStyle | PackedStyle): void;
}

const EMPTY: Cell = { ch: " ", width: 1, style: 0, fg: 0, bg: 0 };

export class Screen {
  private cols = 0;
  private rows = 0;
  private front: Cell[] = [];
  private back: Cell[] = [];
  private outputStyle: PackedStyle = 0;

  private readonly colors: boolean;

  constructor(size: ScreenSize = { cols: 0, rows: 0 }, options: { colors?: boolean } = {}) {
    this.colors = options.colors ?? (process.env.NO_COLOR === undefined && process.env.TERM !== "dumb");
    this.resize(size);
  }

  get width(): number { return this.cols; }
  get height(): number { return this.rows; }

  resize(size: ScreenSize): void {
    this.cols = normalize(size.cols);
    this.rows = normalize(size.rows);
    this.front = cells(this.cols * this.rows);
    this.back = cells(this.cols * this.rows);
  }

  cell(x: number, y: number, ch: string, style: PackedStyle = 0): void {
    if (!this.inBounds(x, y) || ch.length === 0) return;
    const segment = graphemes(ch)[0];
    if (segment === undefined) return;
    const measured = graphemeWidth(segment);
    const width: 1 | 2 = measured > 1 ? 2 : 1;
    this.back[this.index(x, y)] = makeCell(segment, width, style);
    if (width === 2 && this.inBounds(x + 1, y)) this.back[this.index(x + 1, y)] = makeCell("", 1, style);
  }

  text(x: number, y: number, text: string, style: PackedStyle = 0): void {
    let offset = 0;
    for (const segment of graphemes(text)) {
      const width = Math.max(0, graphemeWidth(segment));
      if (width > 0) this.cell(x + offset, y, segment, style);
      offset += width;
    }
  }

  put(x: number, y: number, text: string, style: CellStyle | PackedStyle = 0): void {
    this.text(x, y, text, typeof style === "number" ? style : packLegacyStyle(style));
  }

  clearRect(rect: Rect, style: CellStyle | PackedStyle = 0): void {
    const packed = typeof style === "number" ? style : packLegacyStyle(style);
    const startX = Math.max(0, rect.x);
    const startY = Math.max(0, rect.y);
    const endX = Math.min(this.cols, rect.x + Math.max(0, rect.width));
    const endY = Math.min(this.rows, rect.y + Math.max(0, rect.height));
    for (let y = startY; y < endY; y += 1) for (let x = startX; x < endX; x += 1) this.cell(x, y, " ", packed);
  }

  flush(): string {
    const changed = new Set<number>();
    for (let index = 0; index < this.back.length; index += 1) {
      if (!equal(this.front[index]!, this.back[index]!)) {
        changed.add(index);
        const old = this.front[index]!;
        const next = this.back[index]!;
        if ((old.width === 2 || next.width === 2) && (index % this.cols) + 1 < this.cols) changed.add(index + 1);
        if (old.ch === "" && index % this.cols > 0) changed.add(index - 1);
      }
    }

    let output = "";
    let currentStyle = this.outputStyle;
    const ordered = [...changed].sort((left, right) => left - right);
    let cursor = 0;
    while (cursor < ordered.length) {
      const start = ordered[cursor]!;
      const y = Math.floor(start / this.cols);
      let end = start;
      while (cursor + 1 < ordered.length && ordered[cursor + 1] === end + 1 && Math.floor(ordered[cursor + 1]! / this.cols) === y) {
        cursor += 1;
        end += 1;
      }
      output += `\u001b[${y + 1};${(start % this.cols) + 1}H`;
      for (let index = start; index <= end; index += 1) {
        const cell = this.back[index]!;
        const delta = styleToSgrDelta(currentStyle, cell.style, this.colors);
        output += delta;
        currentStyle = cell.style;
        output += cell.ch.length === 0 ? "" : cell.ch;
      }
      cursor += 1;
    }
    this.front = this.back;
    this.back = cells(this.cols * this.rows);
    this.outputStyle = currentStyle;
    return output;
  }

  private index(x: number, y: number): number { return y * this.cols + x; }
  private inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }
}

function makeCell(ch: string, width: 1 | 2, style: PackedStyle): Cell {
  return { ch, width, style, fg: foreground(style), bg: background(style) };
}
function cells(length: number): Cell[] { return Array.from({ length }, () => ({ ...EMPTY })); }
function equal(left: Cell, right: Cell): boolean { return left.ch === right.ch && left.width === right.width && left.style === right.style; }
function normalize(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }

function packLegacyStyle(style: CellStyle): PackedStyle {
  return (style.bold ? 1 : 0)
    | (style.dim ? 2 : 0)
    | (style.underline ? 4 : 0)
    | (style.inverse ? 8 : 0)
    | (legacyColor(style.fg) << 8)
    | (legacyColor(style.bg) << 16);
}

function legacyColor(value: string | undefined): number {
  if (value === undefined) return 0;
  const names = ["", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "gray"];
  const exact = names.indexOf(value);
  if (exact >= 0) return exact;
  return value.startsWith("#") ? 7 : 0;
}
