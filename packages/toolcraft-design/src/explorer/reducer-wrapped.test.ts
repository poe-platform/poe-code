import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenBuffer } from "../dashboard/buffer.js";
import { parseKeypress } from "../dashboard/terminal.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import * as markdown from "../terminal-markdown/index.js";
import { computeExplorerLayout } from "./layout.js";
import { step } from "./reducer.js";
import { renderDetail } from "./render/detail.js";
import { paneBodyRect } from "./render/pane.js";
import { dumpScreen } from "./render/test-fixtures.js";
import { createInitialState, type ExplorerState } from "./state.js";

function key(value: string) {
  const parsed = parseKeypress(Buffer.from(value));
  if (parsed === undefined) throw new Error("Unparsed key");
  return parsed;
}

describe("explorer prepared preview scrolling", () => {
  const words = Array.from({ length: 24 }, (_, index) => `word${String(index + 1).padStart(2, "0")}-${"x".repeat(43)}`);
  let state: ExplorerState;
  let render: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const rows = [{ id: "one", title: "One" }];
    render = vi.fn(() => words.join(" "));
    state = step(createInitialState({
      title: "Rows", rows: async () => rows, detail: { items: async () => [] }, actions: []
    }, { cols: 70, rows: 14 }), { type: "rowsLoaded", rows }).state;
    state = step(state, {
      type: "detailLoaded", rowId: "one", token: state.detail.token,
      items: [{ id: "body", renderedContent: words.join(" "), render }]
    }).state;
    state = step(state, { type: "key", key: key("\t") }).state;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [60, 8, 16], [70, 8, 16], [79, 8, 16], [80, 3, 21],
    [99, 3, 21], [100, 8, 16], [120, 8, 16], [200, 8, 4]
  ])("scrolls physical rows at %i columns with page height %i and maximum %i", (cols, height, max) => {
    state = step(state, { type: "resize", cols, rows: 14 }).state;
    for (const [input, scroll] of [
      ["\u001b[B", 1], ["\u001b[A", 0],
      ["\u001b[6~", Math.min(height, max)], ["\u001b[5~", 0],
      ["\u0004", Math.min(Math.floor(height / 2), max)], ["\u0015", 0]
    ] as const) {
      state = step(state, { type: "key", key: key(input) }).state;
      expect(state.detail.scroll).toBe(scroll);
      expect(state.cursor).toBe(0);
    }
    for (let page = 0; page < 10; page += 1) {
      state = step(state, { type: "key", key: key("\u001b[6~") }).state;
    }
    expect(state.detail.scroll).toBe(max);
    const layout = computeExplorerLayout({ ...state.size, focused: state.focused });
    const body = paneBodyRect(layout.detail);
    const screen = new ScreenBuffer(cols, 14);
    renderDetail(state, screen, layout);
    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(body.height).toBe(height);
    expect(output[layout.detail.y]).toContain(" 100% ");
    expect(output[body.y + height - 1]).toContain(words[23]);
    state = step(state, { type: "key", key: key("\u001b[A") }).state;
    expect(state.detail.scroll).toBe(max - 1);
    expect(render).not.toHaveBeenCalled();
  });

  it("uses all 29 displayed rows from 17 raw Markdown lines", () => {
    const source = [
      ...Array.from({ length: 6 }, (_, index) => `# Heading ${index + 1}`),
      ...Array.from({ length: 11 }, (_, index) => `Line ${index + 1}`)
    ].join("\n");
    expect(source.split("\n")).toHaveLength(17);
    state = step(state, {
      type: "detailItemRendered", rowId: "one", token: state.detail.token, itemIndex: 0, content: source
    }).state;
    for (const expected of [8, 16, 21, 21]) {
      state = step(state, { type: "key", key: key("\u001b[6~") }).state;
      expect(state.detail.scroll).toBe(expected);
    }
    const layout = computeExplorerLayout({ ...state.size, focused: state.focused });
    const screen = new ScreenBuffer(70, 14);
    renderDetail(state, screen, layout);
    const output = stripAnsi(dumpScreen(screen)).split("\n");
    expect(output[layout.detail.y]).toContain(" 100% ");
    expect(output[layout.detail.y + 1]).toContain("Line 4");
    expect(output[layout.detail.y + 8]).toContain("Line 11");
  });

  it("trims trailing blank rows before bounding scroll and reverses immediately", () => {
    const source = Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join("\n") + "\n".repeat(10);
    expect(source.split("\n")).toHaveLength(34);
    state = step(state, {
      type: "detailItemRendered", rowId: "one", token: state.detail.token, itemIndex: 0, content: source
    }).state;
    for (const expected of [8, 16, 16, 16]) {
      state = step(state, { type: "key", key: key("\u001b[6~") }).state;
      expect(state.detail.scroll).toBe(expected);
    }
    state = step(state, { type: "key", key: key("\u001b[A") }).state;
    expect(state.detail.scroll).toBe(15);
  });

  it("clamps to the new physical maximum when width changes", () => {
    state.detail.scroll = 16;
    state = step(state, { type: "resize", cols: 200, rows: 14 }).state;
    expect(state.detail.scroll).toBe(4);
    state = step(state, { type: "resize", cols: 70, rows: 14 }).state;
    expect(state.detail.scroll).toBe(4);
    state = step(state, { type: "key", key: key("\u001b[6~") }).state;
    expect(state.detail.scroll).toBe(12);
    expect(render).not.toHaveBeenCalled();
  });

  it("clamps after an asynchronous content replacement without invoking callbacks", () => {
    state.detail.scroll = 16;
    state = step(state, {
      type: "detailItemRendered", rowId: "one", token: state.detail.token,
      itemIndex: 0, content: words.slice(0, 10).join(" ")
    }).state;
    expect(state.detail.scroll).toBe(2);
    state = step(state, { type: "key", key: key("\u001b[A") }).state;
    expect(state.detail.scroll).toBe(1);
    expect(render).not.toHaveBeenCalled();
  });

  it.each(["unresolved", "missing", "empty"])("never invokes a callback for %s content from the reducer", (kind) => {
    state.detail.items = kind === "missing" ? null : kind === "empty" ? [] : [{ id: "body", render }];
    for (const input of ["\u001b[B", "\u001b[6~", "\u0004"]) {
      state = step(state, { type: "key", key: key(input) }).state;
      expect(state.detail.scroll).toBe(0);
    }
    state = step(state, { type: "resize", cols: 200, rows: 14 }).state;
    expect(state.detail.scroll).toBe(0);
    expect(render).not.toHaveBeenCalled();
  });

  it.each([[59, 14], [70, 7]])("keeps hidden content at zero scroll at %ix%i", (cols, rows) => {
    state = step(state, { type: "resize", cols, rows }).state;
    for (const input of ["\u001b[B", "\u001b[6~", "\u0004"]) {
      state = step(state, { type: "key", key: key(input) }).state;
      expect(state.detail.scroll).toBe(0);
    }
    expect(render).not.toHaveBeenCalled();
  });

  it("keeps titled list bounds based on item count", () => {
    state.detail.items = words.slice(0, 3).map((content, index) => ({
      id: String(index), title: `Item ${index}`, renderedContent: content.repeat(20), render
    }));
    state.detail.scroll = 99;
    state = step(state, { type: "resize", cols: 200, rows: 14 }).state;
    expect(state.detail.scroll).toBe(2);
    state = step(state, { type: "key", key: key("\u001b[6~") }).state;
    expect(state.detail.cursor).toBe(2);
    expect(state.detail.scroll).toBe(2);
    expect(render).not.toHaveBeenCalled();
  });

  it("shares one Markdown preparation across initial paint, keys, and width revisits", () => {
    const renderMarkdown = vi.spyOn(markdown, "renderMarkdown");
    state.detail.items = [{ id: "cached", renderedContent: `Cache-${words.join(" ")}`, render }];
    const layout = computeExplorerLayout({ ...state.size, focused: state.focused });
    renderDetail(state, new ScreenBuffer(70, 14), layout);
    expect(renderMarkdown).toHaveBeenCalledTimes(1);
    for (const input of ["\u001b[B", "\u001b[6~", "\u001b[A", "\u0015"]) {
      state = step(state, { type: "key", key: key(input) }).state;
      renderDetail(state, new ScreenBuffer(70, 14), layout);
    }
    expect(state.detail.scroll).toBe(4);
    expect(renderMarkdown).toHaveBeenCalledTimes(1);
    state = step(state, { type: "resize", cols: 200, rows: 14 }).state;
    renderDetail(state, new ScreenBuffer(200, 14), computeExplorerLayout({ ...state.size, focused: state.focused }));
    expect(renderMarkdown).toHaveBeenCalledTimes(2);
    state = step(state, { type: "resize", cols: 70, rows: 14 }).state;
    renderDetail(state, new ScreenBuffer(70, 14), layout);
    expect(renderMarkdown).toHaveBeenCalledTimes(2);
    expect(render).not.toHaveBeenCalled();
  });
});
