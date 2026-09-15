import { getTheme } from "../../internal/theme-detect.js";
import { ScreenBuffer } from "../buffer.js";
import { plainTerminalText } from "../ansi.js";
import { displayWidth, graphemes, graphemeWidth, truncateToWidth } from "../terminal-width.js";
import type { CellStyle, DashboardStats, Rect } from "../types.js";
import { computeVisualLines, type VisualLine } from "./output-pane.js";

type StatusTone = "error" | "info" | "muted" | "success" | "warning";

export function renderCompactStatsPane(
  buffer: ScreenBuffer,
  rect: Rect,
  stats: DashboardStats
): void {
  buffer.clearRect(rect);
  if (rect.width <= 0 || rect.height <= 0) return;
  const status = formatStatus(stats.status);
  const progress = `${stats.iterationsLabel ?? "Iteration"} ${formatNumber(stats.iterations)}${stats.iterationsTotal === undefined ? "" : `/${formatNumber(stats.iterationsTotal)}`}`;
  const primary = stats.iterationsTotal === undefined ? `${status} · ${progress}` : `${progress} · ${status}`;
  const metrics = `${primary} · ${formatElapsed(stats.elapsedMs)} · ${formatNumber(stats.tokensIn + stats.tokensOut)} tokens`;
  const firstLine =
    rect.height === 1 && stats.iterationsTotal === undefined && stats.currentAction ? `${status} · ${stats.currentAction}` : metrics;
  const messages = [firstLine, stats.currentAction ?? ""].map(plainTerminalText);
  buffer.putInRect(
    rect,
    0,
    truncateToWidth(messages[0]!, rect.width),
    getStatusStyle(stats.status)
  );
  if (rect.height > 1 && stats.currentAction !== undefined) {
    buffer.putInRect(rect, 1, truncateToWidth(messages[1]!, rect.width), getToneStyle("muted"));
  }
}

export function renderStatsPane(buffer: ScreenBuffer, rect: Rect, stats: DashboardStats): void {
  buffer.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  let lines = statsToLines(stats, rect.width);
  if (lines.length > rect.height) {
    const actions = stats.currentAction === undefined ? [] : lines.slice(9);
    const progressLines = stats.iterationsTotal === undefined ? [] : [lines[1]!];
    const visibleActions = actions.slice(0, Math.max(0, rect.height - 1 - progressLines.length));
    if (visibleActions.length > 0 && visibleActions.length < actions.length) {
      const last = visibleActions[visibleActions.length - 1]!;
      visibleActions[visibleActions.length - 1] = {
        ...last,
        text: truncateToWidth(`${last.text}…`, Math.max(0, rect.width - displayWidth(last.prefix)))
      };
    }
    lines = [
      stats.iterationsTotal !== undefined && rect.height === 1
        ? createKeyValueLine(formatStatus(stats.status), `${stats.iterations}/${stats.iterationsTotal}`, rect.width, getStatusStyle(stats.status))
        : lines[0]!,
      ...progressLines,
      ...visibleActions,
      ...lines.slice(stats.iterationsTotal === undefined ? 1 : 2, 7).filter((line) => line.prefix.length > 0 || line.text.length > 0)
    ];
  }

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

    const textStart = Math.min(displayWidth(line.prefix), rect.width);
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
  const iterationsLabel = plainTerminalText(stats.iterationsLabel ?? "Iteration");
  const lines: VisualLine[] = [
    createKeyValueLine("Status", formatStatus(stats.status), width, getStatusStyle(stats.status)),
    createKeyValueLine(iterationsLabel, formatNumber(stats.iterations) + (stats.iterationsTotal === undefined ? "" : `/${formatNumber(stats.iterationsTotal)}`), width),
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
      ...computeVisualLines([{ kind: "status", text: stats.currentAction, ts: 0 }], width + 1).map(
        (line) => ({
          prefix: clipText("  ", width),
          prefixStyle: mutedStyle,
          style: mutedStyle,
          text: line.text
        })
      )
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
  const availableBeforeValue = Math.max(width - displayWidth(clippedValue), 0);
  const clippedLabel = clipText(label, Math.max(availableBeforeValue - 1, 0));

  return {
    prefix:
      clippedLabel + " ".repeat(Math.max(availableBeforeValue - displayWidth(clippedLabel), 0)),
    prefixStyle: {},
    style: valueStyle,
    text: clippedValue
  };
}

function clipText(value: string, width: number): string {
  let result = "";
  let cells = 0;
  for (const grapheme of graphemes(value)) {
    const size = graphemeWidth(grapheme);
    if (cells + size > width) break;
    result += grapheme;
    cells += size;
  }
  return result;
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
  return getTheme().styles[tone];
}
