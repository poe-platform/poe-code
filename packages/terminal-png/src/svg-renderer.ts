import type { Color, StyledRun } from "./ansi-parser.js";
import { FONT_FACE_CSS } from "./font.js";

export interface SvgOptions {
  padding?: number;
  window?: boolean;
}

const ANSI_16_PALETTE = [
  "#282a2e",
  "#D74E6F",
  "#31BB71",
  "#D3E561",
  "#8056FF",
  "#ED61D7",
  "#04D7D7",
  "#C5C8C6",
  "#4B4B4B",
  "#FE5F86",
  "#00D787",
  "#EBFF71",
  "#8F69FF",
  "#FF7AEA",
  "#00FEFE",
  "#FFFFFF"
] as const;

const XTERM_256_PALETTE = [
  "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
  "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  "#000000", "#00005f", "#000087", "#0000af", "#0000d7", "#0000ff", "#005f00", "#005f5f",
  "#005f87", "#005faf", "#005fd7", "#005fff", "#008700", "#00875f", "#008787", "#0087af",
  "#0087d7", "#0087ff", "#00af00", "#00af5f", "#00af87", "#00afaf", "#00afd7", "#00afff",
  "#00d700", "#00d75f", "#00d787", "#00d7af", "#00d7d7", "#00d7ff", "#00ff00", "#00ff5f",
  "#00ff87", "#00ffaf", "#00ffd7", "#00ffff", "#5f0000", "#5f005f", "#5f0087", "#5f00af",
  "#5f00d7", "#5f00ff", "#5f5f00", "#5f5f5f", "#5f5f87", "#5f5faf", "#5f5fd7", "#5f5fff",
  "#5f8700", "#5f875f", "#5f8787", "#5f87af", "#5f87d7", "#5f87ff", "#5faf00", "#5faf5f",
  "#5faf87", "#5fafaf", "#5fafd7", "#5fafff", "#5fd700", "#5fd75f", "#5fd787", "#5fd7af",
  "#5fd7d7", "#5fd7ff", "#5fff00", "#5fff5f", "#5fff87", "#5fffaf", "#5fffd7", "#5fffff",
  "#870000", "#87005f", "#870087", "#8700af", "#8700d7", "#8700ff", "#875f00", "#875f5f",
  "#875f87", "#875faf", "#875fd7", "#875fff", "#878700", "#87875f", "#878787", "#8787af",
  "#8787d7", "#8787ff", "#87af00", "#87af5f", "#87af87", "#87afaf", "#87afd7", "#87afff",
  "#87d700", "#87d75f", "#87d787", "#87d7af", "#87d7d7", "#87d7ff", "#87ff00", "#87ff5f",
  "#87ff87", "#87ffaf", "#87ffd7", "#87ffff", "#af0000", "#af005f", "#af0087", "#af00af",
  "#af00d7", "#af00ff", "#af5f00", "#af5f5f", "#af5f87", "#af5faf", "#af5fd7", "#af5fff",
  "#af8700", "#af875f", "#af8787", "#af87af", "#af87d7", "#af87ff", "#afaf00", "#afaf5f",
  "#afaf87", "#afafaf", "#afafd7", "#afafff", "#afd700", "#afd75f", "#afd787", "#afd7af",
  "#afd7d7", "#afd7ff", "#afff00", "#afff5f", "#afff87", "#afffaf", "#afffd7", "#afffff",
  "#d70000", "#d7005f", "#d70087", "#d700af", "#d700d7", "#d700ff", "#d75f00", "#d75f5f",
  "#d75f87", "#d75faf", "#d75fd7", "#d75fff", "#d78700", "#d7875f", "#d78787", "#d787af",
  "#d787d7", "#d787ff", "#d7af00", "#d7af5f", "#d7af87", "#d7afaf", "#d7afd7", "#d7afff",
  "#d7d700", "#d7d75f", "#d7d787", "#d7d7af", "#d7d7d7", "#d7d7ff", "#d7ff00", "#d7ff5f",
  "#d7ff87", "#d7ffaf", "#d7ffd7", "#d7ffff", "#ff0000", "#ff005f", "#ff0087", "#ff00af",
  "#ff00d7", "#ff00ff", "#ff5f00", "#ff5f5f", "#ff5f87", "#ff5faf", "#ff5fd7", "#ff5fff",
  "#ff8700", "#ff875f", "#ff8787", "#ff87af", "#ff87d7", "#ff87ff", "#ffaf00", "#ffaf5f",
  "#ffaf87", "#ffafaf", "#ffafd7", "#ffafff", "#ffd700", "#ffd75f", "#ffd787", "#ffd7af",
  "#ffd7d7", "#ffd7ff", "#ffff00", "#ffff5f", "#ffff87", "#ffffaf", "#ffffd7", "#ffffff",
  "#080808", "#121212", "#1c1c1c", "#262626", "#303030", "#3a3a3a", "#444444", "#4e4e4e",
  "#585858", "#606060", "#666666", "#767676", "#808080", "#8a8a8a", "#949494", "#9e9e9e",
  "#a8a8a8", "#b2b2b2", "#bcbcbc", "#c6c6c6", "#d0d0d0", "#dadada", "#e4e4e4", "#eeeeee"
] as const;

const BACKGROUND = "#171717";
const DEFAULT_FOREGROUND = "#c4c4c4";
const FONT_FAMILY = "JetBrains Mono";
const FONT_SIZE = 14;
const LINE_HEIGHT = 1.2;
const CHARACTER_WIDTH = 8.412666666666667;
const TEXT_BOTTOM_PADDING = 11.6;
const DEFAULT_PADDING = {
  top: 20,
  right: 40,
  bottom: 20,
  left: 20
};
const WINDOW_BAR_HEIGHT = 15;

export function renderSvg(runs: StyledRun[], options: SvgOptions = {}): string {
  const padding = options.padding === undefined
    ? DEFAULT_PADDING
    : {
        top: options.padding,
        right: options.padding,
        bottom: options.padding,
        left: options.padding
      };
  const showWindow = options.window ?? true;
  const titleBarHeight = showWindow ? WINDOW_BAR_HEIGHT : 0;
  const textStartX = padding.left;
  const lineHeightPx = FONT_SIZE * LINE_HEIGHT;
  const textStartY = titleBarHeight + padding.top + lineHeightPx;
  const lines = splitIntoLines(runs);
  const contentWidth = measureLines(lines);
  const width = padding.left + contentWidth + padding.right;
  const height =
    titleBarHeight + padding.top + (lines.length * lineHeightPx) + padding.bottom + TEXT_BOTTOM_PADDING;
  const svgWidth = formatNumber(width);
  const svgHeight = formatNumber(height);
  const viewBox = `0 0 ${svgWidth} ${svgHeight}`;
  const textElements = renderLines(lines, textStartX, textStartY, lineHeightPx);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="${viewBox}">`,
    "<defs>",
    "<style><![CDATA[",
    FONT_FACE_CSS,
    "]]></style>",
    "</defs>",
    `<rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="${BACKGROUND}" />`,
    showWindow ? renderWindowControls() : "",
    `<g font-family="${FONT_FAMILY}" font-size="${formatNumber(FONT_SIZE)}px" fill="${DEFAULT_FOREGROUND}">`,
    textElements,
    "</g>",
    "</svg>"
  ].join("");
}

function splitIntoLines(runs: StyledRun[]): StyledRun[][] {
  const lines: StyledRun[][] = [[]];

  for (const run of runs) {
    if (run.text === "\n") {
      lines.push([]);
      continue;
    }

    lines[lines.length - 1]?.push(run);
  }

  return lines;
}

function measureLines(lines: StyledRun[][]): number {
  return Math.max(
    ...lines.map((line) => displayWidth(line.map((run) => run.text).join("")) * CHARACTER_WIDTH),
    0
  );
}

function displayWidth(text: string, startColumn = 0): number {
  const segmenter = new Intl.Segmenter();
  let column = startColumn;

  for (const { segment } of segmenter.segment(text)) {
    if (segment === "\t") {
      column += 8 - (column % 8);
      continue;
    }

    const cp = segment.codePointAt(0);
    if (cp !== undefined && isZeroWidthCodePoint(cp)) {
      continue;
    }

    column += cp !== undefined && (isWideCodePoint(cp) || isFlagSegment(segment)) ? 2 : 1;
  }

  return column - startColumn;
}

function isZeroWidthCodePoint(cp: number): boolean {
  return (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f);
}

function isFlagSegment(segment: string): boolean {
  const codePoints = [...segment].map((character) => character.codePointAt(0));
  return codePoints.length === 2 && codePoints.every((cp) => cp !== undefined && cp >= 0x1f1e6 && cp <= 0x1f1ff);
}

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115F) ||  // Hangul Jamo
    cp === 0x2329 || cp === 0x232A ||   // Angle brackets
    (cp >= 0x2E80 && cp <= 0x303E) ||  // CJK Radicals, Kangxi
    (cp >= 0x3041 && cp <= 0x33BF) ||  // Hiragana, Katakana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4DBF) ||  // CJK Extension A
    (cp >= 0x4E00 && cp <= 0xA4CF) ||  // CJK Unified Ideographs
    (cp >= 0xA960 && cp <= 0xA97F) ||  // Hangul Jamo Extended-A
    (cp >= 0xAC00 && cp <= 0xD7AF) ||  // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compatibility Ideographs
    (cp >= 0xFE10 && cp <= 0xFE19) ||  // Vertical Forms
    (cp >= 0xFE30 && cp <= 0xFE6F) ||  // CJK Compatibility Forms
    (cp >= 0xFF00 && cp <= 0xFF60) ||  // Fullwidth Latin, Halfwidth Katakana
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||  // Fullwidth Signs
    (cp >= 0x1B000 && cp <= 0x1B0FF) || // Kana Supplement
    (cp >= 0x1F004 && cp <= 0x1F004) || // Mahjong tile
    (cp >= 0x1F0CF && cp <= 0x1F0CF) || // Playing card black joker
    (cp >= 0x1F200 && cp <= 0x1FFFD) || // Enclosed CJK + Emoji
    (cp >= 0x20000 && cp <= 0x2FFFD) || // CJK Extension B–F
    (cp >= 0x30000 && cp <= 0x3FFFD)    // CJK Extension G–H
  );
}

function renderLines(
  lines: StyledRun[][],
  textStartX: number,
  textStartY: number,
  lineHeightPx: number
): string {
  return lines
    .map((line, index) => {
      const y = formatNumber(textStartY + (index * lineHeightPx));

      if (line.length === 0) {
        return `<text x="${formatNumber(textStartX)}" y="${y}" xml:space="preserve"/>`;
      }

      return [
        renderBackgrounds(line, textStartX, textStartY + (index * lineHeightPx) - lineHeightPx, lineHeightPx),
        `<text x="${formatNumber(textStartX)}" y="${y}" xml:space="preserve">`,
        line.map(renderRun).join(""),
        "</text>"
      ].join("");
    })
    .join("");
}

function renderBackgrounds(line: StyledRun[], startX: number, y: number, height: number): string {
  let column = 0;
  const rectangles: string[] = [];

  for (const run of line) {
    const width = displayWidth(run.text, column);
    const background = resolveBackgroundColor(run);
    if (background !== BACKGROUND && width > 0) {
      rectangles.push(`<rect x="${formatNumber(startX + (column * CHARACTER_WIDTH))}" y="${formatNumber(y)}" width="${formatNumber(width * CHARACTER_WIDTH)}" height="${formatNumber(height)}" fill="${escapeXmlAttribute(background)}" />`);
    }
    column += width;
  }

  return rectangles.join("");
}

function renderRun(run: StyledRun): string {
  const attributes = ['xml:space="preserve"'];
  const color = resolveForegroundColor(run);
  const textDecorations: string[] = [];

  if (color !== DEFAULT_FOREGROUND) {
    attributes.push(`fill="${escapeXmlAttribute(color)}"`);
  }

  if (run.bold) {
    attributes.push('font-weight="bold"');
  }

  if (run.italic) {
    attributes.push('font-style="italic"');
  }

  if (run.underline) {
    textDecorations.push("underline");
  }

  if (run.strikethrough) {
    textDecorations.push("line-through");
  }

  if (textDecorations.length > 0) {
    attributes.push(`text-decoration="${textDecorations.join(" ")}"`);
  }

  if (run.dim) {
    attributes.push('opacity="0.7"');
  }

  const text = run.conceal ? " ".repeat(displayWidth(run.text)) : run.text;
  return `<tspan ${attributes.join(" ")}>${escapeXmlText(text)}</tspan>`;
}

function renderWindowControls(): string {
  return [
    '<circle cx="13.5" cy="12" r="5.5" fill="#FF5A54" />',
    '<circle cx="32.5" cy="12" r="5.5" fill="#E6BF29" />',
    '<circle cx="51.5" cy="12" r="5.5" fill="#52C12B" />'
  ].join("");
}

function resolveColor(color: Color | null): string {
  if (color === null) {
    return DEFAULT_FOREGROUND;
  }

  if (color.type === "ansi4") {
    return ANSI_16_PALETTE[color.index] ?? DEFAULT_FOREGROUND;
  }

  if (color.type === "ansi8") {
    if (color.index < ANSI_16_PALETTE.length) {
      return ANSI_16_PALETTE[color.index] ?? DEFAULT_FOREGROUND;
    }

    return XTERM_256_PALETTE[color.index] ?? DEFAULT_FOREGROUND;
  }

  return `rgb(${color.r},${color.g},${color.b})`;
}

function resolveForegroundColor(run: StyledRun): string {
  return run.inverse ? resolveColorOrDefault(run.bg, BACKGROUND) : resolveColor(run.fg);
}

function resolveBackgroundColor(run: StyledRun): string {
  return run.inverse ? resolveColor(run.fg) : resolveColorOrDefault(run.bg, BACKGROUND);
}

function resolveColorOrDefault(color: Color | null, defaultColor: string): string {
  return color === null ? defaultColor : resolveColor(color);
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}
