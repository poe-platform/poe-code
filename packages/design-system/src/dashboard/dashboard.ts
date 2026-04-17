import { createLogger } from "../components/logger.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { ScreenBuffer, diff } from "./buffer.js";
import { renderBorder } from "./components/border.js";
import { defaultHints, renderFooter } from "./components/footer.js";
import type { FooterHint } from "./components/footer.js";
import { renderOutputPane } from "./components/output-pane.js";
import { renderStatsPane } from "./components/stats-pane.js";
import { createKeymap } from "./keymap.js";
import { computeDashboardLayout } from "./layout.js";
import { createStore } from "./store.js";
import { createTerminalDriver } from "./terminal.js";
import type { DashboardStore } from "./store.js";
import type { Command, DashboardStats, OutputItem } from "./types.js";

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
};

export type Dashboard = {
  start(): void;
  stop(): void;
  appendOutput(item: OutputItem): void;
  updateStats(stats: Partial<DashboardStats>): void;
  onCommand(handler: (cmd: Command) => void): void;
  destroy(): void;
};

export function createDashboard(opts: DashboardOptions = {}): Dashboard {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const resolveCommand = createKeymap(opts.keymap);
  const footerHints = opts.hints ?? defaultHints();
  const title = opts.title ?? DEFAULT_TITLE;
  const statsTitle = opts.statsTitle ?? DEFAULT_STATS_TITLE;
  const rightPaneWidth = opts.rightPaneWidth ?? DEFAULT_RIGHT_PANE_WIDTH;
  const commandHandlers = new Set<(cmd: Command) => void>();
  const fallbackLogger = createLogger((message) => {
    stdout.write(`${message}\n`);
  });
  let driver: ReturnType<typeof createTerminalDriver> | undefined;
  let store: DashboardStore | undefined;
  let currentLayout = computeDashboardLayout({
    totalWidth: 0,
    totalHeight: 0,
    rightPaneWidth
  });
  let previousBuffer = new ScreenBuffer(0, 0);
  let unsubscribeStore: (() => void) | undefined;
  let unsubscribeKeypress: (() => void) | undefined;
  let unsubscribeResize: (() => void) | undefined;
  let started = false;
  let destroyed = false;

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

    render();

    const activeStore = getStore();
    unsubscribeStore = activeStore.onChange(() => {
      render();
    });
    unsubscribeKeypress = driver.onKeypress((event) => {
      const command = resolveCommand(event);

      if (command === undefined) {
        return;
      }

      if (isScrollCommand(command)) {
        activeStore.dispatch(command, currentLayout.leftPane.height);
        return;
      }

      emitCommand(command);
    });
    unsubscribeResize = driver.onResize(() => {
      render();
    });
  }

  function stop(): void {
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
    if (driver === undefined) {
      return;
    }

    const { cols, rows } = driver.getSize();
    currentLayout = computeDashboardLayout({
      totalWidth: cols,
      totalHeight: rows,
      rightPaneWidth
    });

    const nextBuffer = new ScreenBuffer(cols, rows);
    const state = getStore().getState();

    renderBorder(nextBuffer, currentLayout, {
      leftTitle: title,
      rightTitle: statsTitle,
      style: { dim: true }
    });
    renderOutputPane(nextBuffer, currentLayout.leftPane, {
      items: state.output,
      scrollOffset: state.outputScroll,
      autoFollow: state.autoFollow
    });
    renderStatsPane(nextBuffer, currentLayout.rightPane, state.stats);
    renderFooter(nextBuffer, currentLayout.footer, footerHints);

    driver.flush(diff(previousBuffer, nextBuffer));
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
    destroy
  };
}

function isTerminalMode(): boolean {
  return resolveOutputFormat() === "terminal";
}

function isScrollCommand(command: Command): boolean {
  return command === "scrollUp"
    || command === "scrollDown"
    || command === "pageUp"
    || command === "pageDown"
    || command === "scrollToTop"
    || command === "scrollToBottom";
}
