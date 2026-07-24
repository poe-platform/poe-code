import type { Detail, DetailCtx, Row } from "./state.js";

export { runExplorer } from "./runtime.js";
export { createInitialState, normalizeExplorerConfig } from "./state.js";
export { resolveBindings } from "./keymap.js";
export type { Effect, ExplorerEvent } from "./events.js";
export type {
  BindingTarget,
  ExplorerBindingDefaults,
  ExplorerBuiltinCommand,
  ResolvedBindings
} from "./keymap.js";
export type {
  Action,
  ActionContext,
  Detail,
  DetailCtx,
  DetailItem,
  Dirty,
  ExplorerConfig,
  PaneConfig,
  ListPaneConfig,
  DetailPaneConfig,
  PaneRuntimeState,
  ExplorerLayoutMode,
  ExplorerSize,
  ExplorerState,
  ReorderContext,
  Row,
  Tone
} from "./state.js";

export function singleDetail<R>(
  fn: (row: Row, ctx: DetailCtx) => string | Promise<string>
): Detail<R> {
  return {
    items: async (row) => [{ id: row.id, render: ctx => fn(row, ctx) }]
  };
}
