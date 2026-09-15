import { expect, it } from "vitest";
import { createStore } from "./store.js";

it("updates a keyed live preview without moving logs or changing held history", () => {
  const store = createStore();
  store.appendOutput({ id: "message", kind: "tool", text: "first", ts: 1 });
  const held = store.getState().output;
  store.appendOutput({ kind: "status", text: "Cancellation requested", ts: 2 });
  store.appendOutput({ id: "message", kind: "tool", text: "first second", ts: 1 });
  expect(store.getState().output.map((item) => item.text)).toEqual([
    "first second",
    "Cancellation requested"
  ]);
  expect(held.map((item) => item.text)).toEqual(["first"]);
});

it("keeps updated previews bounded at retention capacity", () => {
  const store = createStore();
  for (let index = 0; index < 256; index += 1) {
    store.appendOutput({ id: String(index), kind: "tool", text: "log " + index, ts: index });
  }
  store.appendOutput({ id: "255", kind: "tool", text: "x".repeat(50000) + "LATEST", ts: 255 });
  expect(store.getState().output).toHaveLength(256);
  expect(store.getState().output[0]!.text).toBe("log 0");
  expect(store.getState().output.at(-1)!.text.length).toBeLessThanOrEqual(16_384);
  expect(store.getState().output.at(-1)!.text).toContain("Output truncated");
  expect(store.getState().output.at(-1)!.text.endsWith("LATEST")).toBe(true);
});
