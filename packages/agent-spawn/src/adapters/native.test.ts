import { describe, it, expect } from "bun:test";
import { adaptNative } from "./native.js";
import { fromArray, collect } from "./test-utils.js";

describe("adaptNative", () => {
  it("passes through ACP-compatible events unchanged", async () => {
    const input = { event: "tool_start", id: "x", kind: "read", title: "read file" };
    const updates = await collect(adaptNative(fromArray([JSON.stringify(input)])));
    expect(updates).toEqual([input]);
  });

  it("emits error event for lines missing an event field", async () => {
    const updates = await collect(adaptNative(fromArray(['{"type":"something"}'])));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ event: "error" });
    expect((updates[0] as any).message).toContain("missing");
  });

  it("emits error event for lines with a non-string event field", async () => {
    const updates = await collect(adaptNative(fromArray(['{"event":123}'])));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ event: "error" });
    expect((updates[0] as any).message).toContain("string");
  });

  it("emits error event for malformed JSON lines and continues", async () => {
    const input = { event: "tool_start", id: "x" };
    const updates = await collect(adaptNative(fromArray(["not json", JSON.stringify(input)])));

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ event: "error" });
    expect((updates[0] as any).message).toContain("Malformed");
    expect(updates[1]).toEqual(input);
  });
});
