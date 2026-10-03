import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine, defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import * as support from "@poe-code/spreadsheet-engine/codecs/odf-write-support";
import { createOdfWriter } from "./odf.js";
import { odsFormat } from "./index.js";

it.each(["strict", "extended"] as const)("streams %s named expressions and label ranges with exact archive bytes", async profile => {
  const signal = new AbortController().signal, fs = createMemoryFileSystem();
  const raw = { sheets: [{ id: "s", name: "Labels", cells: [], labelRanges: Array.from({ length: 200 }, (_, row) => ({
    axis: "row" as const, labels: { startRow: row, endRow: row, startColumn: 0, endColumn: 0 },
    data: { startRow: row, endRow: row, startColumn: 1, endColumn: 2 }
  })) }], names: Array.from({ length: 400 }, (_, index) => ({ name: `Name${index}`, expression: "=1+2",
    ...(index % 2 ? { sheet: "s" } : {}) })) };
  const expected = await createOdfWriter(profile)(raw, [], { signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const create = support.createOdfXml;
  const spy = vi.spyOn(support, "createOdfXml").mockImplementation((...args) => {
    const xml = create(...args);
    return { ...xml, element(tag, attributes, content) {
      if (["table:named-expressions", "table:label-ranges"].includes(tag) && content) throw new Error("resident metadata container");
      return xml.element(tag, attributes, content);
    } };
  });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), chunks: Uint8Array[] = [];
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) {
      expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(bytes.slice());
    } } }, { exportType: profile === "strict" ? "Gnumeric_OpenCalc:openoffice" : "Gnumeric_OpenCalc:odf" }, { signal });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
    expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});

it("stops metadata traversal on cancellation and removes working storage", async () => {
  const controller = new AbortController(), reason = new Error("cancel metadata"), fs = createMemoryFileSystem();
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [] }],
    names: Array.from({ length: 200 }, (_, index) => ({ name: `Name${index}`, expression: "=1", sheet: "s" }))
  }, { signal: controller.signal });
  const create = support.createOdfXml; let visited = 0;
  const spy = vi.spyOn(support, "createOdfXml").mockImplementation((...args) => {
    const xml = create(...args);
    return { ...xml, element(tag, attributes, content) {
      const result = xml.element(tag, attributes, content);
      if (tag === "table:named-expression" && ++visited === 20) controller.abort(reason);
      return result;
    } };
  });
  try {
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { throw new Error("unexpected publication"); } } },
      { exportType: "Gnumeric_OpenCalc:odf" }, { signal: controller.signal })).rejects.toBe(reason);
    expect(visited).toBe(20); expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});
