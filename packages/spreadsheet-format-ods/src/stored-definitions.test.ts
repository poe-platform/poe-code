import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine, defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import * as support from "@poe-code/spreadsheet-engine/codecs/odf-write-support";
import { createOdfWriter } from "./odf.js";
import { odsFormat } from "./index.js";

it.each(["strict", "extended"] as const)("stores %s retained definition identities and shapes with exact archive order", async profile => {
  const signal = new AbortController().signal, fs = createMemoryFileSystem(), namespace = support.odfNamespaces.style!;
  const style = (index: number, size = index + 10) => ({ name: "style", namespace,
    attributes: [{ name: "name", namespace, value: `retained${index}` }, { name: "family", namespace, value: "paragraph" }],
    children: [{ name: "text-properties", namespace, attributes: [{ name: "font-size", namespace: support.odfNamespaces.fo!, value: `${size}pt` }] }]
  });
  const raw = { sheets: [{ id: "s", name: "Styles", cells: [] }], unsupportedRecords: [{
    source: "Gnumeric_OpenCalc:openoffice", disposition: "retained" as const, kind: "styles", data: {
      xml: { name: "styles", namespace: support.odfNamespaces.office!, children: [...Array.from({ length: 300 }, (_, index) => style(index)), style(5, 90)] }
    }
  }] };
  const expected = await createOdfWriter(profile)(raw, [], { signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), chunks: Uint8Array[] = [];
    const set = Map.prototype.set, add = Set.prototype.add;
    const mapSpy = vi.spyOn(Map.prototype, "set").mockImplementation(function(this: Map<unknown, unknown>, key, value) {
      if (typeof key === "string" && (key.startsWith('["urn:oasis:names:tc:opendocument:xmlns:style:1.0"') || key.startsWith("<style:style")))
        throw new Error("resident definition identity or shape");
      return set.call(this, key, value);
    });
    const setSpy = vi.spyOn(Set.prototype, "add").mockImplementation(function(this: Set<unknown>, value) {
      if (typeof value === "string" && value.startsWith("retained")) throw new Error("resident definition names");
      return add.call(this, value);
    });
    const create = support.createOdfXml;
    const xmlSpy = vi.spyOn(support, "createOdfXml").mockImplementation((...args) => {
      const xml = create(...args);
      return { ...xml, element(tag, attributes, content) {
        if (tag === "office:styles" && content) throw new Error("buffered style definitions");
        return xml.element(tag, attributes, content);
      } };
    });
    try {
      await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) {
        expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(bytes.slice());
      } } }, { exportType: profile === "strict" ? "Gnumeric_OpenCalc:openoffice" : "Gnumeric_OpenCalc:odf" }, { signal });
    } finally { mapSpy.mockRestore(); setSpy.mockRestore(); xmlSpy.mockRestore(); }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected)); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});

it("allocates generated rich-text definition names with linear index lookups", async () => {
  const signal = new AbortController().signal, fs = createMemoryFileSystem();
  const raw = { sheets: [{ id: "s", name: "Rich", cells: Array.from({ length: 150 }, (_, row) => ({ row, column: 0,
    value: { kind: "string" as const, value: "A" }, richText: [{ start: 0, end: 1, attributes: { family: `Font${row}`, size: (row + 10) * 1024 } }]
  })) }] };
  const expected = await createOdfWriter("extended")(raw, [], { signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const { ZipDirectoryIndex } = await import("@poe-code/office-package");
  const get = ZipDirectoryIndex.prototype.get; let lookups = 0;
  const spy = vi.spyOn(ZipDirectoryIndex.prototype, "get").mockImplementation(function(this: InstanceType<typeof ZipDirectoryIndex>, key) {
    lookups++; return get.call(this, key);
  });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), chunks: Uint8Array[] = [];
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { chunks.push(bytes.slice()); } } },
      { exportType: "Gnumeric_OpenCalc:odf" }, { signal });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected)); expect(lookups).toBeLessThan(3000);
    expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});
