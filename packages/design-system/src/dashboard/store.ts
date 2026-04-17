import {
  computeVisualLines,
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
  dispatch(command: Command, paneWidth: number, paneHeight: number): void;
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
    state = {
      ...state,
      output: [...state.output, item]
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

  function dispatch(command: Command, paneWidth: number, paneHeight: number): void {
    const totalVisualLines = computeVisualLines(state.output, paneWidth).length;
    // When auto-follow is on the renderer draws bottom-aligned regardless of scrollOffset.
    // Seed scrollOffset from the actual rendered position so a transition out of
    // auto-follow (e.g. pressing ↑ after F) doesn't snap the view elsewhere.
    const seededPaneState = state.autoFollow
      ? toStateFromPane(
          state,
          scrollToBottom(toPaneState(state), totalVisualLines, paneHeight)
        )
      : state;

    if (command === "scrollUp") {
      state = toStateFromPane(seededPaneState, scrollUp(toPaneState(seededPaneState), 1));
      notify();
      return;
    }

    if (command === "scrollDown") {
      state = toStateFromPane(
        seededPaneState,
        scrollDown(toPaneState(seededPaneState), 1, totalVisualLines, paneHeight)
      );
      notify();
      return;
    }

    if (command === "pageUp") {
      state = toStateFromPane(seededPaneState, scrollUp(toPaneState(seededPaneState), paneHeight));
      notify();
      return;
    }

    if (command === "pageDown") {
      state = toStateFromPane(
        seededPaneState,
        scrollDown(toPaneState(seededPaneState), paneHeight, totalVisualLines, paneHeight)
      );
      notify();
      return;
    }

    if (command === "scrollToTop") {
      state = toStateFromPane(seededPaneState, scrollToTop(toPaneState(seededPaneState)));
      notify();
      return;
    }

    if (command === "scrollToBottom") {
      state = toStateFromPane(
        seededPaneState,
        scrollToBottom(toPaneState(seededPaneState), totalVisualLines, paneHeight)
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
