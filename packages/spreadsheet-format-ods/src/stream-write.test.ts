import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine, defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import * as office from "@poe-code/office-package";
import { createOdfWriter } from "./odf.js";
import { odsFormat } from "./index.js";

it.each(["strict", "extended"] as const)("streams %s ODF archives through caller storage", async profile => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let written = 0, largest = 0, pending = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...args) => {
      pending += bytes.length; expect(pending).toBeLessThanOrEqual(16384);
      written += bytes.length; largest = Math.max(largest, bytes.length);
      try { await Promise.resolve(); return await write(bytes, ...args); }
      finally { pending -= bytes.length; }
    });
    return handle;
  });
  const signal = new AbortController().signal;
  let seed = 7;
  const text = () => Array.from({ length: 128 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return String.fromCharCode(32 + ((seed >>> 24) % 95)); }).join("");
  const raw = { sheets: [{ id: "s", name: "Data", cells: Array.from({ length: 500 }, (_, row) => ({ row, column: 0,
    value: { kind: "string" as const, value: `cell é🦀${row} ${text()}` } })) }] };
  const expected = await createOdfWriter(profile)(raw, [], { signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const array = vi.fn(() => { throw new Error("buffered writer"); });
  const createZipCodec = office.createZipCodec;
  const zipSpy = vi.spyOn(office, "createZipCodec").mockImplementation(() => ({ ...createZipCodec(),
    async writeZipArchive() { throw new Error("whole archive write"); },
    async makeZipEntry() { throw new Error("whole member compression"); }
  }));
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 },
    formats: [{ ...odsFormat, services: odsFormat.services.map(codec => codec.direction === "write" ? { ...codec, write: array } : codec) }] });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), chunks: Uint8Array[] = [];
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) {
      expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(bytes.slice());
    } } }, { exportType: profile === "strict" ? "Gnumeric_OpenCalc:openoffice" : "Gnumeric_OpenCalc:odf" }, { signal });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected)); expect(chunks.length).toBeGreaterThan(1);
    expect(array).not.toHaveBeenCalled(); expect(written).toBeGreaterThan(16384);
    expect(largest).toBeLessThanOrEqual(16384); expect(pending).toBe(0);
    expect(await fs.readdir("/")).toEqual([]);
  } finally { zipSpy.mockRestore(); await engine.dispose(); }
});

// Only the expensive KDF arena is mocked; ciphers, manifests and ZIP paths remain real.
vi.mock("@noble/hashes/argon2.js", () => ({ argon2idAsync: async () => new Uint8Array(32).fill(71) }));
it.each(["odf12-aes128-cbc", "odf12-blowfish-cfb8", "libreoffice-aes256-gcm"])("preserves encrypted %s archive bytes", async encryption => {
  const fs = createMemoryFileSystem();
  const capabilities = { password: { async read() { return "test password"; } },
    entropy: { async read({ length }: { length: number }) { return new Uint8Array(length).fill(42); } } };
  const signal = new AbortController().signal;
  const raw = { sheets: [{ id: "s", name: "Data", cells: [{ row: 0, column: 0, value: { kind: "string" as const, value: "é🦀" } }] }] };
  const options = [`encryption=${encryption}`];
  const expected = await createOdfWriter("extended")(raw, options, { ...capabilities, signal,
    limits: defaultSsconvertLimits, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const engine = createEngine({ ...capabilities, workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [odsFormat] });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), output: Uint8Array[] = [];
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { output.push(bytes.slice()); } } },
      { exportType: "Gnumeric_OpenCalc:odf", exportOptions: options }, { signal });
    expect(Buffer.concat(output)).toEqual(Buffer.from(expected));
    expect(output.length).toBeGreaterThan(1); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});

it.each(["sink", "cancel"])("removes ODF staging after %s failure", async mode => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), reason = new Error(mode);
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [odsFormat] });
  try {
    const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Data", cells: [] }] }, { signal: controller.signal });
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() {
      if (mode === "cancel") controller.abort(reason); else throw reason;
    } } }, { exportType: "Gnumeric_OpenCalc:odf" }, { signal: controller.signal })).rejects.toBe(reason);
    expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});

it("clears temporary owned archive copies while preserving returned bytes", async () => {
  const createZipCodec = office.createZipCodec, owned: Uint8Array[] = [];
  const spy = vi.spyOn(office, "createZipCodec").mockImplementation(() => {
    const codec = createZipCodec();
    return { ...codec, async writeZipArchive(...args: Parameters<typeof codec.writeZipArchive>) {
      const bytes = await codec.writeZipArchive(...args), slice = bytes.slice.bind(bytes);
      bytes.slice = (...args) => { const copy = slice(...args); owned.push(copy); return copy; };
      return bytes;
    } };
  });
  try {
    const output = await createOdfWriter("strict")({ sheets: [{ id: "s", name: "Data", cells: [] }] }, [], {
      signal: new AbortController().signal, limits: defaultSsconvertLimits,
      environment: { env: {}, locale: "C", timezone: "UTC" }, own() {}
    });
    expect(Array.from(output.subarray(0, 2))).toEqual([80, 75]);
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.every(copy => copy.every(byte => byte === 0))).toBe(true);
  } finally { spy.mockRestore(); }
});
