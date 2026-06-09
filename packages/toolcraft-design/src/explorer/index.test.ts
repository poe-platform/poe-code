import { describe, expect, it } from "vitest";
import { runExplorer, singleDetail, type DetailCtx, type Row } from "./index.js";

describe("explorer public API", () => {
  it("wraps a render function as a single detail item", async () => {
    const row: Row = { id: "plan-1", title: "Plan 1" };
    const ctx: DetailCtx = {
      width: 80,
      height: 24,
      signal: new AbortController().signal,
      row
    };
    const detail = singleDetail((renderRow, renderCtx) => {
      expect(renderRow).toBe(row);
      expect(renderCtx).toBe(ctx);
      return `${renderRow.id}:${renderCtx.width}`;
    });

    const items = await detail.items(row, ctx);

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(row.id);
    await expect(Promise.resolve(items[0]?.render(ctx))).resolves.toBe("plan-1:80");
  });

  it("exports runExplorer as the runtime entrypoint", () => {
    expect(runExplorer).toBeTypeOf("function");
  });
});
