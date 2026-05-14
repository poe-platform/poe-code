import { describe, expect, it } from "vitest";
import { buildExplorerDemoConfig, parseExplorerDemoOptions } from "./demo.js";

describe("explorer demo", () => {
  it("defaults to single-detail mode and allows args to override env", () => {
    expect(parseExplorerDemoOptions([], {})).toEqual({
      mode: "single-detail-mode",
      slowDetail: false
    });

    expect(parseExplorerDemoOptions(["--mode", "list-detail-mode"], {
      EXPLORER_DEMO_MODE: "single-detail-mode",
      EXPLORER_DEMO_SLOW_DETAIL: "1"
    })).toEqual({
      mode: "list-detail-mode",
      slowDetail: true
    });
  });

  it("builds a multi-select reorderable single-detail config", async () => {
    const orderedIds: string[][] = [];
    const config = buildExplorerDemoConfig({
      mode: "single-detail-mode",
      slowDetail: false,
      onReorder: async (ids) => {
        orderedIds.push(ids);
      }
    });

    const rows = await config.rows();
    const detailItems = await config.detail.items(rows[0]!, detailCtx(rows[0]!));

    expect(config.title).toBe("Explorer Demo - single-detail-mode");
    expect(config.multiSelect).toBe(true);
    expect(config.reorder).toBeDefined();
    await config.reorder?.onReorder(rows.map((row) => row.id).reverse());
    expect(orderedIds).toEqual([rows.map((row) => row.id).reverse()]);
    expect(detailItems).toHaveLength(1);
    expect(detailItems[0]?.title).toBeUndefined();
    expect(detailItems[0]?.render(detailCtx(rows[0]!))).toContain("# Configure commands");
  });

  it("builds list-detail PR review items with titles", async () => {
    const config = buildExplorerDemoConfig({
      mode: "list-detail-mode",
      slowDetail: false
    });

    const rows = await config.rows();
    const detailItems = await config.detail.items(rows[0]!, detailCtx(rows[0]!));

    expect(config.title).toBe("Explorer Demo - list-detail-mode");
    expect(detailItems.length).toBeGreaterThan(1);
    expect(detailItems.every((item) => item.title !== undefined)).toBe(true);
    expect(detailItems[0]?.title).toContain("Review");
    expect(detailItems[0]?.render(detailCtx(rows[0]!))).toContain("provider");
  });
});

function detailCtx(row: { id: string; title: string }) {
  return {
    width: 80,
    height: 24,
    signal: new AbortController().signal,
    row
  };
}
