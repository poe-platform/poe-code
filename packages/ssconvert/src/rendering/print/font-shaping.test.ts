import {afterEach, expect, it, vi} from "vitest";
import fontkit from "@pdf-lib/fontkit";
import {suppliedDefaultFont} from "@poe-code/pdf";
import type {CapabilityContext} from "../../contracts.js";
import {createFontShaper} from "./font-shaping.js";

const bytes = suppliedDefaultFont().bytes;
function fixture() {
  const controller = new AbortController(), cleanups: (() => void | Promise<void>)[] = [];
  const context: CapabilityContext = {signal: controller.signal, own(cleanup) {cleanups.push(cleanup);},
    environment: {env: {}, locale: "C", timezone: "UTC"},
    limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 6000000, cells: 100, sheets: 4, operations: 100}};
  return {controller, context, cleanups, tick: () => controller.signal.throwIfAborted()};
}
afterEach(() => vi.restoreAllMocks());
it("registers ownership before acquisition and refuses a released conversion", async () => {
  const f = fixture(), instantiate = vi.spyOn(WebAssembly, "instantiate");
  const shaper = createFontShaper(f.context, f.tick), metrics = fontkit.create(bytes);
  expect(f.cleanups).toHaveLength(1);
  expect(instantiate).not.toHaveBeenCalled();
  await f.cleanups[0]!();
  await expect(shaper.addFont(bytes, metrics)).rejects.toThrow("font shaping could not complete");
  expect(instantiate).not.toHaveBeenCalled();
  expect(() => shaper.shape(metrics, "A")).toThrow("font shaping could not complete");
  shaper.dispose();
});
it("does not acquire an instance when released during asynchronous compilation", async () => {
  const f = fixture(), instantiate = vi.spyOn(WebAssembly, "instantiate");
  const shaper = createFontShaper(f.context, f.tick);
  const pending = shaper.addFont(bytes, fontkit.create(bytes));
  shaper.dispose();
  await expect(pending).rejects.toThrow("font shaping could not complete");
  expect(instantiate).not.toHaveBeenCalled();
});
it("preserves cancellation identity before acquisition and after font construction", async () => {
  const f = fixture(), reason = new Error("cancel owned shaping");
  const shaper = createFontShaper(f.context, f.tick), metrics = fontkit.create(bytes);
  await shaper.addFont(bytes, metrics);
  f.controller.abort(reason);
  expect(() => shaper.shape(metrics, "A")).toThrow(reason);
  await expect(shaper.addFont(bytes, metrics)).rejects.toBe(reason);
  await f.cleanups[0]!();
});
it("owns native state per conversion and copies glyph results and Unicode mappings", async () => {
  const f = fixture(), instantiate = vi.spyOn(WebAssembly, "instantiate"), before = new Uint8Array(bytes);
  const first = createFontShaper(f.context, f.tick), second = createFontShaper(f.context, f.tick);
  const metrics = fontkit.create(bytes), originalGlyph = metrics.getGlyph(metrics.glyphForCodePoint(65).id);
  const originalPoints = [...originalGlyph.codePoints];
  try {
    await first.addFont(bytes, metrics); await second.addFont(bytes, metrics);
    expect(instantiate).toHaveBeenCalledTimes(2);
    const run = first.shape(metrics, "AB"), positions = structuredClone(run.positions);
    expect(run.glyphs.flatMap(glyph => glyph.codePoints)).toEqual([65, 66]);
    expect(run.direction).toBe("ltr"); expect(run.script).toBe("Latn");
    expect(run.advanceWidth).toBe(1200);
    first.shape(metrics, "C".repeat(200));
    expect(run.positions).toEqual(positions);
    expect(originalGlyph.codePoints).toEqual(originalPoints);
    first.dispose();
    expect(second.shape(metrics, "AB").positions).toEqual(positions);
    expect(bytes).toEqual(before);
  } finally { first.dispose(); second.dispose(); }
});
it("refuses actual native heap denial and permanently discards the failed instance", async () => {
  const f = fixture(), shaper = createFontShaper(f.context, f.tick), metrics = fontkit.create(bytes);
  await shaper.addFont(bytes, metrics);
  const grow = vi.spyOn(WebAssembly.Memory.prototype, "grow").mockImplementation(() => {throw new RangeError("denied native growth");});
  expect(() => shaper.shape(metrics, "A".repeat(10000))).toThrow("font shaping could not complete");
  expect(grow).toHaveBeenCalled();
  grow.mockRestore();
  expect(() => shaper.shape(metrics, "A")).toThrow("font shaping could not complete");
  shaper.dispose();
  const next = createFontShaper(f.context, f.tick);
  try {await next.addFont(bytes, metrics); expect(next.shape(metrics, "A").glyphs).toHaveLength(1);}
  finally {next.dispose();}
});

it("refuses exhausted contextual lookups without publishing partial glyphs", async () => {
  // An80-deep contextual lookup chain exhausts HarfBuzz's shaping work bound.
  const recursive = Uint8Array.from(atob("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AAUAAAABAAgAAwABAAEEWAAAABgABQAAAAEACAADAAEAAQREAAAAGQAFAAAAAQAIAAMAAQABBDAAAAAaAAUAAAABAAgAAwABAAEEHAAAABsABQAAAAEACAADAAEAAQQIAAAAHAAFAAAAAQAIAAMAAQABA/QAAAAdAAUAAAABAAgAAwABAAED4AAAAB4ABQAAAAEACAADAAEAAQPMAAAAHwAFAAAAAQAIAAMAAQABA7gAAAAgAAUAAAABAAgAAwABAAEDpAAAACEABQAAAAEACAADAAEAAQOQAAAAIgAFAAAAAQAIAAMAAQABA3wAAAAjAAUAAAABAAgAAwABAAEDaAAAACQABQAAAAEACAADAAEAAQNUAAAAJQAFAAAAAQAIAAMAAQABA0AAAAAmAAUAAAABAAgAAwABAAEDLAAAACcABQAAAAEACAADAAEAAQMYAAAAKAAFAAAAAQAIAAMAAQABAwQAAAApAAUAAAABAAgAAwABAAEC8AAAACoABQAAAAEACAADAAEAAQLcAAAAKwAFAAAAAQAIAAMAAQABAsgAAAAsAAUAAAABAAgAAwABAAECtAAAAC0ABQAAAAEACAADAAEAAQKgAAAALgAFAAAAAQAIAAMAAQABAowAAAAvAAUAAAABAAgAAwABAAECeAAAADAABQAAAAEACAADAAEAAQJkAAAAMQAFAAAAAQAIAAMAAQABAlAAAAAyAAUAAAABAAgAAwABAAECPAAAADMABQAAAAEACAADAAEAAQIoAAAANAAFAAAAAQAIAAMAAQABAhQAAAA1AAUAAAABAAgAAwABAAECAAAAADYABQAAAAEACAADAAEAAQHsAAAANwAFAAAAAQAIAAMAAQABAdgAAAA4AAUAAAABAAgAAwABAAEBxAAAADkABQAAAAEACAADAAEAAQGwAAAAOgAFAAAAAQAIAAMAAQABAZwAAAA7AAUAAAABAAgAAwABAAEBiAAAADwABQAAAAEACAADAAEAAQF0AAAAPQAFAAAAAQAIAAMAAQABAWAAAAA+AAUAAAABAAgAAwABAAEBTAAAAD8ABQAAAAEACAADAAEAAQE4AAAAQAAFAAAAAQAIAAMAAQABASQAAABBAAUAAAABAAgAAwABAAEBEAAAAEIABQAAAAEACAADAAEAAQD8AAAAQwAFAAAAAQAIAAMAAQABAOgAAABEAAUAAAABAAgAAwABAAEA1AAAAEUABQAAAAEACAADAAEAAQDAAAAARgAFAAAAAQAIAAMAAQABAKwAAABHAAUAAAABAAgAAwABAAEAmAAAAEgABQAAAAEACAADAAEAAQCEAAAASQAFAAAAAQAIAAMAAQABAHAAAABKAAUAAAABAAgAAwABAAEAXAAAAEsABQAAAAEACAADAAEAAQBIAAAATAAFAAAAAQAIAAMAAQABADQAAABNAAUAAAABAAgAAwABAAEAIAAAAE4ABQAAAAEACAADAAEAAQAMAAAATwABAAEABAAA"), character => character.charCodeAt(0));
  const f = fixture(), shaper = createFontShaper(f.context, f.tick), metrics = fontkit.create(recursive);
  try {
    await shaper.addFont(recursive, metrics);
    expect(() => shaper.shape(metrics, "Q\u0301")).toThrow("font shaping could not complete");
    expect(() => shaper.shape(metrics, "Q")).toThrow("font shaping could not complete");
  } finally {shaper.dispose();}
});
