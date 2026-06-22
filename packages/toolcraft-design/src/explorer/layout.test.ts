import { describe, expect, it } from "vitest";
import { computeExplorerLayout, type ExplorerLayout } from "./layout.js";

function expectFullWidthBands(layout: ExplorerLayout, cols: number, rows: number): void {
  expect(layout.header).toMatchObject({ x: 0, y: 0, width: cols });
  expect(layout.footer).toMatchObject({ x: 0, width: cols });
  expect(
    layout.header.height + layout.list.height + layout.detail.height + layout.footer.height
  ).toBe(rows);
}

function expectAreaCoversViewport(
  layout: ExplorerLayout,
  cols: number,
  rows: number,
  gutterArea = 0
): void {
  const area =
    layout.header.width * layout.header.height +
    layout.list.width * layout.list.height +
    layout.detail.width * layout.detail.height +
    layout.footer.width * layout.footer.height;

  expect(area + gutterArea).toBe(cols * rows);
}

describe("computeExplorerLayout", () => {
  it("uses too-narrow mode below 40 columns", () => {
    const layout = computeExplorerLayout({ cols: 39, rows: 12 });

    expect(layout.mode).toBe("too-narrow");
    expect(layout.header).toEqual({ x: 0, y: 0, width: 39, height: 3 });
    expect(layout.list).toEqual({ x: 0, y: 3, width: 39, height: 8 });
    expect(layout.detail).toEqual({ x: 0, y: 11, width: 0, height: 0 });
    expect(layout.footer).toEqual({ x: 0, y: 11, width: 39, height: 1 });
    expectFullWidthBands(layout, 39, 12);
  });

  it("uses narrow-list-only mode from 40 to 79 columns", () => {
    const layout = computeExplorerLayout({ cols: 79, rows: 20 });

    expect(layout.mode).toBe("narrow-list-only");
    expect(layout.list).toEqual({ x: 0, y: 3, width: 79, height: 16 });
    expect(layout.detail).toEqual({ x: 0, y: 19, width: 0, height: 0 });
    expect(layout.footer).toEqual({ x: 0, y: 19, width: 79, height: 1 });
    expectFullWidthBands(layout, 79, 20);
  });

  it("uses narrow-vertical mode from 80 to 99 columns", () => {
    const layout = computeExplorerLayout({ cols: 80, rows: 20 });

    expect(layout.mode).toBe("narrow-vertical");
    expect(layout.list).toEqual({ x: 0, y: 3, width: 80, height: 8 });
    expect(layout.detail).toEqual({ x: 0, y: 11, width: 80, height: 8 });
    expect(layout.footer).toEqual({ x: 0, y: 19, width: 80, height: 1 });
    expectFullWidthBands(layout, 80, 20);
  });

  it("uses medium mode from 100 to 119 columns", () => {
    const layout = computeExplorerLayout({ cols: 100, rows: 20 });

    expect(layout.mode).toBe("medium");
    expect(layout.list).toEqual({ x: 0, y: 3, width: 39, height: 16 });
    expect(layout.detail).toEqual({ x: 40, y: 3, width: 60, height: 16 });
    expect(layout.footer).toEqual({ x: 0, y: 19, width: 100, height: 1 });
    expect(layout.list.width + layout.detail.width).toBe(99);
    expectAreaCoversViewport(layout, 100, 20, 16);
  });

  it("uses wide mode at 120 columns and above", () => {
    const layout = computeExplorerLayout({ cols: 120, rows: 20 });

    expect(layout.mode).toBe("wide");
    expect(layout.list).toEqual({ x: 0, y: 3, width: 49, height: 16 });
    expect(layout.detail).toEqual({ x: 50, y: 3, width: 70, height: 16 });
    expect(layout.footer).toEqual({ x: 0, y: 19, width: 120, height: 1 });
    expect(layout.list.width + layout.detail.width).toBe(119);
    expectAreaCoversViewport(layout, 120, 20, 16);
  });

  it("hides detail when detailHidden is true without changing the breakpoint mode", () => {
    const layout = computeExplorerLayout({ cols: 120, rows: 20, detailHidden: true });

    expect(layout.mode).toBe("wide");
    expect(layout.list).toEqual({ x: 0, y: 3, width: 120, height: 16 });
    expect(layout.detail).toEqual({ x: 120, y: 3, width: 0, height: 16 });
    expect(layout.footer).toEqual({ x: 0, y: 19, width: 120, height: 1 });
  });

  it("keeps rects inside very short viewports", () => {
    const layout = computeExplorerLayout({ cols: 120, rows: 2 });

    expect(layout.header).toEqual({ x: 0, y: 0, width: 120, height: 1 });
    expect(layout.list).toEqual({ x: 0, y: 1, width: 49, height: 0 });
    expect(layout.detail).toEqual({ x: 50, y: 1, width: 70, height: 0 });
    expect(layout.footer).toEqual({ x: 0, y: 1, width: 120, height: 1 });
    expect(layout.header.height + layout.list.height + layout.footer.height).toBe(2);
  });

  it("floors fractional sizes and clamps negative sizes", () => {
    expect(computeExplorerLayout({ cols: 80.9, rows: 4.8 })).toMatchObject({
      mode: "narrow-vertical",
      header: { width: 80, height: 3 },
      list: { width: 80, height: 0 },
      detail: { width: 80, height: 0 },
      footer: { width: 80, height: 1 }
    });

    expect(computeExplorerLayout({ cols: -1, rows: -1 })).toEqual({
      mode: "too-narrow",
      header: { x: 0, y: 0, width: 0, height: 0 },
      list: { x: 0, y: 0, width: 0, height: 0 },
      detail: { x: 0, y: 0, width: 0, height: 0 },
      footer: { x: 0, y: 0, width: 0, height: 0 }
    });
  });

  it("treats non-finite sizes as zero", () => {
    expect(computeExplorerLayout({ cols: Number.NaN, rows: Number.POSITIVE_INFINITY })).toEqual({
      mode: "too-narrow",
      header: { x: 0, y: 0, width: 0, height: 0 },
      list: { x: 0, y: 0, width: 0, height: 0 },
      detail: { x: 0, y: 0, width: 0, height: 0 },
      footer: { x: 0, y: 0, width: 0, height: 0 }
    });
  });
});
