import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine, defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import { ZipWriteChain } from "@poe-code/office-package";
import * as support from "@poe-code/spreadsheet-engine/codecs/odf-write-support";
import { createOdfWriter } from "./odf.js";
import { odsFormat } from "./index.js";

it.each(["strict", "extended"] as const)("stages %s cell styles without resident key/name collections or XML containers", async profile => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), signal = new AbortController().signal;
  let written = 0, pending = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...args) => {
      pending += bytes.length; expect(pending).toBeLessThanOrEqual(16384); written += bytes.length;
      try { await Promise.resolve(); return await write(bytes, ...args); } finally { pending -= bytes.length; }
    });
    return handle;
  });
  const raw = { sheets: [{ id: "s", name: "Styles", cells: Array.from({ length: 600 }, (_, row) => ({ row, column: 0,
    value: { kind: "number" as const, value: row }, style: { gnumeric: { name: "Style", attributes: { Rotation: String(row) }, children: [] } }
  })) }] };
  const expected = await createOdfWriter(profile)(raw, [], { signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), chunks: Uint8Array[] = [];
    const create = support.createOdfXml;
    const xmlSpy = vi.spyOn(support, "createOdfXml").mockImplementation((...args) => {
      const xml = create(...args);
      return { ...xml, element(tag, attributes, content) {
        if (tag === "office:automatic-styles" && content?.includes('style:family="table-cell"')) throw new Error("resident cell-style XML container");
        return xml.element(tag, attributes, content);
      } };
    });
    const set = Map.prototype.set, add = Set.prototype.add;
    const styleName = (value: unknown) => typeof value === "string" && (value.startsWith("ce") || value.startsWith("Nce")) && Number.isInteger(Number(value.slice(value.startsWith("N") ? 3 : 2)));
    const mapSpy = vi.spyOn(Map.prototype, "set").mockImplementation(function(this: Map<unknown, unknown>, key, value) {
      if (typeof key === "string" && key.startsWith('[{"name":"Style"') || styleName(key)) throw new Error("resident style key index");
      return set.call(this, key, value);
    });
    const setSpy = vi.spyOn(Set.prototype, "add").mockImplementation(function(this: Set<unknown>, value) {
      if (styleName(value)) throw new Error("resident reserved style names");
      return add.call(this, value);
    });
    try {
      await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) {
        expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(bytes.slice());
      } } }, { exportType: profile === "strict" ? "Gnumeric_OpenCalc:openoffice" : "Gnumeric_OpenCalc:odf" }, { signal });
    } finally { xmlSpy.mockRestore(); mapSpy.mockRestore(); setSpy.mockRestore(); }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
    expect(written).toBeGreaterThan(16384); expect(pending).toBe(0); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});


it("bounds generated style and table staging together before publishing", async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal, budget = 35000;
  const engine = createEngine({ formats: [odsFormat], limits: { outputBytes: budget }, workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const append = ZipWriteChain.prototype.append; let staged = 0;
  const spy = vi.spyOn(ZipWriteChain.prototype, "append").mockImplementation(async function(this: ZipWriteChain, chunks, length) {
    staged += length; return append.call(this, chunks, length);
  });
  try {
    const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Styles", cells: Array.from({ length: 300 }, (_, row) => ({
      row, column: 0, value: { kind: "number" as const, value: row },
      style: { gnumeric: { name: "Style", attributes: { Rotation: String(row) } } }
    })) }] }, { signal });
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { throw new Error("unexpected publication"); } } },
      { exportType: "Gnumeric_OpenCalc:odf" }, { signal })).rejects.toMatchObject({ code: "resource-limit" });
    expect(staged).toBeGreaterThan(0); expect(staged).toBeLessThanOrEqual(budget);
    expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});

it.each(["write", "cancel"])("clears pending cell-style bytes and removes staging after %s failure", async mode => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), reason = new Error("style staging failed");
  const engine = createEngine({ formats: [odsFormat], workingFiles: { fs, directory: "/", cacheBytes: 16384 } });
  const append = ZipWriteChain.prototype.append;
  let borrowed: Uint8Array | undefined, prefix = "";
  const spy = vi.spyOn(ZipWriteChain.prototype, "append").mockImplementation(async function(this: ZipWriteChain, chunks, length) {
    await append.call(this, chunks, length);
    if (!borrowed && Array.isArray(chunks) && length === 16384) {
      const chunk = chunks[0] as Uint8Array, candidate = new TextDecoder().decode(chunk.subarray(0, 100));
      if (!candidate.startsWith("<style:style")) return;
      borrowed = chunk; prefix = candidate;
      if (mode === "cancel") controller.abort(reason); else throw reason;
    }
  });
  try {
    const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Styles", cells: Array.from({ length: 300 }, (_, row) => ({
      row, column: 0, value: { kind: "number" as const, value: row },
      style: { gnumeric: { name: "Style", attributes: { Rotation: String(row) } } }
    })) }] }, { signal: controller.signal });
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() { throw new Error("unexpected publication"); } } },
      { exportType: "Gnumeric_OpenCalc:odf" }, { signal: controller.signal })).rejects.toBe(reason);
    expect(prefix).toContain("<style:style"); expect(borrowed).toBeDefined();
    expect(borrowed!.every(byte => byte === 0)).toBe(true); expect(await fs.readdir("/")).toEqual([]);
  } finally { spy.mockRestore(); await engine.dispose(); }
});
