import {
  scrollDown,
  scrollToBottom,
  scrollToTop,
  scrollUp
} from "./components/output-pane.js";
import type { Command, DashboardState, DashboardStats, OutputItem } from "./types.js";

export type DashboardStore = {
  getState(): DashboardState;
  appendOutput(item: OutputItem): void;
  updateStats(partial: Partial<DashboardStats>): void;
  dispatch(command: Command, paneHeight: number): void;
  onChange(handler: () => void): () => void;
};

export function createStore(): DashboardStore {
  let state: DashboardState = {
    output: [],
    outputScroll: 0,
    autoFollow: true,
    stats: {
      status: "idle",
      iterations: 0,
      tokensIn: 0,
      tokensOut: 0,
      elapsedMs: 0
    },
    paused: false,
    activeDialog: { kind: "none" }
  };
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function getState(): DashboardState {
    return state;
  }

  function appendOutput(item: OutputItem): void {
    const output = [...state.output, item];

    state = {
      ...state,
      output,
      outputScroll: state.autoFollow ? Math.max(0, output.length - 1) : state.outputScroll
    };
    notify();
  }

  function updateStats(partial: Partial<DashboardStats>): void {
    state = {
      ...state,
      stats: {
        ...state.stats,
        ...partial
      }
    };
    notify();
  }

  function dispatch(command: Command, paneHeight: number): void {
    const totalVisualLines = state.output.length;
    const currentPaneState = state.autoFollow
      ? toStateFromPane(
          state,
          scrollToBottom(toPaneState(state), totalVisualLines, paneHeight)
        )
      : state;

    if (command === "scrollUp") {
      state = toStateFromPane(currentPaneState, scrollUp(toPaneState(currentPaneState), 1));
      notify();
      return;
    }

    if (command === "scrollDown") {
      state = toStateFromPane(
        currentPaneState,
        scrollDown(toPaneState(currentPaneState), 1, totalVisualLines)
      );
      notify();
      return;
    }

    if (command === "pageUp") {
      state = toStateFromPane(currentPaneState, scrollUp(toPaneState(currentPaneState), paneHeight));
      notify();
      return;
    }

    if (command === "pageDown") {
      state = toStateFromPane(
        currentPaneState,
        scrollDown(toPaneState(currentPaneState), paneHeight, totalVisualLines)
      );
      notify();
      return;
    }

    if (command === "scrollToTop") {
      state = toStateFromPane(currentPaneState, scrollToTop(toPaneState(currentPaneState)));
      notify();
      return;
    }

    if (command === "scrollToBottom") {
      state = toStateFromPane(
        currentPaneState,
        scrollToBottom(toPaneState(currentPaneState), totalVisualLines, paneHeight)
      );
      notify();
    }
  }

  function onChange(handler: () => void): () => void {
    listeners.add(handler);

    return () => {
      listeners.delete(handler);
    };
  }

  return {
    getState,
    appendOutput,
    updateStats,
    dispatch,
    onChange
  };
}

function toPaneState(state: DashboardState): {
  items: OutputItem[];
  scrollOffset: number;
  autoFollow: boolean;
} {
  return {
    items: state.output,
    scrollOffset: state.outputScroll,
    autoFollow: state.autoFollow
  };
}

function toStateFromPane(
  state: DashboardState,
  paneState: { scrollOffset: number; autoFollow: boolean }
): DashboardState {
  return {
    ...state,
    outputScroll: paneState.scrollOffset,
    autoFollow: paneState.autoFollow
  };
}
