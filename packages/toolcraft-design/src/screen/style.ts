export const STYLE_BOLD = 1 << 0;
export const STYLE_DIM = 1 << 1;
export const STYLE_UNDERLINE = 1 << 2;
export const STYLE_INVERSE = 1 << 3;
const FG_SHIFT = 8;
const BG_SHIFT = 16;
const COLOR_MASK = 0xff;

export type PackedStyle = number;

export function packStyle(style: {
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  inverse?: boolean;
  fg?: number;
  bg?: number;
}): PackedStyle {
  let packed = 0;
  if (style.bold) packed |= STYLE_BOLD;
  if (style.dim) packed |= STYLE_DIM;
  if (style.underline) packed |= STYLE_UNDERLINE;
  if (style.inverse) packed |= STYLE_INVERSE;
  packed |= ((style.fg ?? 0) & COLOR_MASK) << FG_SHIFT;
  packed |= ((style.bg ?? 0) & COLOR_MASK) << BG_SHIFT;
  return packed;
}

export function foreground(style: PackedStyle): number { return (style >> FG_SHIFT) & COLOR_MASK; }
export function background(style: PackedStyle): number { return (style >> BG_SHIFT) & COLOR_MASK; }

export function styleToSgrDelta(previous: PackedStyle, next: PackedStyle, colors = process.env.NO_COLOR === undefined && process.env.TERM !== "dumb"): string {
  if (!colors) return "";
  if (previous === next) return "";
  const codes: number[] = [];
  const previousIntensity = previous & (STYLE_BOLD | STYLE_DIM);
  const nextIntensity = next & (STYLE_BOLD | STYLE_DIM);
  if (previousIntensity !== nextIntensity) {
    if ((previousIntensity & ~nextIntensity) !== 0) codes.push(22);
    if ((nextIntensity & STYLE_BOLD) !== 0 && ((previousIntensity & ~nextIntensity) !== 0 || (previousIntensity & STYLE_BOLD) === 0)) codes.push(1);
    if ((nextIntensity & STYLE_DIM) !== 0 && ((previousIntensity & ~nextIntensity) !== 0 || (previousIntensity & STYLE_DIM) === 0)) codes.push(2);
  }
  flagDelta(codes, previous, next, STYLE_UNDERLINE, 4, 24);
  flagDelta(codes, previous, next, STYLE_INVERSE, 7, 27);
  const previousFg = foreground(previous);
  const nextFg = foreground(next);
  if (previousFg !== nextFg) codes.push(nextFg === 0 ? 39 : 30 + nextFg);
  const previousBg = background(previous);
  const nextBg = background(next);
  if (previousBg !== nextBg) codes.push(nextBg === 0 ? 49 : 40 + nextBg);
  return codes.length === 0 ? "" : `\u001b[${[...new Set(codes)].join(";")}m`;
}

function flagDelta(codes: number[], previous: number, next: number, flag: number, on: number, off: number): void {
  if ((previous & flag) !== (next & flag)) codes.push((next & flag) === 0 ? off : on);
}
