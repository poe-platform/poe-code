import type { Detail, DetailCtx, Row } from "./state.js";

export { runExplorer } from "./runtime.js";
export type {
  Action,
  ActionContext,
  Detail,
  DetailCtx,
  DetailItem,
  ExplorerConfig,
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
