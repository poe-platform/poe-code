const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function graphemes(value: string): string[] {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) {
      return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
    }
  }

  return value.split("");
}

export function displayWidth(value: string, startColumn = 0): number {
  let column = startColumn;

  for (const segment of graphemes(value)) {
    if (segment === "\t") {
      column += 8 - (column % 8);
      continue;
    }

    column += graphemeWidth(segment);
  }

  return column - startColumn;
}

export function expandTabs(value: string, startColumn = 0): string {
  let column = startColumn;
  let expanded = "";

  for (const segment of graphemes(value)) {
    if (segment === "\t") {
      const spaces = 8 - (column % 8);
      expanded += " ".repeat(spaces);
      column += spaces;
      continue;
    }

    expanded += segment;
    column += graphemeWidth(segment);
  }

  return expanded;
}

export function graphemeWidth(segment: string): number {
  const codePoint = segment.codePointAt(0);

  if (codePoint === undefined || isZeroWidthCodePoint(codePoint)) {
    return 0;
  }

  return isWideCodePoint(codePoint) || isFlagSegment(segment) || segment.includes("\ufe0f") ? 2 : 1;
}

export function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  const target = Math.max(0, width - 1);
  let result = "";
  let used = 0;
  for (const segment of graphemes(text)) {
    const segmentWidth = graphemeWidth(segment);
    if (used + segmentWidth > target) break;
    result += segment;
    used += segmentWidth;
  }
  return `${result}…`;
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
    || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
    || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
    || (codePoint >= 0xfe20 && codePoint <= 0xfe2f);
}

function isFlagSegment(segment: string): boolean {
  const codePoints = [...segment].map((character) => character.codePointAt(0));
  return codePoints.length === 2
    && codePoints.every(
      (codePoint) => codePoint !== undefined && codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff
    );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f)
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0x303e)
    || (codePoint >= 0x3041 && codePoint <= 0x33bf)
    || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0xa4cf)
    || (codePoint >= 0xa960 && codePoint <= 0xa97f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1b000 && codePoint <= 0x1b0ff)
    || codePoint === 0x1f004
    || codePoint === 0x1f0cf
    || (codePoint >= 0x1f200 && codePoint <= 0x1fffd)
    || (codePoint >= 0x20000 && codePoint <= 0x2fffd)
    || (codePoint >= 0x30000 && codePoint <= 0x3fffd)
  );
}
