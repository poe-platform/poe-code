import { getTheme } from "../../internal/theme-detect.js";
import { plainTerminalText } from "../ansi.js";
import type { ScreenBuffer } from "../buffer.js";
import type { ComposerState } from "../composer.js";
import { graphemes, graphemeWidth, truncateToWidth } from "../terminal-width.js";
import type { CellStyle, DashboardStats, DashboardWorkStatus, OutputItem, Rect } from "../types.js";
import { renderOutputPane } from "./output-pane.js";
import { formatElapsed, formatNumber } from "./stats-pane.js";
import type { FooterHint } from "./footer.js";

export type RunViewOptions = {
  title: string;
  stats: DashboardStats;
  output: OutputItem[];
  scrollOffset: number;
  composer?: ComposerState;
  submitting?: boolean;
  showQueue?: boolean;
  showDetails?: boolean;
  workOffset?: number;
  feedback?: string;
  hints?: FooterHint[];
};

export function renderRunView(buffer: ScreenBuffer, options: RunViewOptions): {
  scrollOffset: number;
  outputRect: Rect;
  workOffset: number;
  cursor?: { x: number; y: number };
} {
  const { stats } = options;
  const composer = options.showQueue && !options.composer?.focused ? undefined : options.composer;
  const run = stats.run;
  const theme = getTheme().styles;
  const width = Math.max(0, Math.min(164, buffer.width - 4));
  const x = Math.max(0, Math.floor((buffer.width - width) / 2));
  const sidebarWidth = !options.showQueue && width >= 106 ? Math.min(40, Math.floor(width * 0.29)) : 0;
  const transcriptWidth = Math.max(0, width - (sidebarWidth > 0 ? sidebarWidth + 3 : 0));
  const queue = run?.queue ?? [];
  const plans = queue.filter((item) => item.kind === "plan");
  const activePlanIndex = Math.max(0, plans.findIndex((item) => item.id === run?.activePlanId));
  const activePlan = plans[activePlanIndex];
  const nextPlan = plans[activePlanIndex + 1];
  const progress = plans.length > 0 ? ` · Plan ${activePlanIndex + 1}/${plans.length}` : "";
  put(buffer, { x, y: 0, width, height: 1 }, 0, `${options.title}${progress}`, { bold: true });
  const context = [run?.agent, run?.model ?? (run?.agent ? "default model" : undefined), run?.cwd].filter(Boolean).join(" · ");
  put(buffer, { x, y: 1, width, height: 1 }, 0, context, theme.muted);

  const draft = composer ? wrapDraft(composer, Math.max(1, transcriptWidth - 3)) : undefined;
  const inputLines = draft ? Math.min(3, draft.lines.length) : 0;
  const composerHeight = composer ? inputLines + 3 : 0;
  const footerY = Math.max(0, buffer.height - 1);
  const composerY = Math.max(3, footerY - composerHeight);
  const contentBottom = composer ? composerY - 1 : footerY - 1;
  let outputY = 3;

  if (sidebarWidth === 0) {
    if (activePlan?.kind === "plan") {
      put(buffer, { x, y: outputY++, width, height: 1 }, 0,
        `${marker(activePlan.status)} ${activePlanIndex + 1}. ${basename(activePlan.path)}`, { bold: true });
    }
    if (nextPlan?.kind === "plan" && !options.showQueue) {
      put(buffer, { x, y: outputY++, width, height: 1 }, 0,
        `○ ${activePlanIndex + 2}. ${basename(nextPlan.path)} · next`, theme.muted);
    }
  }

  const tasks = run?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === "completed").length;
  const taskCount = tasks.length > 0 ? `${completed}/${tasks.length} tasks` : `${stats.iterationsLabel ?? "Iterations"} ${stats.iterations}`;
  const step = run?.activeStep ? truncateToWidth(plainTerminalText(run.activeStep), Math.max(8, Math.floor(transcriptWidth / 4))) : undefined;
  const progressLabel = [step, taskCount].filter(Boolean).join(" · ");
  const phase = truncateToWidth(plainTerminalText(run?.phase ?? stats.currentAction ?? stats.status), Math.max(8, transcriptWidth - progressLabel.length - 7));
  const statusMarker = { running: "●", error: "!", paused: "Ⅱ", idle: "○", done: "✓" }[stats.status];
  put(buffer, { x, y: outputY++, width: transcriptWidth, height: 1 }, 0,
    `${statusMarker} ${phase} · ${progressLabel}${run?.activity ? ` · ${run.activity}` : ""}`, stats.status === "error" ? theme.error : { bold: true });
  outputY++;
  const outputRect: Rect = { x, y: outputY, width: transcriptWidth, height: Math.max(0, contentBottom - outputY) };
  let scrollOffset = options.scrollOffset;
  let workOffset = options.workOffset ?? 0;
  if (options.showQueue) {
    workOffset = renderWorkList(buffer, outputRect, stats, workOffset);
  } else {
    scrollOffset = renderOutputPane(buffer, outputRect, options.output, options.scrollOffset, {
      conversation: true, details: options.showDetails
    });
  }

  if (sidebarWidth > 0) {
    const sidebarX = x + transcriptWidth + 3;
    const sidebarHeight = Math.max(0, contentBottom - 3);
    for (let row = 3; row < contentBottom; row++) buffer.put(sidebarX - 2, row, "│", theme.muted);
    renderWorkPanel(buffer, { x: sidebarX, y: 3, width: sidebarWidth, height: sidebarHeight }, stats);
  }

  const usage = stats.usageAvailable === false || (stats.usageAvailable === undefined && stats.tokensIn + stats.tokensOut === 0)
    ? "Usage unavailable" : `${formatNumber(stats.tokensIn + stats.tokensOut)} tokens`;
  const pendingMessages = queue.filter((item) => item.kind === "message" && item.status === "pending").length;
  const metrics = `${formatElapsed(stats.elapsedMs)} · ${usage}${pendingMessages ? ` · ${pendingMessages} message${pendingMessages === 1 ? "" : "s"} queued` : ""}${scrollOffset > 0 && !options.showQueue ? " · History paused" : ""}`;
  put(buffer, { x, y: Math.max(outputY, contentBottom), width: transcriptWidth, height: 1 }, 0, metrics, theme.muted);

  let cursor: { x: number; y: number } | undefined;
  if (composer && draft) {
    const rect = { x, y: composerY, width: transcriptWidth, height: composerHeight };
    const target = plans.find((plan) => plan.id === composer.afterPlanId) ?? activePlan;
    const label = composer.kind === "plan" ? "ADD PLAN · joins the end of the queue"
      : `AFTER ${target?.kind === "plan" ? basename(target.path) : "CURRENT PLAN"}`;
    put(buffer, rect, 0, "─".repeat(transcriptWidth), theme.muted);
    put(buffer, rect, 1, options.submitting ? "Adding to queue…" : label, theme.muted);
    const start = Math.max(0, Math.min(draft.cursor.y - inputLines + 1, draft.lines.length - inputLines));
    for (let index = 0; index < inputLines; index++) {
      const text = composer.text.length === 0
        ? composer.kind === "plan" ? "docs/plans/next-plan.md" : "Queue a message for this plan…"
        : draft.lines[start + index] ?? "";
      put(buffer, rect, index + 2, `${index === 0 ? "›" : " "}  ${text}`, composer.text.length === 0 ? theme.muted : {});
    }
    if (composer.error) put(buffer, rect, composerHeight - 1, composer.error, theme.error);
    else if (options.feedback) put(buffer, rect, composerHeight - 1, options.feedback, theme.success);
    if (composer.focused && !options.submitting) cursor = {
      x: Math.min(buffer.width - 1, x + 3 + draft.cursor.x),
      y: Math.min(footerY - 1, composerY + 2 + draft.cursor.y - start)
    };
  }

  const hint = composer?.focused
    ? composer.kind === "plan" ? "Enter Queue plan  Ctrl+P Message  Esc Browse"
      : "Enter Queue  Alt+Enter Newline  Ctrl+P Plan  Alt+↑↓ Target  Esc Browse"
    : options.showQueue ? "↑↓ Scroll  PgUp/PgDn Page  Home/End Jump  v Activity  i Message  q Quit"
      : options.hints ? options.hints.map((hint) => `${hint.key} ${hint.label}`).join("  ")
      : width < 100 ? "i Message  p Plan  v Tasks  d Details  ↑↓ Scroll  f Follow  q Quit"
      : "i Message  p Add plan  v Tasks & plans  d Details  ↑↓ Scroll  f Follow  q Quit";
  put(buffer, { x, y: footerY, width, height: 1 }, 0, hint, theme.muted);
  return { scrollOffset, workOffset, outputRect, ...(cursor ? { cursor } : {}) };
}

function renderWorkList(buffer: ScreenBuffer, rect: Rect, stats: DashboardStats, requestedOffset: number): number {
  const theme = getTheme().styles;
  const queue = stats.run?.queue ?? [];
  const tasks = stats.run?.tasks ?? [];
  const lines: Array<{ text: string; style: CellStyle; parent?: string }> = [];
  lines.push({ text: `PLANS · ${queue.filter((item) => item.kind === "plan").length}`, style: { bold: true } });
  let planNumber = 0;
  let parentPlan: string | undefined;
  for (const item of queue) {
    if (item.kind === "plan") parentPlan = displayPlanPath(item.path, stats.run?.cwd);
    const text = item.kind === "plan" ? `${++planNumber}. ${parentPlan}` : `  └ ${item.text}`;
    lines.push({ text: `${marker(item.status)} ${text}`, style: tone(item.status), ...(item.kind === "message" ? { parent: `After ${parentPlan}` } : {}) });
  }
  lines.push({ text: "", style: {} }, { text: `TASKS · ${tasks.filter((task) => task.status === "completed").length}/${tasks.length}`, style: { bold: true } });
  for (const [index, task] of tasks.entries()) {
    const active = task.id === stats.run?.activeTaskId && stats.status === "running";
    const status = active ? "running" : task.status;
    lines.push({ text: `${marker(status)} ${index + 1}. ${task.title}`, style: tone(status) });
    for (const step of task.steps ?? []) {
      const status = active && step.name === stats.run?.activeStep ? "running" : step.status;
      lines.push({ text: `    ${marker(status)} ${step.name}`, style: tone(status), parent: `${index + 1}. ${task.title}` });
    }
  }
  const capacity = Math.max(0, rect.height - 2);
  const offset = Math.max(0, Math.min(requestedOffset, lines.length - capacity));
  if (offset > 0) put(buffer, rect, 0, `↑ earlier · ${lines[offset]?.parent ?? "tasks and plans"}`, theme.muted);
  for (let row = 0; row < capacity; row++) {
    const line = lines[offset + row];
    if (line) put(buffer, rect, row + 1, line.text, line.style);
  }
  if (offset + capacity < lines.length) put(buffer, rect, rect.height - 1, "↓ more tasks and plans", theme.muted);
  return offset;
}

function renderWorkPanel(buffer: ScreenBuffer, rect: Rect, stats: DashboardStats): void {
  const theme = getTheme().styles;
  const queue = stats.run?.queue ?? [];
  const tasks = stats.run?.tasks ?? [];
  const plans = queue.filter((item) => item.kind === "plan");
  const planIndex = Math.max(0, plans.findIndex((item) => item.id === stats.run?.activePlanId));
  let row = 0;
  put(buffer, rect, row++, `PLANS · ${plans.length > 0 ? planIndex + 1 : 0}/${plans.length}`, { bold: true });
  const planRows = Math.min(Math.max(3, Math.floor(rect.height * .4)), Math.max(0, rect.height - 4));
  const runningIndex = queue.findIndex((item) => item.status === "running");
  const activeIndex = Math.max(0, runningIndex >= 0 ? runningIndex : queue.findIndex((item) => item.id === stats.run?.activePlanId));
  const queueStart = Math.max(0, Math.min(activeIndex, queue.length - Math.max(1, planRows - 2)));
  if (queueStart > 0) {
    const first = queue[queueStart];
    const parent = first?.kind === "message" ? plans.find((plan) => plan.id === first.afterPlanId) : undefined;
    put(buffer, rect, row++, parent ? `↑ After ${basename(parent.path)}` : `↑ ${queueStart} earlier`, theme.muted);
  }
  let queueIndex = queueStart;
  for (; queueIndex < queue.length && row < planRows; queueIndex++) {
    const item = queue[queueIndex]!;
    const number = item.kind === "plan" ? plans.findIndex((plan) => plan.id === item.id) + 1 : undefined;
    const text = item.kind === "plan" ? `${number}. ${basename(item.path)}` : `  └ ${item.text}`;
    put(buffer, rect, row++, `${marker(item.status)} ${text}`, tone(item.status));
  }
  if (queueIndex < queue.length) put(buffer, rect, row++, "  ↓ more queued work", theme.muted);
  row++;
  if (tasks.length === 0) {
    put(buffer, rect, row++, "TASKS", { bold: true });
    put(buffer, rect, row, "Waiting for plan details…", theme.muted);
    return;
  }
  const done = tasks.filter((task) => task.status === "completed").length;
  put(buffer, rect, row++, `TASKS · ${done}/${tasks.length}`, { bold: true });
  const active = tasks.findIndex((task) => task.id === stats.run?.activeTaskId);
  const pending = tasks.findIndex((task) => task.status !== "completed");
  const focus = active >= 0 ? active : Math.max(0, pending);
  const capacity = Math.max(1, rect.height - row - 1);
  const start = Math.max(0, Math.min(focus - 1, tasks.length - capacity));
  if (start > 0) put(buffer, rect, row++, `  ↑ ${start} earlier tasks`, theme.muted);
  for (let index = start; index < tasks.length && row < rect.height; index++) {
    if (row === rect.height - 1 && index < tasks.length - 1) {
      put(buffer, rect, row, "  ↓ more tasks · v View all", theme.muted);
      break;
    }
    const task = tasks[index]!;
    const isActive = task.id === stats.run?.activeTaskId;
    const status = isActive && stats.status === "running" ? "running" : task.status;
    put(buffer, rect, row++, `${marker(status)} ${index + 1}. ${task.title}`, tone(status));
    if (isActive && task.steps && row < rect.height - (index < tasks.length - 1 ? 1 : 0)) {
      const steps = task.steps.map((step) => `${step.name === stats.run?.activeStep ? "›" : marker(step.status)} ${step.name}`).join("  ");
      put(buffer, rect, row++, `  ${steps}`, theme.muted);
    }
  }
}

function marker(status: DashboardWorkStatus): string {
  return ({ completed: "✓", running: "›", failed: "!", cancelled: "×", paused: "Ⅱ", pending: "○" })[status];
}

function tone(status: DashboardWorkStatus): CellStyle {
  const theme = getTheme().styles;
  if (status === "running") return { ...theme.info, bold: true };
  if (status === "failed") return theme.error;
  return theme.muted;
}

function basename(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function displayPlanPath(value: string, cwd?: string): string {
  if (!cwd) return value;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function put(buffer: ScreenBuffer, rect: Rect, row: number, text: string, style: CellStyle): void {
  if (row < 0 || row >= rect.height || rect.y + row >= buffer.height) return;
  buffer.putInRect(rect, row, truncateToWidth(plainTerminalText(text), rect.width), style);
}

function wrapDraft(state: ComposerState, width: number): { lines: string[]; cursor: { x: number; y: number } } {
  const lines = [""];
  let column = 0;
  let offset = 0;
  let cursor = { x: 0, y: 0 };
  for (const segment of graphemes(state.text)) {
    const cells = segment === "\t" ? 2 : graphemeWidth(segment);
    if (segment !== "\n" && column + cells > width) { lines.push(""); column = 0; }
    if (offset === state.cursor) cursor = { x: column, y: lines.length - 1 };
    if (segment === "\n") { lines.push(""); column = 0; }
    else { lines[lines.length - 1] += segment === "\t" ? "  " : segment; column += cells; }
    offset += segment.length;
  }
  if (offset === state.cursor) {
    if (column >= width) { lines.push(""); column = 0; }
    cursor = { x: column, y: lines.length - 1 };
  }
  return { lines, cursor };
}
