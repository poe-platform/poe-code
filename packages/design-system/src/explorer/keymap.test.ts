import { afterEach, describe, expect, it, vi } from "vitest";
import { parseKeypress } from "../dashboard/terminal.js";
import { resolveBindings } from "./keymap.js";
import type { ExplorerConfig } from "./state.js";

function config(overrides: Partial<ExplorerConfig<unknown>> = {}): ExplorerConfig<unknown> {
  return {
    title: "Plans",
    rows: async () => [],
    detail: { items: async () => [] },
    actions: [],
    ...overrides
  };
}

function key(sequence: string) {
  const event = parseKeypress(Buffer.from(sequence));
  if (event === undefined) {
    throw new Error(`Could not parse ${JSON.stringify(sequence)}`);
  }
  return event;
}

describe("resolveBindings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("layers built-ins, action keys, and user overrides", () => {
    const bindings = resolveBindings(config({
      actions: [
        {
          id: "archive",
          label: "Archive",
          key: "a",
          handler: () => undefined
        }
      ],
      keybindOverrides: {
        archive: "x"
      }
    }));

    expect(bindings.resolve(key("q"))).toEqual({ type: "builtin", id: "quit" });
    expect(bindings.resolve(key("a"))).toBeUndefined();
    expect(bindings.resolve(key("x"))).toEqual({ type: "action", id: "archive" });
    expect(bindings.bindings.get("q")).toEqual({ type: "builtin", id: "quit" });
    expect(bindings.bindings.get("x")).toEqual({ type: "action", id: "archive" });
    expect(bindings.bindings.has("a")).toBe(false);
  });

  it("applies provided built-in defaults below action keys", () => {
    const bindings = resolveBindings(
      config({
        actions: [
          {
            id: "archive",
            label: "Archive",
            key: "a",
            handler: () => undefined
          }
        ]
      }),
      {
        help: ["h"]
      }
    );

    expect(bindings.resolve(key("?"))).toBeUndefined();
    expect(bindings.resolve(key("h"))).toEqual({ type: "builtin", id: "help" });
    expect(bindings.resolve(key("a"))).toEqual({ type: "action", id: "archive" });
  });

  it("keeps quit non-rebindable", () => {
    const bindings = resolveBindings(config({
      keybindOverrides: {
        quit: "x"
      }
    }));

    expect(bindings.resolve(key("q"))).toEqual({ type: "builtin", id: "quit" });
    expect(bindings.resolve(key("\u0003"))).toEqual({ type: "builtin", id: "quit" });
    expect(bindings.resolve(key("x"))).toBeUndefined();
  });

  it("keeps quit non-rebindable through provided defaults", () => {
    const bindings = resolveBindings(config(), {
      quit: ["x"]
    });

    expect(bindings.resolve(key("q"))).toEqual({ type: "builtin", id: "quit" });
    expect(bindings.resolve(key("x"))).toBeUndefined();
  });

  it("resolves multi-key and named printable built-ins", () => {
    const bindings = resolveBindings(config());

    expect(bindings.resolve(key("g"))).toBeUndefined();
    expect(bindings.resolve(key("g"))).toEqual({ type: "builtin", id: "top" });
    expect(bindings.resolve(key(" "))).toEqual({ type: "builtin", id: "toggleSelect" });
    expect(bindings.resolve(key("\u001f"))).toEqual({ type: "builtin", id: "clearSelection" });
  });

  it("keeps action ids separate from same-named built-ins", () => {
    const bindings = resolveBindings(config({
      actions: [
        {
          id: "help",
          label: "Open help issue",
          key: "h",
          handler: () => undefined
        }
      ]
    }));

    expect(bindings.resolve(key("?"))).toEqual({ type: "builtin", id: "help" });
    expect(bindings.resolve(key("h"))).toEqual({ type: "action", id: "help" });
  });

  it("warns once for each conflicting action binding", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const bindings = resolveBindings(config({
      actions: [
        {
          id: "archive",
          label: "Archive",
          key: ["q", "q", "a"],
          handler: () => undefined
        }
      ]
    }));

    expect(bindings.resolve(key("q"))).toEqual({ type: "builtin", id: "quit" });
    expect(bindings.resolve(key("a"))).toEqual({ type: "action", id: "archive" });
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain("archive");
    expect(String(stderr.mock.calls[0]?.[0])).toContain("q");
  });

  it("deduplicates conflicts by canonical key", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    resolveBindings(config({
      actions: [
        {
          id: "archive",
          label: "Archive",
          key: ["Ctrl+c", "ctrl+c", "Control+c"],
          handler: () => undefined
        }
      ]
    }));

    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it("only includes reorder bindings when reorder is configured", () => {
    const withoutReorder = resolveBindings(config());
    const withReorder = resolveBindings(config({
      reorder: { onReorder: () => undefined }
    }));

    expect(withoutReorder.resolve(key("K"))).toBeUndefined();
    expect(withoutReorder.resolve(key("\u001b[1;2A"))).toEqual({ type: "builtin", id: "extendSelectionUp" });

    expect(withReorder.resolve(key("K"))).toEqual({ type: "builtin", id: "reorderUp" });
    expect(withReorder.resolve(key("J"))).toEqual({ type: "builtin", id: "reorderDown" });
    expect(withReorder.resolve(key("\u001b[1;2A"))).toEqual({ type: "builtin", id: "reorderUp" });
    expect(withReorder.resolve(key("\u001b[1;2B"))).toEqual({ type: "builtin", id: "reorderDown" });
  });
});
