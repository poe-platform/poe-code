import type { DashboardState, DashboardStats, OutputItem } from "./types.js";

const MAX_RETAINED_OUTPUT = 256;
const MAX_OUTPUT_ITEM_CHARS = 16_384;

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
    let retainedItem = item;
    if (item.text.length > MAX_OUTPUT_ITEM_CHARS) {
      const marker = "[Output truncated: showing latest text]\n";
      let start = item.text.length - MAX_OUTPUT_ITEM_CHARS + marker.length;
      const newline = item.text.indexOf("\n", start);
      if (newline !== -1 && newline < item.text.length - 1) start = newline + 1;
      const firstCodeUnit = item.text.charCodeAt(start);
      if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) start += 1;
      // Materialize the bounded tail so a sliced string cannot retain the full input backing store.
      const tail = item.text.slice(start).split("").join("");
      retainedItem = { ...item, text: marker + tail };
    }
    const next = state.output.length >= MAX_RETAINED_OUTPUT
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
