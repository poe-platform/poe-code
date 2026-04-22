import { getTheme } from "../../internal/theme-detect.js";
import { light } from "../../tokens/colors.js";
import { ScreenBuffer } from "../buffer.js";
import type { CellStyle, DashboardStats, Rect } from "../types.js";
import type { VisualLine } from "./output-pane.js";

type StatusTone = "error" | "info" | "muted" | "success" | "warning";

export function renderStatsPane(buffer: ScreenBuffer, rect: Rect, stats: DashboardStats): void {
  buffer.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const lines = statsToLines(stats, rect.width);

  for (let row = 0; row < rect.height; row += 1) {
    const line = lines[row];
    if (line === undefined) {
      continue;
    }

    if (line.prefix.length > 0) {
      buffer.putInRect(rect, row, line.prefix, line.prefixStyle);
    }

    if (line.text.length === 0) {
      continue;
    }

    const textStart = Math.min(line.prefix.length, rect.width);
    buffer.putInRect(
      { x: rect.x + textStart, y: rect.y + row, width: rect.width - textStart, height: 1 },
      0,
      line.text,
      line.style
    );
  }
}

export function formatElapsed(ms: number): string {
  const safeMs = Number.isFinite(ms) ? ms : 0;
  const totalSeconds = Math.max(0, Math.floor(safeMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, "0")).join(":");
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function statsToLines(stats: DashboardStats, width: number): VisualLine[] {
  if (width <= 0) {
    return [];
  }

  const mutedStyle = getToneStyle("muted");
  const totalTokens = stats.tokensIn + stats.tokensOut;
  const iterationsLabel = stats.iterationsLabel ?? "Iteration";
  const lines: VisualLine[] = [
    createKeyValueLine("Status", formatStatus(stats.status), width, getStatusStyle(stats.status)),
    createKeyValueLine(iterationsLabel, formatNumber(stats.iterations), width),
    createKeyValueLine("Elapsed", formatElapsed(stats.elapsedMs), width),
    createBlankLine(),
    createKeyValueLine("Tokens In", formatNumber(stats.tokensIn), width),
    createKeyValueLine("Tokens Out", formatNumber(stats.tokensOut), width),
    createKeyValueLine("Total", formatNumber(totalTokens), width)
  ];

  if (stats.currentAction !== undefined) {
    lines.push(
      createBlankLine(),
      {
        prefix: clipText("Current:", width),
        prefixStyle: {},
        style: {},
        text: ""
      },
      {
        prefix: width > 0 ? clipText("  ", width) : "",
        prefixStyle: mutedStyle,
        style: mutedStyle,
        text: clipText(stats.currentAction, Math.max(width - 2, 0))
      }
    );
  }

  return lines;
}

function createBlankLine(): VisualLine {
  return {
    prefix: "",
    prefixStyle: {},
    style: {},
    text: ""
  };
}

function createKeyValueLine(
  label: string,
  value: string,
  width: number,
  valueStyle: CellStyle = {}
): VisualLine {
  const clippedValue = clipText(value, width);
  const availableBeforeValue = Math.max(width - clippedValue.length, 0);
  const clippedLabel = clipText(label, Math.max(availableBeforeValue - 1, 0));

  return {
    prefix: clippedLabel + " ".repeat(Math.max(availableBeforeValue - clippedLabel.length, 0)),
    prefixStyle: {},
    style: valueStyle,
    text: clippedValue
  };
}

function clipText(value: string, width: number): string {
  return width <= 0 ? "" : value.slice(0, width);
}

function formatStatus(status: DashboardStats["status"]): string {
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

function getStatusStyle(status: DashboardStats["status"]): CellStyle {
  if (status === "running") {
    return getToneStyle("info");
  }

  if (status === "paused") {
    return getToneStyle("warning");
  }

  if (status === "error") {
    return getToneStyle("error");
  }

  if (status === "done") {
    return getToneStyle("success");
  }

  return getToneStyle("muted");
}

function getToneStyle(tone: StatusTone): CellStyle {
  const isLightTheme = getTheme() === light;

  if (tone === "muted") {
    return isLightTheme ? { fg: "#666666" } : { dim: true };
  }

  if (tone === "info") {
    return isLightTheme ? { fg: "#a200ff" } : { fg: "magenta" };
  }

  if (tone === "warning") {
    return isLightTheme ? { fg: "#cc6600" } : { fg: "yellow" };
  }

  if (tone === "error") {
    return isLightTheme ? { fg: "#cc0000" } : { fg: "red" };
  }

  return isLightTheme ? { fg: "#008800" } : { fg: "green" };
}
