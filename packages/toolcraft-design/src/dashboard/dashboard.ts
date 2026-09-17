import { createRenderPerformanceMonitor, formatRenderPerformance, type RenderPerformanceSnapshot } from "../render-performance.js";
import { createLogger } from "../components/logger.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { ScreenBuffer, diff } from "./buffer.js";
import { renderContextPane } from "./components/context-pane.js";
import { renderBorder } from "./components/border.js";
import { defaultHints, renderFooter } from "./components/footer.js";
import type { FooterHint } from "./components/footer.js";
import { renderOutputPane } from "./components/output-pane.js";
import { renderRunView } from "./components/run-view.js";
import { createComposerState, editComposer, type DashboardSubmission, type ComposerState } from "./composer.js";
import { renderCompactStatsPane, renderStatsPane } from "./components/stats-pane.js";
import { createKeymap } from "./keymap.js";
import { computeDashboardLayout } from "./layout.js";
import { createStore } from "./store.js";
import { createTerminalDriver } from "./terminal.js";
import type { DashboardStore } from "./store.js";
import type { Command, DashboardStats, OutputItem, Rect } from "./types.js";

const DEFAULT_TITLE = "Output";
const DEFAULT_STATS_TITLE = "Stats";
const DEFAULT_RIGHT_PANE_WIDTH = 25;

export type DashboardOptions = {
  title?: string;
  statsTitle?: string;
  keymap?: Partial<Record<Command, string[]>>;
  rightPaneWidth?: number;
  hints?: FooterHint[];
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  appearance?: "panels" | "conversation";
  /** Resolves once the runtime accepts the input; rejection keeps the draft editable. */
  onSubmit?: (submission: DashboardSubmission) => void | Promise<void>;
  /** Observe bounded performance snapshots without forcing idle repaints. */
  onPerformance?: (stats: RenderPerformanceSnapshot) => void;
};

export type Dashboard = {
  start(): void;
  stop(): void;
  appendOutput(item: OutputItem): void;
  updateStats(stats: Partial<DashboardStats>): void;
  onCommand(handler: (cmd: Command) => void): void;
  destroy(): void;
  getPerformance(): RenderPerformanceSnapshot;
};

export function createDashboard(opts: DashboardOptions = {}): Dashboard {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const resolveCommand = createKeymap(opts.keymap);
  const footerHints = opts.hints ?? defaultHints();
  const title = opts.title ?? DEFAULT_TITLE;
  const statsTitle = opts.statsTitle ?? DEFAULT_STATS_TITLE;
  const rightPaneWidth = opts.rightPaneWidth ?? DEFAULT_RIGHT_PANE_WIDTH;
  const conversation = opts.appearance === "conversation" || opts.onSubmit !== undefined;
  const commandHandlers = new Set<(cmd: Command) => void>();
  const fallbackLogger = createLogger((message) => {
    stdout.write(`${message}\n`);
  });
  let driver: ReturnType<typeof createTerminalDriver> | undefined;
  let store: DashboardStore | undefined;
  let previousBuffer = new ScreenBuffer(0, 0);
  let unsubscribeStore: (() => void) | undefined;
  let unsubscribeKeypress: (() => void) | undefined;
  let unsubscribeResize: (() => void) | undefined;
  let started = false;
  let destroyed = false;
  const performanceMonitor = createRenderPerformanceMonitor();
  let showPerformance = false;
  let scrollOffset = 0;
  let outputViewportHeight = 0;
  let heldOutput: OutputItem[] | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let composer: ComposerState | undefined = opts.onSubmit ? createComposerState("message") : undefined;
  let otherDraft = createComposerState("plan");
  let submitting = false;
  let showQueue = false;
  let workOffset: number | undefined = 0;
  let feedback: string | undefined;
  let showDetails = false;
  let lastActivePlanId: string | undefined;
  let outputRect: Rect | undefined;

  function appendOutput(item: OutputItem): void {
    if (destroyed) {
      return;
    }

    if (!isTerminalMode()) {
      writeFallbackOutput(item);
      return;
    }

    getStore().appendOutput(item);
  }

  function updateStats(stats: Partial<DashboardStats>): void {
    if (destroyed || !isTerminalMode()) {
      return;
    }

    getStore().updateStats(stats);
  }

  function start(): void {
    if (destroyed || started || !isTerminalMode()) {
      return;
    }

    driver = createTerminalDriver({ stdin, stdout });
    started = true;
    previousBuffer = new ScreenBuffer(0, 0);

    driver.enterRawMode();
    driver.enterAltScreen();
    driver.disableLineWrap();
    driver.hideCursor();
    if (opts.onSubmit) driver.write("\u001b[?2004h");

    render();

    const activeStore = getStore();
    let previousStats = activeStore.getState().stats;
    let lastStatsPaint = -Infinity;
    unsubscribeStore = activeStore.onChange(() => {
      performanceMonitor.request("update");
      const stats = activeStore.getState().stats;
      if (stats !== previousStats) {
        const statusChanged = stats.status !== previousStats.status;
        previousStats = stats;
        if (statusChanged || Date.now() - lastStatsPaint >= 16) {
          lastStatsPaint = Date.now();
          render();
        } else {
          renderTimer ??= setTimeout(render, 16);
        }
      } else if (heldOutput === undefined && renderTimer === undefined) {
        renderTimer = setTimeout(render, 16);
      }
    });
    unsubscribeKeypress = driver.onKeypress((event) => {
      performanceMonitor.request("input");
      if (composer && !(event.ctrl && event.name === "c")) {
        if (submitting) return;
        if (event.ctrl && event.name === "p") {
          [composer, otherDraft] = [otherDraft, composer];
          composer.focused = true;
          render();
          return;
        }
        if (composer.focused && event.meta && (event.name === "up" || event.name === "down")) {
          const run = getStore().getState().stats.run;
          const plans = run?.queue?.filter((item) => item.kind === "plan") ?? [];
          const activeIndex = Math.max(0, plans.findIndex((item) => item.id === run?.activePlanId));
          const available = plans.slice(activeIndex);
          if (available.length > 0) {
            const index = available.findIndex((item) => item.id === composer!.afterPlanId);
            const next = index < 0 ? 0 : (index + (event.name === "up" ? -1 : 1) + available.length) % available.length;
            composer = { ...composer, afterPlanId: available[next]!.id };
            render();
          }
          return;
        }
        if (!composer.focused && (event.ch === "i" || event.ch === "p" || event.name === "return")) {
          const kind = event.ch === "p" ? "plan" : "message";
          if (composer.kind !== kind) [composer, otherDraft] = [otherDraft, composer];
          composer.focused = true;
          render();
          return;
        }
        const edit = editComposer(composer, event);
        if (edit.handled) {
          feedback = undefined;
          composer = edit.state;
          if (edit.submit) {
            const submission = edit.submit;
            submitting = true;
            render();
            void (async () => {
              try {
                await opts.onSubmit!(submission);
                composer = createComposerState(submission.kind, submission.afterPlanId);
                feedback = submission.kind === "plan" ? "Plan queued" : "Message queued";
              } catch (error) {
                composer = { ...composer!, error: error instanceof Error ? error.message : String(error) };
              } finally {
                submitting = false;
                render();
              }
            })();
          } else {
            renderTimer ??= setTimeout(render, 16);
          }
          return;
        }
      }
      if (conversation && !composer?.focused && (event.ch === "v" || event.ch === "d")) {
        if (event.ch === "v") {
          showQueue = !showQueue;
          if (showQueue) workOffset = undefined;
        }
        else showDetails = !showDetails;
        render();
        return;
      }
      if (showQueue && !composer?.focused && event.name === "home") {
        workOffset = 0;
        render();
        return;
      }
      const command = resolveCommand(event);

      if (command === undefined) {
        return;
      }

      if (command === "render-stats") {
        showPerformance = !showPerformance;
        render();
        return;
      }
      if (command === "follow") {
        if (showQueue) {
          workOffset = event.name === "end" ? Number.MAX_SAFE_INTEGER : undefined;
          render();
          return;
        }
        heldOutput = undefined;
        scrollOffset = 0;
        render();
        return;
      }
      if (
        command === "scroll-up" ||
        command === "scroll-down" ||
        command === "page-up" ||
        command === "page-down"
      ) {
        const page = Math.max(1, outputRect?.height ?? outputViewportHeight);
        const amount = command === "page-up" || command === "page-down" ? page : 1;
        const direction = command === "scroll-up" || command === "page-up" ? 1 : -1;
        if (showQueue) {
          workOffset = Math.max(0, (workOffset ?? 0) - amount * direction);
          renderTimer ??= setTimeout(render, 16);
          return;
        }
        if (direction > 0) heldOutput ??= getStore().getState().output;
        scrollOffset = Math.max(0, scrollOffset + amount * direction);
        if (scrollOffset === 0) heldOutput = undefined;
        renderTimer ??= setTimeout(render, 16);
        return;
      }

      emitCommand(command);
    });
    unsubscribeResize = driver.onResize(() => {
      performanceMonitor.request("resize");
      previousBuffer = new ScreenBuffer(0, 0);
      driver?.write("\u001b[2J");
      render();
    });
  }

  function stop(): void {
    clearTimeout(renderTimer);
    renderTimer = undefined;
    unsubscribeStore?.();
    unsubscribeKeypress?.();
    unsubscribeResize?.();
    unsubscribeStore = undefined;
    unsubscribeKeypress = undefined;
    unsubscribeResize = undefined;

    if (driver === undefined) {
      started = false;
      return;
    }

    if (opts.onSubmit) driver.write("\u001b[?2004l");
    driver.destroy();
    driver = undefined;
    previousBuffer = new ScreenBuffer(0, 0);
    started = false;
  }

  function onCommand(handler: (cmd: Command) => void): void {
    if (destroyed) {
      return;
    }

    commandHandlers.add(handler);
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }

    stop();
    commandHandlers.clear();
    store = undefined;
    destroyed = true;
  }

  function getStore(): DashboardStore {
    store ??= createStore();
    return store;
  }

  function render(): void {
    clearTimeout(renderTimer);
    renderTimer = undefined;
    if (driver === undefined) {
      return;
    }

    const startedAt = performanceMonitor.begin();
    const { cols, rows } = driver.getSize();
    const state = getStore().getState();
    const layout = computeDashboardLayout({
      totalWidth: cols,
      totalHeight: rows,
      rightPaneWidth,
      footerHeight: state.stats.session ? 2 : 1
    });

    const nextBuffer = new ScreenBuffer(cols, rows);

    let cursor: { x: number; y: number } | undefined;
    if (conversation) {
      const activePlanId = state.stats.run?.activePlanId;
      if (composer && (composer.afterPlanId === undefined ||
        (composer.text.length === 0 && composer.afterPlanId === lastActivePlanId))) {
        composer = { ...composer, afterPlanId: activePlanId };
      }
      if (otherDraft.afterPlanId === undefined ||
        (otherDraft.text.length === 0 && otherDraft.afterPlanId === lastActivePlanId)) {
        otherDraft = { ...otherDraft, afterPlanId: activePlanId };
      }
      lastActivePlanId = activePlanId;
      const view = renderRunView(nextBuffer, {
        title, stats: state.stats, output: heldOutput ?? state.output, scrollOffset,
        composer, submitting, showQueue, showDetails, workOffset, feedback, hints: opts.hints
      });
      scrollOffset = view.scrollOffset;
      workOffset = view.workOffset;
      outputRect = view.outputRect;
      cursor = view.cursor;
    } else {
      renderBorder(nextBuffer, layout, {
        leftTitle: title,
        rightTitle: statsTitle,
        style: { dim: true }
      });
      if (state.stats.context?.length) {
        const contextRect = layout.summary ?? layout.leftPane;
        // Context spans both panes on wide terminals.
        const remaining = renderContextPane(nextBuffer, {
          x: contextRect.x, y: contextRect.y, width: Math.max(0, cols - 2),
          height: layout.summary ? layout.summary.height + layout.leftPane.height : layout.leftPane.height
        }, state.stats.context);
        const height = remaining.y - contextRect.y;
        if (layout.summary) {
          layout.summary.y = remaining.y;
          layout.summary.height = Math.min(layout.summary.height, remaining.height);
          layout.leftPane.y = layout.summary.y + layout.summary.height;
          layout.leftPane.height = Math.max(0, remaining.height - layout.summary.height);
        } else {
          layout.leftPane.y += height;
          layout.leftPane.height -= height;
          layout.rightPane.y += height;
          layout.rightPane.height -= height;
        }
      }
      outputViewportHeight = Math.max(0, layout.leftPane.height - (showPerformance ? 1 : 0));
      scrollOffset = renderOutputPane(
        nextBuffer,
        { ...layout.leftPane, height: outputViewportHeight },
        heldOutput ?? state.output,
        scrollOffset
      );
      if (scrollOffset === 0) heldOutput = undefined;
      renderStatsPane(nextBuffer, layout.rightPane, state.stats);
      if (layout.summary) renderCompactStatsPane(nextBuffer, layout.summary, state.stats);
      renderFooter(nextBuffer, layout.footer, footerHints, state.stats.session);

    }
    if (scrollOffset === 0) heldOutput = undefined;

    const performanceRect = outputRect ?? layout.leftPane;
    if (showPerformance && performanceRect.height > 0) {
      nextBuffer.putInRect(performanceRect, performanceRect.height - 1, formatRenderPerformance(performanceMonitor.snapshot(), performanceRect.width), { dim: true });
    }
    const changes = diff(previousBuffer, nextBuffer);
    driver.flush(changes);
    if (cursor) {
      driver.moveTo(cursor.x, cursor.y);
      driver.showCursor();
    } else {
      driver.hideCursor();
    }
    performanceMonitor.end(startedAt, { changedCells: changes.length });
    opts.onPerformance?.(performanceMonitor.snapshot());
    previousBuffer = nextBuffer;
  }

  function emitCommand(command: Command): void {
    for (const handler of commandHandlers) {
      handler(command);
    }
  }

  function writeFallbackOutput(item: OutputItem): void {
    if (item.kind === "success") {
      fallbackLogger.success(item.text);
      return;
    }

    if (item.kind === "error") {
      fallbackLogger.error(item.text);
      return;
    }

    if (item.kind === "tool") {
      fallbackLogger.message(item.text);
      return;
    }

    fallbackLogger.info(item.text);
  }

  return {
    start,
    stop,
    appendOutput,
    updateStats,
    onCommand,
    getPerformance: performanceMonitor.snapshot,
    destroy
  };
}

function isTerminalMode(): boolean {
  return resolveOutputFormat() === "terminal";
}
