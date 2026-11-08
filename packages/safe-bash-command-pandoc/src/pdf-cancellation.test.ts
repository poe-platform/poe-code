import { expect, it, vi } from "vitest";
import { createExecutionContext, createFormatRegistry, writeDocument } from "./index.js";
import type { Document } from "./index.js";

const document: Document = { blocks: [{ t: "Para", c: [{ t: "Str", c: "Original" }] }], metadata: {}, resources: [] };
it("preserves cancellation from a direct PDF engine checkpoint", async () => {
  const controller = new AbortController();
  const context = createExecutionContext("write", { signal: controller.signal, yield: async () => { controller.abort(); } });
  const selection = createFormatRegistry().resolve("pdf", "write");
  await expect(selection.writer!.write(document, context, selection)).rejects.toMatchObject({ code: "E_CANCELLED" });
  await context.close();
});

it("never writes or closes a streaming PDF sink after engine cancellation", async () => {
  const controller = new AbortController();
  const write = vi.fn(async () => {}), close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  await expect(writeDocument(document, { to: "pdf" }, {
    signal: controller.signal, output: { write, close, abort }, yield: async () => { controller.abort(); }
  })).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  // The supplied sink remains unacquired, consistent with warning preflight.
  expect(abort).not.toHaveBeenCalled();
});
