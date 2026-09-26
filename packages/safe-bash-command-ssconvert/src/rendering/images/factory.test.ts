import { expect, it } from "vitest";
import { createImageRendering } from "./index.js";
import type { CapabilityContext } from "../../contracts.js";
const context: CapabilityContext = {
  signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100, workbookWork: 0 }
};
const book = { sheets: [{ id: "Next", name: "Next", cells: [] }] };
it("does not admit metrics or graph work for a rejected next sheet", async () => {
  let admitted = 0;
  const rendering = createImageRendering({ metrics() { admitted++; throw new Error("metrics admitted"); } });
  const iterator = rendering.exportGraphs(book, { template: "/%n.svg", resolution: 100, canVisitSheet: () => false }, context)[Symbol.asyncIterator]();
  await expect(iterator.next()).resolves.toMatchObject({ done: true });
  expect(admitted).toBe(0);
});
it("preserves cancellation before rejecting next-sheet admission", async () => {
  const controller = new AbortController(), reason = new Error("cancelled before admission");
  controller.abort(reason);
  const iterator = createImageRendering().exportGraphs(book, {
    template: "/%n.svg", resolution: 100, canVisitSheet: () => false
  }, { ...context, signal: controller.signal })[Symbol.asyncIterator]();
  await expect(iterator.next()).rejects.toBe(reason);
});
it("preserves cancellation triggered during rejected next-sheet admission", async () => {
  const controller = new AbortController(), reason = new Error("cancelled during admission");
  const iterator = createImageRendering().exportGraphs(book, {
    template: "/%n.svg", resolution: 100,
    canVisitSheet() { controller.abort(reason); return false; }
  }, { ...context, signal: controller.signal })[Symbol.asyncIterator]();
  await expect(iterator.next()).rejects.toBe(reason);
});
it("traverses sheets normally when admission is omitted", async () => {
  let admitted = 0;
  const rendering = createImageRendering({ metrics() { admitted++; throw new Error("metrics admitted"); } });
  const iterator = rendering.exportGraphs(book, { template: "/%n.svg", resolution: 100 }, {
    ...context, limits: { ...context.limits, workbookWork: 100 }
  })[Symbol.asyncIterator]();
  await expect(iterator.next()).rejects.toThrow("metrics admitted");
  expect(admitted).toBe(1);
});
