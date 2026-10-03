import { expect, it, vi } from "vitest";
import { ZipWriteChain } from "@poe-code/office-package";
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

it("stages axis style XML instead of retaining a sheet-wide string", async () => {
  const signal = new AbortController().signal, fs = createMemoryFileSystem();
  const raw = { sheets: [{ id: "s", name: "Axes", cells: [],
    rows: Array.from({ length: 400 }, (_, index) => ({ index, sizePoints: index + 10 })) }] };
  const expected = await createOdfWriter("extended")(raw, [], { signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const create = support.createOdfXml;
  const spy = vi.spyOn(support, "createOdfXml").mockImplementation((...args) => {
    const xml = create(...args);
    return { ...xml, stream(tag, attributes, fragments) {
      async function* checked() {
        for await (const fragment of fragments) {
          if (tag === "office:automatic-styles") expect(fragment.length).toBeLessThanOrEqual(16384);
          yield fragment;
        }
      }
      return xml.stream(tag, attributes, checked());
    } };
  });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), chunks: Uint8Array[] = [];
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { chunks.push(bytes.slice()); } } },
      { exportType: "Gnumeric_OpenCalc:odf" }, { signal });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected)); expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});


it.each(["write", "cancel"])("erases metadata scratch and cleans staging after %s failure", async mode => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), reason = new Error("metadata storage failed");
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const append = ZipWriteChain.prototype.append; let borrowed: Uint8Array | undefined;
  const spy = vi.spyOn(ZipWriteChain.prototype, "append").mockImplementation(async function(this: ZipWriteChain, chunks, length) {
    await append.call(this, chunks, length);
    if (!borrowed && Array.isArray(chunks) && length === 16384 && new TextDecoder().decode(chunks[0].subarray(0, 100)).includes('style:name="ro')) {
      borrowed = chunks[0];
      if (mode === "cancel") controller.abort(reason); else throw reason;
    }
  });
  try {
    const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Axes", cells: [],
      rows: Array.from({ length: 400 }, (_, index) => ({ index, sizePoints: index + 10 })) }] }, { signal: controller.signal });
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { throw new Error("unexpected publication"); } } },
      { exportType: "Gnumeric_OpenCalc:odf" }, { signal: controller.signal })).rejects.toBe(reason);
    expect(borrowed).toBeDefined(); expect(borrowed!.every(byte => byte === 0)).toBe(true);
    expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});

it("admits metadata and table staging against one output budget", async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal, budget = 35000;
  const engine = createEngine({ formats: [odsFormat], limits: { outputBytes: budget }, workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const append = ZipWriteChain.prototype.append; let staged = 0;
  const spy = vi.spyOn(ZipWriteChain.prototype, "append").mockImplementation(async function(this: ZipWriteChain, chunks, length) {
    staged += length; return append.call(this, chunks, length);
  });
  try {
    const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Axes", cells: [],
      rows: Array.from({ length: 400 }, (_, index) => ({ index, sizePoints: index + 10 })) }] }, { signal });
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { throw new Error("unexpected publication"); } } },
      { exportType: "Gnumeric_OpenCalc:odf" }, { signal })).rejects.toMatchObject({ code: "resource-limit" });
    expect(staged).toBeGreaterThan(0); expect(staged).toBeLessThanOrEqual(budget);
    expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});

it.each(["strict", "extended"] as const)("preserves %s retained validation and database fragments while streaming containers", async profile => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal, namespace = support.odfNamespaces.table!;
  const raw = { sheets: [{ id: "s", name: "Sheet", cells: [] }], unsupportedRecords: [
    { source: "Gnumeric_OpenCalc:openoffice", disposition: "retained" as const, kind: "content-validations", data: { xml: {
      name: "content-validations", namespace, children: Array.from({ length: 300 }, (_, index) => ({
        name: "content-validation", namespace, attributes: [{ name: "name", namespace, value: `V${index}` },
          { name: "condition", namespace, value: "of:cell-content()>0" }]
      }))
    } } },
    ...Array.from({ length: 100 }, (_, index) => ({ source: "Gnumeric_OpenCalc:openoffice", disposition: "retained" as const, kind: "database-ranges", data: { xml: {
      name: "database-ranges", namespace, children: [{ name: "database-range", namespace,
        attributes: [{ name: "name", namespace, value: `DB${index}` }, { name: "target-range-address", namespace, value: "Sheet.A1:Sheet.B2" }] }]
    } } }))
  ] };
  const expected = await createOdfWriter(profile)(raw, [], { signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const create = support.createOdfXml;
  const spy = vi.spyOn(support, "createOdfXml").mockImplementation((...args) => {
    const xml = create(...args);
    return { ...xml, element(tag, attributes, content) {
      if (tag === "table:content-validations" && content) throw new Error("resident validation container");
      return xml.element(tag, attributes, content);
    } };
  });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), chunks: Uint8Array[] = [];
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { chunks.push(bytes.slice()); } } },
      { exportType: profile === "strict" ? "Gnumeric_OpenCalc:openoffice" : "Gnumeric_OpenCalc:odf" }, { signal });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected)); expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});
