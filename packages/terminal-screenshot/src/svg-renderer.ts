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
const DEFAULT_FOREGROUND = "#C5C8C6";
const FONT_FAMILY = "JetBrains Mono";
const FONT_SIZE = 14;
const LINE_HEIGHT = 1.2;
const FONT_HEIGHT_TO_WIDTH_RATIO = 1.68;
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
  const textStartY = titleBarHeight + padding.top + FONT_SIZE;
  const charWidth = FONT_SIZE / FONT_HEIGHT_TO_WIDTH_RATIO;
  const lineHeightPx = FONT_SIZE * LINE_HEIGHT;
  const { width: contentWidth, lines } = measureRuns(runs, charWidth);
  const width = padding.left + contentWidth + padding.right;
  const height = titleBarHeight + padding.top + (lines * lineHeightPx) + padding.bottom;

  const tspanElements = runs.map(run => renderRun(run, textStartX)).join("");
  const svgWidth = formatNumber(width);
  const svgHeight = formatNumber(height);
  const viewBox = `0 0 ${svgWidth} ${svgHeight}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="${viewBox}">`,
    "<defs>",
    "<style><![CDATA[",
    FONT_FACE_CSS,
    `
text {
  font-family: '${FONT_FAMILY}';
  font-size: ${FONT_SIZE}px;
  font-variant-ligatures: normal;
  font-feature-settings: "calt" 1, "liga" 1;
}`,
    "]]></style>",
    "</defs>",
    `<rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="${BACKGROUND}" />`,
    showWindow ? renderWindowControls() : "",
    `<text xml:space="preserve" x="${formatNumber(textStartX)}" y="${formatNumber(textStartY)}">`,
    tspanElements,
    "</text>",
    "</svg>"
  ].join("");
}

function measureRuns(runs: StyledRun[], charWidth: number): { width: number; lines: number } {
  const lineWidths = [0];
  let lineIndex = 0;

  for (const run of runs) {
    if (run.text === "\n") {
      lineIndex += 1;
      lineWidths.push(0);
      continue;
    }

    lineWidths[lineIndex] += Array.from(run.text).length * charWidth;
  }

  return {
    width: Math.max(...lineWidths, 0),
    lines: lineWidths.length
  };
}

function renderRun(run: StyledRun, textStartX: number): string {
  const attributes = [
    `fill="${escapeXmlAttribute(resolveColor(run.fg))}"`,
    `font-weight="${run.bold ? "bold" : "normal"}"`,
    `font-style="${run.italic ? "italic" : "normal"}"`,
    `text-decoration="${run.underline ? "underline" : "none"}"`,
    `opacity="${run.dim ? "0.7" : "1"}"`
  ];

  if (run.text === "\n") {
    attributes.push(`x="${formatNumber(textStartX)}"`);
    attributes.push(`dy="${LINE_HEIGHT}em"`);
    return `<tspan ${attributes.join(" ")}>&#8203;</tspan>`;
  }

  return `<tspan ${attributes.join(" ")}>${escapeXmlText(run.text)}</tspan>`;
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
