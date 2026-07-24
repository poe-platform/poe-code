import { describe, expect, it } from "vitest";
import { parseKeypress } from "../dashboard/terminal.js";
import { keymapToHelp, resolveBindings } from "./keymap.js";
import type { ExplorerConfig } from "./state.js";

function config(overrides: Partial<ExplorerConfig<unknown>> = {}): ExplorerConfig<unknown> {
  return { title: "Plans", rows: async () => [], detail: { items: async () => [] }, actions: [], ...overrides };
}
function key(sequence: string) {
  const event = parseKeypress(Buffer.from(sequence));
  if (event === undefined) throw new Error("unparsed key");
  return event;
}

describe("explorer keymap", () => {
  it("reserves every printable character for filtering", () => {
    const bindings = resolveBindings(config({ actions: [{ id: "edit", label: "Edit", accelerator: "e", handler: () => undefined }] }));
    for (const letter of "jkga sdeq".replace(" ", "")) expect(bindings.resolve(key(letter))).toBeUndefined();
    expect(bindings.resolve(key("\u0005"))).toEqual({ type: "action", id: "edit" });
    expect(bindings.resolve(key("\u0003"))).toEqual({ type: "builtin", id: "quit" });
  });

  it("rejects legacy bare bindings and core accelerator collisions", () => {
    expect(() => resolveBindings(config({ actions: [{ id: "old", label: "Old", key: "o", handler: () => undefined }] }))).toThrow("bare key");
    for (const accelerator of ["c", "u", "d", "p"]) {
      expect(() => resolveBindings(config({ actions: [{ id: accelerator, label: accelerator, accelerator, handler: () => undefined }] }))).toThrow("collides with a core key");
    }
  });

  it("rejects duplicate and malformed accelerators", () => {
    expect(() => resolveBindings(config({ actions: [
      { id: "one", label: "One", accelerator: "e", handler: () => undefined },
      { id: "two", label: "Two", accelerator: "E", handler: () => undefined }
    ] }))).toThrow("share Ctrl+E");
    expect(() => resolveBindings(config({ actions: [{ id: "bad", label: "Bad", accelerator: "edit", handler: () => undefined }] }))).toThrow("one letter");
  });

  it("generates help from configured actions", () => {
    const help = keymapToHelp(config({ actions: [{ id: "edit", label: "Edit", accelerator: "e", handler: () => undefined }] }));
    expect(help.flatMap(section => section.entries)).toContainEqual({ key: "Ctrl+E", label: "Edit" });
  });
});
