import { describe, expect, it } from "vitest";
import { createStore } from "./store.js";

describe("bounded dashboard output", () => {
  it("bounds oversized messages while preserving the latest output and caller data", () => {
    const store = createStore();
    const item = {
      kind: "tool" as const,
      text: "earlier output\n".repeat(2000) + "latest result",
      ts: 0
    };
    store.appendOutput(item);
    const retained = store.getState().output[0]!;
    expect(retained.text.length).toBeLessThanOrEqual(16_384);
    expect(retained.text).toContain("Output truncated");
    expect(retained.text.endsWith("latest result")).toBe(true);
    expect(item.text.startsWith("earlier output")).toBe(true);
    expect(item.text.length).toBeGreaterThan(16_384);
  });

  it("does not leave half of a surrogate pair at the truncation boundary", () => {
    const store = createStore();
    store.appendOutput({ kind: "info", text: "a".repeat(20000) + "😀" + "z".repeat(16343), ts: 0 });
    const text = store.getState().output[0]!.text;
    const tail = text.slice(text.indexOf("\n") + 1);
    expect(tail.startsWith("z")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(16384);
  });

  it("bounds retained text even when every message is oversized", () => {
    const store = createStore();
    for (let index = 0; index < 300; index += 1) {
      store.appendOutput({
        kind: "info",
        text: "x".repeat(20000) + ` message ${index}`,
        ts: index
      });
    }
    const output = store.getState().output;
    expect(output.length).toBe(256);
    expect(output.reduce((size, item) => size + item.text.length, 0)).toBeLessThanOrEqual(
      4_194_304
    );
    expect(output.at(-1)!.text.endsWith("message 299")).toBe(true);
  });
});
