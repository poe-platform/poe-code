import type { DashboardState, DashboardStats, OutputItem } from "./types.js";

const MAX_RETAINED_OUTPUT = 256;

export type DashboardStore = {
  getState(): DashboardState;
  appendOutput(item: OutputItem): void;
  updateStats(partial: Partial<DashboardStats>): void;
  onChange(handler: () => void): () => void;
};

export function createStore(): DashboardStore {
  let state: DashboardState = {
    output: [],
    stats: {
      status: "idle",
      iterations: 0,
      tokensIn: 0,
      tokensOut: 0,
      elapsedMs: 0
    }
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
    const next = state.output.length >= MAX_RETAINED_OUTPUT
      ? [...state.output.slice(state.output.length - MAX_RETAINED_OUTPUT + 1), item]
      : [...state.output, item];

    state = { ...state, output: next };
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
    onChange
  };
}
