import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runQpdfCli } from "./index.js";

it("yields macrotasks during work with frozen clocks and no setImmediate", async () => {
  const doc = PdfDocument.create(); for (let i = 0; i < 10; i++) doc.addPage();
  const files = new Map([["in.pdf", doc.save()]]);
  const immediate = globalThis.setImmediate;
  const timeout = globalThis.setTimeout;
  const dateNow = Date.now;
  const performanceNow = Object.getOwnPropertyDescriptor(performance, "now");
  let turns = 0;
  Object.defineProperty(globalThis, "setImmediate", { value: undefined, configurable: true, writable: true });
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    turns++;
    return timeout(callback, delay, ...args);
  }) as typeof setTimeout;
  Date.now = () => 0;
  Object.defineProperty(performance, "now", { value: () => 0, configurable: true });
  try {
    await runQpdfCli(["in.pdf", "--split-pages=1", "out.pdf"], files);
    assert.ok(turns >= 2, `Expected repeated turns, got ${turns}`);
  } finally {
    globalThis.setImmediate = immediate;
    globalThis.setTimeout = timeout;
    Date.now = dateNow;
    if (performanceNow) Object.defineProperty(performance, "now", performanceNow);
    else Reflect.deleteProperty(performance, "now");
  }
});
