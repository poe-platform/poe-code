import path from "node:path";
import { getTheme, renderMarkdown, stripAnsi, type ThemePalette } from "toolcraft-design";
import type { AgentTraceSource, NormalizedTraceTurn, TraceReference } from "@poe-code/agent-traces";
import type {
  ContextBreakdown,
  ContextBreakdownCategory,
  ContextBreakdownItem,
  ContextUsage,
  SubagentSummary,
  TraceView
} from "./types.js";

type Styler = (text: string) => string;

const DEFAULT_GAUGE_WIDTH = 16;
const COMPACT_GAUGE_WIDTH = 5;
const MAX_RENDER_WIDTH = 80;
const MAX_TRACE_LABEL_WIDTH = 60;
const MAX_TRACE_META_CWD_WIDTH = 18;
const MAX_SUBAGENT_AGENT_WIDTH = 13;
const MAX_SUBAGENT_DESCRIPTION_WIDTH = 26;
const COLLAPSED_TURN_LINES = 3;
const COLLAPSED_TURN_MAX_CHARS = (MAX_RENDER_WIDTH + 1) * COLLAPSED_TURN_LINES;
const MAX_MARKDOWN_TURN_CHARS = 65_536;
const TURNS_PER_RENDER_YIELD = 256;

const CATEGORY_ORDER = [
  "system-prompt",
  "skills",
  "mcp",
  "system-reminders",
  "tools",
  "reasoning",
  "messages",
  "other"
] as const;

const CATEGORY_COLORS = {
  "system-prompt": (theme: ThemePalette) => theme.info,
  skills: (theme: ThemePalette) => theme.success,
  mcp: (theme: ThemePalette) => theme.accent,
  "system-reminders": (theme: ThemePalette) => theme.warning,
  tools: (theme: ThemePalette) => theme.error,
  reasoning: (theme: ThemePalette) => theme.muted,
  messages: (theme: ThemePalette) => theme.info,
  other: (theme: ThemePalette) => theme.muted
} satisfies Record<(typeof CATEGORY_ORDER)[number], (theme: ThemePalette) => Styler>;

const SOURCE_COLORS = {
  claude: (theme: ThemePalette) => theme.accent,
  codex: (theme: ThemePalette) => theme.info,
  pi: (theme: ThemePalette) => theme.warning,
  "poe-code": (theme: ThemePalette) => theme.success
} satisfies Record<AgentTraceSource, (theme: ThemePalette) => Styler>;

const ROLE_RENDERING = {
  human: { glyph: "›", color: (theme: ThemePalette) => theme.accent },
  assistant: { glyph: "✦", color: (theme: ThemePalette) => theme.success },
  tool: { glyph: "⚙", color: (theme: ThemePalette) => theme.info },
  system: { glyph: "⚠", color: (theme: ThemePalette) => theme.warning }
} satisfies Record<
  NormalizedTraceTurn["role"],
  { glyph: string; color: (theme: ThemePalette) => Styler }
>;

const UNKNOWN_CATEGORY_COLOR = (theme: ThemePalette) => theme.muted;

export function renderContextGauge(context: ContextUsage, width = DEFAULT_GAUGE_WIDTH): string {
  const theme = getTheme();
  const gaugeWidth = normalizeGaugeWidth(width);
  const clampedPercent = clamp(context.percent, 0, 100);
  const filled = Math.round((clampedPercent / 100) * gaugeWidth);
  const empty = gaugeWidth - filled;
  const tone =
    context.percent >= 85 ? theme.error : context.percent >= 60 ? theme.warning : theme.success;
  const bar = `${theme.muted("▐")}${tone("█".repeat(filled))}${theme.muted("░".repeat(empty))}${theme.muted("▌")}`;
  const source = context.source === "estimated" ? theme.muted("(estimated)") : context.source;

  return `${bar} ${formatCount(context.tokens)} / ${formatCount(context.window)} · ${context.percent}% · ${source}`;
}

export function renderBreakdown(breakdown: ContextBreakdown, width = 32): string {
  const categories = sortCategories(breakdown.categories);
  if (categories.length === 0) {
    return "Context breakdown\n  No context tokens measured";
  }

  const theme = getTheme();
  const title =
    breakdown.source === "estimated"
      ? `Context breakdown ${theme.muted("(counting exact tokens…)")}`
      : "Context breakdown";
  const bar = renderSegmentedBar(categories, normalizeGaugeWidth(width), theme);
  const labelWidth = Math.max(10, ...categories.map((category) => category.label.length));
  const tokenWidth = Math.max(
    1,
    ...categories.map((category) => formatCount(category.tokens).length)
  );
  const percentWidth = Math.max(3, ...categories.map((category) => `${category.percent}%`.length));
  const lines = [title, `  ${bar}`];

  for (const category of categories) {
    const styler = categoryColor(category.id, theme);
    lines.push(
      [
        "  ",
        styler("■"),
        " ",
        category.label.padEnd(labelWidth),
        "  ",
        formatCount(category.tokens).padStart(tokenWidth),
        "  ",
        `${category.percent}%`.padStart(percentWidth)
      ].join("")
    );

    if (category.id === "skills" || category.id === "mcp" || category.id === "tools") {
      lines.push(...renderBreakdownItems(category.items, tokenWidth, theme));
    }
  }

  return lines.join("\n");
}

export function renderTraceLine(item: TraceReference): { label: string; meta: string } {
  const label = truncate(item.title?.trim() || item.id, MAX_TRACE_LABEL_WIDTH);
  const metaParts = [
    item.source,
    relativeTime(item.updatedAt),
    item.cwd === undefined ? undefined : truncate(path.basename(item.cwd), MAX_TRACE_META_CWD_WIDTH)
  ].filter((part): part is string => part !== undefined && part.length > 0);

  return {
    label,
    meta: metaParts.join(" · ")
  };
}

export function renderSubagents(summaries: SubagentSummary[]): string {
  if (summaries.length === 0) {
    return "";
  }

  const theme = getTheme();
  const lines = [theme.header("Subagents")];
  const rendered = summaries.map((summary, index) => {
    const depth = Math.min(3, Math.max(1, Math.floor(summary.reference.spawnDepth ?? 1)));
    const agentType = truncate(
      summary.reference.agentType ?? summary.reference.source,
      MAX_SUBAGENT_AGENT_WIDTH
    );
    const description = truncate(
      sanitizeInline(summary.reference.title?.trim() || summary.reference.id),
      MAX_SUBAGENT_DESCRIPTION_WIDTH
    );
    return {
      summary,
      depth,
      connector: index === summaries.length - 1 ? "└─" : "├─",
      agentType,
      description,
      gauge: renderCompactContextGauge(summary.context)
    };
  });
  const gaugeWidth = Math.max(...rendered.map((entry) => plainLength(entry.gauge)));

  for (const entry of rendered) {
    const baseIndent = "  ".repeat(entry.depth);
    lines.push(
      [
        baseIndent,
        theme.muted(entry.connector),
        " ",
        SOURCE_COLORS[entry.summary.reference.source](theme)(
          entry.agentType.padEnd(MAX_SUBAGENT_AGENT_WIDTH)
        ),
        "  ",
        entry.description.padEnd(MAX_SUBAGENT_DESCRIPTION_WIDTH),
        "  ",
        padVisible(entry.gauge, gaugeWidth),
        "  ",
        `${entry.summary.turnCount} ${entry.summary.turnCount === 1 ? "turn" : "turns"}`
      ].join("")
    );
  }

  return lines.join("\n");
}

export interface RenderTraceDetailOptions {
  signal?: AbortSignal;
}

export async function renderTraceDetail(
  view: TraceView,
  subagents: SubagentSummary[] = [],
  options: RenderTraceDetailOptions = {}
): Promise<string> {
  const theme = getTheme();
  const lines = [
    theme.header(truncate(sanitizeInline(view.title?.trim() || view.id), MAX_RENDER_WIDTH)),
    `Source: ${sourceBadge(view.source, theme)}`,
    ...(view.model
      ? [`Model: ${truncate(sanitizeInline(view.model), MAX_RENDER_WIDTH - "Model: ".length)}`]
      : []),
    `Turns: ${view.turns.length}`,
    `Started: ${formatDate(view.createdAt)}`,
    `Updated: ${formatDate(view.updatedAt)}`,
    renderContextGauge(view.context),
    "",
    renderBreakdown(view.breakdown)
  ];
  const renderedSubagents = renderSubagents(subagents);
  if (renderedSubagents.length > 0) {
    lines.push("", renderedSubagents);
  }

  lines.push("", theme.header("Conversation"));
  if (view.turns.length === 0) {
    lines.push(`  ${theme.muted("No turns")}`);
    return lines.join("\n");
  }

  for (let index = 0; index < view.turns.length; index += 1) {
    if (index > 0 && index % TURNS_PER_RENDER_YIELD === 0) {
      await yieldToEventLoop();
      if (options.signal?.aborted) {
        break;
      }
    }
    lines.push(...renderTurn(view.turns[index]!, theme));
  }

  return lines.join("\n");
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function renderBreakdownItems(
  items: ContextBreakdownItem[],
  minimumTokenWidth: number,
  theme: ThemePalette
): string[] {
  const shown = items.slice(0, 5);
  const labels = shown.map((item) => truncate(item.name, 32));
  const nameWidth = Math.max(1, ...labels.map((label) => label.length));
  const tokenWidth = Math.max(
    minimumTokenWidth,
    ...shown.map((item) => formatCount(item.tokens).length)
  );
  const lines = shown.map((item, index) =>
    [
      "      ",
      labels[index]!.padEnd(nameWidth),
      "  ",
      formatCount(item.tokens).padStart(tokenWidth),
      "  ",
      theme.muted(`×${item.count}`)
    ].join("")
  );

  if (items.length > shown.length) {
    lines.push(`      ${theme.muted(`… ${items.length - shown.length} more`)}`);
  }

  return lines;
}

function renderSegmentedBar(
  categories: ContextBreakdownCategory[],
  width: number,
  theme: ThemePalette
): string {
  const total = categories.reduce((sum, category) => sum + Math.max(0, category.tokens), 0);
  if (total === 0) {
    return `${theme.muted("▐")}${theme.muted("░".repeat(width))}${theme.muted("▌")}`;
  }

  let remaining = width;
  const segments = categories.map((category, index) => {
    if (index === categories.length - 1) {
      const cells = Math.max(0, remaining);
      remaining -= cells;
      return { category, cells };
    }
    const exact = (Math.max(0, category.tokens) / total) * width;
    const cells = Math.max(category.tokens > 0 ? 1 : 0, Math.round(exact));
    remaining -= cells;
    return { category, cells };
  });

  while (remaining < 0) {
    const largest = segments
      .filter((segment) => segment.cells > 0)
      .sort((left, right) => right.cells - left.cells)[0];
    if (largest === undefined) {
      break;
    }
    largest.cells -= 1;
    remaining += 1;
  }

  while (remaining > 0 && segments.length > 0) {
    segments[segments.length - 1]!.cells += 1;
    remaining -= 1;
  }

  return [
    theme.muted("▐"),
    ...segments.map((segment) =>
      categoryColor(segment.category.id, theme)("█".repeat(segment.cells))
    ),
    theme.muted("▌")
  ].join("");
}

function renderCompactContextGauge(context: ContextUsage): string {
  const theme = getTheme();
  const clampedPercent = clamp(context.percent, 0, 100);
  const filled = Math.min(
    COMPACT_GAUGE_WIDTH,
    Math.max(context.tokens > 0 ? 1 : 0, Math.round((clampedPercent / 100) * COMPACT_GAUGE_WIDTH))
  );
  const empty = COMPACT_GAUGE_WIDTH - filled;
  const tone =
    context.percent >= 85 ? theme.error : context.percent >= 60 ? theme.warning : theme.success;
  return [
    theme.muted("▐"),
    tone("█".repeat(filled)),
    theme.muted("░".repeat(empty)),
    theme.muted("▌"),
    " ",
    formatCount(context.tokens),
    " · ",
    `${context.percent}%`
  ].join("");
}

function renderTurn(turn: NormalizedTraceTurn, theme: ThemePalette): string[] {
  const renderer = ROLE_RENDERING[turn.role];
  const role = renderer.color(theme)(`${turn.role} ${renderer.glyph}`);
  const shouldCollapse = turn.role === "tool" || turn.role === "system";
  let sourceText = turn.text;
  let collapsedLines = 0;
  let truncatedWithinLine = false;
  if (shouldCollapse) {
    const cut = lineEndIndex(sourceText, COLLAPSED_TURN_LINES);
    if (cut !== -1) {
      collapsedLines = countNewlines(sourceText, cut);
      sourceText = sourceText.slice(0, cut);
    }
    if (sourceText.length > COLLAPSED_TURN_MAX_CHARS) {
      sourceText = sourceText.slice(0, COLLAPSED_TURN_MAX_CHARS);
      truncatedWithinLine = true;
    }
  }
  const sanitizedText = sanitizeTraceText(sourceText);
  const text =
    turn.role === "assistant" && sanitizedText.length <= MAX_MARKDOWN_TURN_CHARS
      ? stripAnsi(renderMarkdown(sanitizedText)).trimEnd()
      : sanitizedText.trimEnd();
  const rawLines = text.length === 0 ? [""] : text.split("\n");
  const visibleLines = shouldCollapse ? rawLines.slice(0, COLLAPSED_TURN_LINES) : rawLines;
  const remaining = collapsedLines + rawLines.length - visibleLines.length;
  const prefix = `  ${role} `;
  const continuationPrefix = " ".repeat(plainLength(`  ${turn.role} ${renderer.glyph} `));
  const lines: string[] = [];

  visibleLines.forEach((line, lineIndex) => {
    const firstPrefix = lineIndex === 0 ? prefix : continuationPrefix;
    const wrapped = wrapLine(line, MAX_RENDER_WIDTH - plainLength(firstPrefix));
    wrapped.forEach((wrappedLine, wrappedIndex) => {
      const linePrefix = lineIndex === 0 && wrappedIndex === 0 ? prefix : continuationPrefix;
      lines.push(`${linePrefix}${wrappedLine}`);
    });
  });

  if (shouldCollapse && lines.length > COLLAPSED_TURN_LINES) {
    lines.length = COLLAPSED_TURN_LINES;
    truncatedWithinLine = true;
  }

  if (remaining > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${theme.muted(`… +${remaining} lines`)}`;
  } else if (truncatedWithinLine) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${theme.muted("…")}`;
  }

  return lines;
}

function sortCategories(categories: ContextBreakdownCategory[]): ContextBreakdownCategory[] {
  const order = new Map<string, number>(CATEGORY_ORDER.map((id, index) => [id, index]));
  return [...categories].sort((left, right) => {
    const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex === rightIndex
      ? left.label.localeCompare(right.label)
      : leftIndex - rightIndex;
  });
}

function categoryColor(id: string, theme: ThemePalette): Styler {
  return (
    (CATEGORY_COLORS as Record<string, (theme: ThemePalette) => Styler>)[id]?.(theme) ??
    UNKNOWN_CATEGORY_COLOR(theme)
  );
}

function sourceBadge(source: AgentTraceSource, theme: ThemePalette): string {
  return SOURCE_COLORS[source](theme)(source);
}

function formatCount(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) > 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function relativeTime(date: Date | undefined): string {
  if (date === undefined) {
    return "unknown";
  }

  const elapsedMs = Date.now() - date.getTime();
  const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }
  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function formatDate(date: Date | undefined): string {
  return date === undefined ? "unknown" : date.toISOString();
}

function normalizeGaugeWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_GAUGE_WIDTH;
  }
  return Math.max(1, Math.floor(width));
}

function truncate(value: string, maxWidth: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxWidth) {
    return value;
  }
  if (maxWidth <= 1) {
    return "…";
  }
  return `${characters.slice(0, maxWidth - 1).join("")}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function plainLength(value: string): number {
  return stripAnsi(value).length;
}

function padVisible(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - plainLength(value)))}`;
}

function sanitizeInline(value: string): string {
  return sanitizeTraceText(value).split("\n").join(" ");
}

function lineEndIndex(value: string, lineCount: number): number {
  let index = -1;
  for (let line = 0; line < lineCount; line += 1) {
    index = value.indexOf("\n", index + 1);
    if (index === -1) {
      return -1;
    }
  }
  return index;
}

function countNewlines(value: string, from: number): number {
  let count = 0;
  for (let index = from; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}

function needsSanitize(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 10) || code === 127) {
      return true;
    }
  }
  return false;
}

function sanitizeTraceText(value: string): string {
  if (!needsSanitize(value)) {
    return value;
  }
  return sanitizeTraceTextSlow(value);
}

function sanitizeTraceTextSlow(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const char = value[index]!;
    const code = char.charCodeAt(0);
    if (code === 27) {
      index = skipEscapeSequence(value, index);
      continue;
    }
    if (code === 10) {
      result += "\n";
      index += 1;
      continue;
    }
    if (code === 9) {
      result += "  ";
      index += 1;
      continue;
    }
    if (code < 32 || code === 127) {
      result += " ";
      index += 1;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function skipEscapeSequence(value: string, index: number): number {
  if (value[index + 1] !== "[") {
    return index + 1;
  }

  let next = index + 2;
  while (next < value.length) {
    const code = value.charCodeAt(next);
    next += 1;
    if (code >= 0x40 && code <= 0x7e) {
      break;
    }
  }
  return next;
}

function wrapLine(value: string, width: number): string[] {
  const targetWidth = Math.max(1, width);
  if (value.length <= targetWidth) {
    return [value];
  }

  const lines: string[] = [];
  let current = "";
  for (const word of value.split(" ")) {
    const pieces = splitLongWord(word, targetWidth);
    for (const piece of pieces) {
      if (current.length === 0) {
        current = piece;
        continue;
      }
      if (`${current} ${piece}`.length <= targetWidth) {
        current = `${current} ${piece}`;
        continue;
      }
      lines.push(current);
      current = piece;
    }
  }
  lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function splitLongWord(value: string, width: number): string[] {
  const characters = Array.from(value);
  if (characters.length <= width) {
    return [value];
  }

  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += width) {
    chunks.push(characters.slice(index, index + width).join(""));
  }
  return chunks;
}
