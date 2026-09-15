import { expect, it, vi } from "vitest";
import { createStreamingDashboardLineBuffer } from "./line-buffer.js";
import { createStore } from "./store.js";
import { MAX_OUTPUT_PREVIEW_CHARS } from "./output-preview.js";

it("shows partial text immediately and replaces it when the line completes", () => {
  const store = createStore();
  const buffer = createStreamingDashboardLineBuffer((text, id) => store.appendOutput({ kind: "tool", text, id, ts: 0 }));
  buffer.push("live partial");
  expect(store.getState().output.map(item => item.text)).toEqual(["live partial"]);
  const firstId = store.getState().output[0]!.id;
  buffer.push(" response\nnext partial");
  expect(store.getState().output.map(item => item.text)).toEqual(["live partial response", "next partial"]);
  expect(store.getState().output[0]!.id).toBe(firstId);
  expect(store.getState().output[1]!.id).not.toBe(firstId);
  buffer.flush();
  expect(store.getState().output.map(item => item.text)).toEqual(["live partial response", "next partial"]);
});

it("bounds live output and keeps hidden strings out of partial updates", () => {
  const emit = vi.fn();
  const buffer = createStreamingDashboardLineBuffer(emit);
  buffer.push("\u001b]HIDDEN_FIRST\nHIDDEN_SECOND");
  expect(emit).not.toHaveBeenCalled();
  buffer.push("\u0007" + "word ".repeat(20_000) + "LATEST");
  const text = emit.mock.calls.at(-1)![0] as string;
  expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT_PREVIEW_CHARS);
  expect(text).not.toContain("HIDDEN_");
  expect(text).toContain("Output truncated");
  expect(text.endsWith("LATEST")).toBe(true);
  const count = emit.mock.calls.length;
  buffer.push("");
  expect(emit).toHaveBeenCalledTimes(count);
});

it("starts a new row after flush and preserves complete lines and CRLF", () => {
  const store = createStore();
  const buffer = createStreamingDashboardLineBuffer((text, id) => store.appendOutput({ kind: "tool", text, id, ts: 0 }));
  buffer.push("first\r");
  expect(store.getState().output[0]!.text).toBe("first");
  buffer.push("\nsecond\nthird");
  buffer.flush();
  buffer.push("fourth");
  buffer.flush();
  buffer.flush();
  expect(store.getState().output.map(item => item.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(new Set(store.getState().output.map(item => item.id)).size).toBe(4);
});

it("does not repaint unchanged partial text while a hidden control streams", () => {
  const emit = vi.fn();
  const buffer = createStreamingDashboardLineBuffer(emit);
  buffer.push("visible");
  buffer.push("\u001b]hidden");
  buffer.push(" payload");
  buffer.push("\u0007");
  expect(emit).toHaveBeenCalledTimes(1);
  buffer.push(" result");
  expect(emit).toHaveBeenCalledTimes(2);
});
