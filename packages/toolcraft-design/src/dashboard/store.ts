import { limitOutputPreview } from "./output-preview.js";
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
    const preview = limitOutputPreview(item.text);
    const retainedItem = preview === item.text ? item : { ...item, text: preview };
    const existing = item.id === undefined ? -1 : state.output.findIndex((entry) => entry.id === item.id);
    const next = existing !== -1
      ? state.output.map((entry, index) => index === existing ? retainedItem : entry)
      : state.output.length >= MAX_RETAINED_OUTPUT
        ? [...state.output.slice(state.output.length - MAX_RETAINED_OUTPUT + 1), retainedItem]
        : [...state.output, retainedItem];

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
