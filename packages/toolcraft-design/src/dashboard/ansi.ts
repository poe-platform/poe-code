import type { CellStyle } from "./types.js";

export interface StyledSegment {
  text: string;
  style: CellStyle;
}

export interface StyledLine {
  segments: StyledSegment[];
}

const ESC = "\u001b";

export function hasAnsi(text: string): boolean {
  return text.includes(ESC);
}

/**
 * Parse a block of text that may contain ANSI SGR escape codes into a sequence of
 * logical lines split on "\n". Each line is a list of styled segments: contiguous
 * printable runs of characters sharing the same style.
 *
 * Common cursor-affecting line controls are rendered into their visible result.
 * `baseStyle` is used as the initial style and as the restore target for SGR reset / default color.
 */
export function parseAnsi(text: string, baseStyle?: CellStyle): StyledLine[] {
  const base = normalizeStyle(baseStyle);
  let style: CellStyle = { ...base };
  let concealed = false;
  const lines: StyledLine[] = [];
  let cells: Array<{ ch: string; style: CellStyle } | undefined> = [];
  let column = 0;

  const finishLine = (): void => {
    lines.push({ segments: cellsToSegments(cells) });
    cells = [];
    column = 0;
  };

  let index = 0;

  while (index < text.length) {
    const ch = text[index]!;

    if (ch === ESC && text[index + 1] === "[") {
      const paramsStart = index + 2;
      let cursor = paramsStart;

      while (cursor < text.length && !isCsiFinalByte(text[cursor]!)) {
        cursor += 1;
      }

      if (cursor >= text.length) {
        index = text.length;
        break;
      }

      const params = text.slice(paramsStart, cursor);
      const finalByte = text[cursor]!;

      if (finalByte === "m") {
        const sgr = applySgr(style, concealed, parseParams(params), base);
        style = sgr.style;
        concealed = sgr.concealed;
      } else if (finalByte === "K" && parseParams(params)[0] === 2) {
        cells = [];
      }

      index = cursor + 1;
      continue;
    }

    if (ch === ESC) {
      const next = text[index + 1];
      if (next === "]" || next === "P" || next === "X" || next === "^" || next === "_") {
        index = skipStringTerminated(text, index + 2);
        continue;
      }
      index += 2;
      continue;
    }

    if (ch === "\r") {
      column = 0;
      index += 1;
      continue;
    }

    if (ch === "\n") {
      finishLine();
      index += 1;
      continue;
    }

    if (ch === "\b") {
      column = Math.max(0, column - 1);
      index += 1;
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code < 0x20 && ch !== "\t") {
      index += 1;
      continue;
    }

    cells[column] = { ch: concealed ? " " : ch, style: { ...style } };
    column += 1;
    index += 1;
  }

  finishLine();
  return lines;
}

function cellsToSegments(cells: Array<{ ch: string; style: CellStyle } | undefined>): StyledSegment[] {
  const segments: StyledSegment[] = [];

  for (const cell of cells) {
    const nextCell = cell ?? { ch: " ", style: {} };
    const last = segments[segments.length - 1];

    if (last && stylesEqual(last.style, nextCell.style)) {
      last.text += nextCell.ch;
    } else {
      segments.push({ text: nextCell.ch, style: { ...nextCell.style } });
    }
  }

  return segments;
}

function isCsiFinalByte(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

function skipStringTerminated(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const ch = text[index]!;
    if (ch === "\u0007") {
      return index + 1;
    }
    if (ch === ESC && text[index + 1] === "\\") {
      return index + 2;
    }
    index += 1;
  }
  return index;
}

function parseParams(params: string): number[] {
  if (params.length === 0) {
    return [0];
  }

  return params.split(";").flatMap((part) => {
    const colonParams = part.split(":");

    if (colonParams.length > 2 && colonParams[1] === "2") {
      colonParams.splice(2, 1);
    }

    return colonParams.map(parseParam);
  });
}

function parseParam(part: string): number {
    if (part.length === 0) {
      return 0;
    }
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

const BASIC_COLORS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white"
];

const BRIGHT_COLORS = [
  "gray",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright"
];

function applySgr(
  style: CellStyle,
  concealed: boolean,
  params: number[],
  base: CellStyle
): { style: CellStyle; concealed: boolean } {
  let next: CellStyle = { ...style };
  let nextConcealed = concealed;
  let index = 0;

  while (index < params.length) {
    const code = params[index]!;

    if (code === 0) {
      next = { ...base };
      nextConcealed = false;
      index += 1;
      continue;
    }

    if (code === 1) {
      next.bold = true;
      index += 1;
      continue;
    }

    if (code === 2) {
      next.dim = true;
      index += 1;
      continue;
    }

    if (code === 7) {
      next.inverse = true;
      index += 1;
      continue;
    }

    if (code === 22) {
      delete next.bold;
      delete next.dim;
      index += 1;
      continue;
    }

    if (code === 8) {
      nextConcealed = true;
      index += 1;
      continue;
    }

    if (code === 28) {
      nextConcealed = false;
      index += 1;
      continue;
    }

    if (code === 27) {
      delete next.inverse;
      index += 1;
      continue;
    }

    if (code >= 30 && code <= 37) {
      next.fg = BASIC_COLORS[code - 30];
      index += 1;
      continue;
    }

    if (code === 38) {
      const mode = params[index + 1];
      if (mode === 5) {
        const palette = params[index + 2] ?? 0;
        next.fg = convert256(palette);
        index += 3;
        continue;
      }
      if (mode === 2) {
        const r = params[index + 2] ?? 0;
        const g = params[index + 3] ?? 0;
        const b = params[index + 4] ?? 0;
        next.fg = rgbToHex(r, g, b);
        index += 5;
        continue;
      }
      index += 1;
      continue;
    }

    if (code === 39) {
      if (base.fg !== undefined) {
        next.fg = base.fg;
      } else {
        delete next.fg;
      }
      index += 1;
      continue;
    }

    if (code >= 40 && code <= 47) {
      next.bg = BASIC_COLORS[code - 40];
      index += 1;
      continue;
    }

    if (code === 48) {
      const mode = params[index + 1];
      if (mode === 5) {
        const palette = params[index + 2] ?? 0;
        next.bg = convert256(palette);
        index += 3;
        continue;
      }
      if (mode === 2) {
        const r = params[index + 2] ?? 0;
        const g = params[index + 3] ?? 0;
        const b = params[index + 4] ?? 0;
        next.bg = rgbToHex(r, g, b);
        index += 5;
        continue;
      }
      index += 1;
      continue;
    }

    if (code === 49) {
      if (base.bg !== undefined) {
        next.bg = base.bg;
      } else {
        delete next.bg;
      }
      index += 1;
      continue;
    }

    if (code >= 90 && code <= 97) {
      next.fg = BRIGHT_COLORS[code - 90];
      index += 1;
      continue;
    }

    if (code >= 100 && code <= 107) {
      next.bg = BRIGHT_COLORS[code - 100];
      index += 1;
      continue;
    }

    index += 1;
  }

  return { style: next, concealed: nextConcealed };
}

function convert256(palette: number): string {
  if (palette < 0 || palette > 255) {
    return "#000000";
  }
  if (palette < 8) {
    return BASIC_COLORS[palette]!;
  }
  if (palette < 16) {
    return BRIGHT_COLORS[palette - 8]!;
  }
  if (palette >= 232) {
    const level = 8 + (palette - 232) * 10;
    return rgbToHex(level, level, level);
  }
  const offset = palette - 16;
  const r = Math.floor(offset / 36);
  const g = Math.floor((offset % 36) / 6);
  const b = offset % 6;
  return rgbToHex(cubeLevel(r), cubeLevel(g), cubeLevel(b));
}

function cubeLevel(value: number): number {
  return value === 0 ? 0 : 55 + value * 40;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.floor(value)));
  return clamped.toString(16).padStart(2, "0");
}

function stylesEqual(left: CellStyle, right: CellStyle): boolean {
  return left.fg === right.fg
    && left.bg === right.bg
    && left.bold === right.bold
    && left.dim === right.dim
    && left.inverse === right.inverse;
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
  return next;
}
