import { afterEach, expect, test, vi } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdftoppmCli } from "./index.js";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test("a single large page can be cancelled inside raster pixel processing", async () => {
  const doc = PdfDocument.create();
  doc.addPage({ width: 256, height: 256 });
  const files = new Map([["in.pdf", doc.save()]]);
  const controller = new AbortController();
  const reason = new Error("cancel raster pixels");
  vi.stubGlobal("setImmediate", undefined);
  vi.spyOn(Date, "now").mockReturnValue(0);
  vi.spyOn(performance, "now").mockReturnValue(0);
  const timer = globalThis.setTimeout;
  let turns = 0;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number) => timer(() => {
    if (++turns === 5) controller.abort(reason);
    callback();
  }, ms)) as typeof setTimeout);
  await expect(runPdftoppmCli(["-r", "72", "in.pdf", "page"], files, { signal: controller.signal })).rejects.toBe(reason);
  expect(files.has("page-1.ppm")).toBe(false);
});
