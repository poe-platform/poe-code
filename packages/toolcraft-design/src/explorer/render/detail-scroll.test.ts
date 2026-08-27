import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenBuffer } from "../../dashboard/buffer.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { computeExplorerLayout, type ExplorerLayout } from "../layout.js";
import type { ExplorerState } from "../state.js";
import { renderDetail } from "./detail.js";
import { dumpScreen, fixtureState } from "./test-fixtures.js";

describe("explorer detail scroll indicator", () => {
  const lines = Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`);
  let state: ExplorerState;
  let screen: ScreenBuffer;
  let layout: ExplorerLayout;

  beforeEach(() => {
    state = fixtureState({
      size: { cols: 70, rows: 14 },
      focused: "detail",
      detail: {
        rowId: "27",
        items: [{ id: "body", renderedContent: lines.join("\n"), render: () => "" }],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    });
    screen = new ScreenBuffer(state.size.cols, state.size.rows);
    layout = computeExplorerLayout({ ...state.size, focused: state.focused });
  });

  it.each([
    [0, 0, "0%"], [8, 8, "50%"], [16, 16, "100%"], [99, 16, "100%"], [-8, 0, "0%"]
  ])("shows rendered progress for blob scroll %i", (scroll, start, indicator) => {
    state.detail.scroll = scroll;

    renderDetail(state, screen, layout);

    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(output[layout.detail.y]).toContain(` ${indicator} `);
    expect(output.slice(layout.detail.y + 1, layout.detail.y + 9).map((line) => line.slice(2, -2).trim())).toEqual(
      lines.slice(start, start + 8)
    );
    expect(state.detail.scroll).toBe(scroll);
  });

  it.each(["fit", "blank", "empty", "absent"])("shows zero progress for %s content with stale scroll", (kind) => {
    state.detail.scroll = 99;
    state.detail.items = kind === "absent" ? null : kind === "empty" ? [] : [{
      id: "body", renderedContent: kind === "fit" ? lines.slice(0, 8).join("\n") : "\n\n", render: () => ""
    }];

    renderDetail(state, screen, layout);

    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(output[layout.detail.y]).toContain(" 0% ");
    if (kind === "fit") {
      expect(output[layout.detail.y + 1]).toContain("Line 1");
      expect(output[layout.detail.y + 8]).toContain("Line 8");
    }
  });

  it.each([false, true])("keeps the loading indicator with stale content=%s", (stale) => {
    state.detail.loading = true;
    state.detail.scroll = 8;
    if (!stale) state.detail.items = null;

    renderDetail(state, screen, layout);

    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(output[layout.detail.y]).toContain(" ⠋ ");
    expect(output[layout.detail.y]).not.toContain("%");
    expect(output[layout.detail.y + 1]).toContain(stale ? "Line 9" : "Loading detail...");
  });

  it.each([
    [0, 1, "50%", "Second"], [1, 1, "50%", "Second"], [2, 1, "50%", "Second"],
    [1, 0, "0%", "First"], [1, 2, "100%", "Third"],
    [1, 99, "100%", "Third"], [1, -3, "0%", "First"]
  ])("uses item-scroll bounds independently of cursor %i at scroll %i", (cursor, scroll, indicator, title) => {
    state.detail.cursor = cursor;
    state.detail.scroll = scroll;
    state.detail.items = ["First", "Second", "Third"].map((title, index) => ({
      id: title,
      title,
      renderedContent: Array.from({ length: [2, 5, 25][index] }, (_, line) => `Body ${line + 1}`).join("\n"),
      render: () => ""
    }));

    renderDetail(state, screen, layout);

    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(output[layout.detail.y]).toContain(` ${indicator} `);
    expect(output[layout.detail.y + 1]).toContain(title);
    expect(state.detail.scroll).toBe(scroll);
    expect(state.detail.cursor).toBe(cursor);
  });

  it("ignores trailing raw blanks trimmed from the rendered body", () => {
    state.detail.items = [{ id: "body", renderedContent: `${lines.join("\n")}\n\n\n`, render: () => "" }];
    state.detail.scroll = 8;

    renderDetail(state, screen, layout);

    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(output[layout.detail.y]).toContain(" 50% ");
    expect(output[layout.detail.y + 1]).toContain("Line 9");
    expect(output[layout.detail.y + 8]).toContain("Line 16");
  });

  it("uses rendered Markdown lines rather than raw source lines", () => {
    state.detail.items = [{ id: "body", renderedContent: ["# Heading", ...lines.slice(0, 21)].join("\n"), render: () => "" }];
    state.detail.scroll = 8;

    renderDetail(state, screen, layout);

    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(output[layout.detail.y]).toContain(" 50% ");
    expect(output.slice(layout.detail.y + 1, layout.detail.y + 9).map((line) => line.slice(2, -2).trim())).toEqual(
      lines.slice(5, 13)
    );
  });

  it("uses fifteen wrapped physical rows for a supplied scroll of three", () => {
    const words = Array.from({ length: 15 }, (_, index) => `word-${index + 1}-${"x".repeat(33)}`);
    state.detail.items = [{ id: "body", renderedContent: words.join(" "), render: () => "" }];
    state.detail.scroll = 3;

    renderDetail(state, screen, layout);

    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(output[layout.detail.y]).toContain(" 43% ");
    expect(output.slice(layout.detail.y + 1, layout.detail.y + 9).map((line) => line.slice(2, -2).trim())).toEqual(
      words.slice(3, 11)
    );
  });

  it("renders uncached synchronous content once for both body and progress", () => {
    const content = ["Uncached progress callback", ...lines.slice(1)].join("\n");
    const render = vi.fn(() => content);
    state.detail.items = [{ id: "uncached", render }];
    state.detail.scroll = 8;

    renderDetail(state, screen, layout);

    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(render).toHaveBeenCalledTimes(1);
    expect(output[layout.detail.y]).toContain(" 50% ");
    expect(output[layout.detail.y + 1]).toContain("Line 9");
  });
});
