import { expect, it, vi } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb, readBiffRecords } from "./biff-binary.js";
import { createRegistry } from "./registry.js";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 100 } };
const keySizes = [40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128];
const book = { sheets: ["Secret", "Other"].map(name => ({ id: name, name,
  cells: [{ row: 0, column: 0, value: { kind: "string" as const, value: "海".repeat(5000) } },
    { row: 1, column: 0, value: { kind: "number" as const, value: 42 }, formula: "=41+1" }] })) };

it.each(keySizes)("exports the specified CryptoAPI header and multi-block BIFF data at %i bits", async keyBits => {
  for (const secret of ["", "海🌊", new Uint8Array([97, 0, 0, 0, 255, 18])]) {
    const read = vi.fn(async () => secret), random = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const configured = { ...context, password: { read }, entropy: { read: async () => random } };
    const output = await createBiffWriter(8)(book, [`encryption=rc4-cryptoapi-${keyBits}`], configured);
    const records = readBiffRecords(readCfb(output, context).get("Workbook")!, context), header = records.find(r => r.opcode === 0x2f)!.data;
    expect([header.u16(0), header.u16(2), header.u16(4)]).toEqual([1, 4, 2]);
    expect([header.u32(6), header.u32(14), header.u32(18), header.u32(22), header.u32(26), header.u32(30), header.u32(34)])
      .toEqual([12, 12, 0, 0x6801, 0x8004, keyBits, 1]);
    const verifier = 14 + header.u32(10);
    expect(new TextDecoder("utf-16le").decode(header.bytes.subarray(46, verifier)))
      .toBe("Microsoft Enhanced Cryptographic Provider v1.0\0");
    expect(header.bytes.length).toBe(verifier + 60);
    expect(header.u32(verifier)).toBe(16); expect(header.u32(verifier + 36)).toBe(20);
    expect(header.bytes.subarray(verifier + 4, verifier + 20)).toEqual(random.subarray(0, 16));
    const reopened = await readBiff(output, configured);
    expect(reopened.sheets.map(s => ({ name: s.name, values: s.cells.map(c => c.value), formula: s.cells[1]!.formula })))
      .toEqual(book.sheets.map(s => ({ name: s.name, values: s.cells.map(c => c.value), formula: "=41+1" })));
    expect(read.mock.calls[0]).toEqual([expect.objectContaining({ purpose: "encrypt", algorithm: "rc4-cryptoapi", revision: 8, encoding: "utf16le" })]);
    await expect(readBiff(output, { ...configured, password: { read: async () => "wrong" } })).rejects.toThrow("password required");
    expect(random).toEqual(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  }
});

it("exposes exactly the specified CryptoAPI key sizes through the provider", () => {
  const codec = createRegistry([]).select("write", "Gnumeric_Excel:excel_biff8")!;
  expect(codec.exportOptionRules?.encryption).toEqual({ kind: "enum", values: ["rc4", ...keySizes.map(bits => `rc4-cryptoapi-${bits}`)] });
});

it.each([
  [40, "87c7585a5e4e5b3af9a5ba82dd8745722e12e450005cb17d658349b8ca36d99851f70e51"],
  [48, "cdcc0dd94a36f77ad1ed104f7569312a5532ae5ae6db3a78a17046d24797b83ef4a5c328"],
  [128, "37c3f5f7a39df1b73294ede1764ce0d18accd89555ae5d9fa6a6f967b1c5429b0f67d349"]
])("matches independent CryptoAPI verifier bytes at %i bits", async (bits, expected) => {
  // hashlib SHA-1 + PyCryptodome 3.23.0 ARC4, MS-OFFCRYPTO 2.3.5:
  // password 'password', salt 01..10, verifier 11..20 (hex).
  const output = await createBiffWriter(8)(book, [`encryption=rc4-cryptoapi-${bits}`], {
    ...context, password: { read: async () => "password" },
    entropy: { read: async () => Uint8Array.from({ length: 32 }, (_, i) => i + 1) }
  });
  const header = readBiffRecords(readCfb(output, context).get("Workbook")!, context).find(r => r.opcode === 0x2f)!.data;
  const at = 14 + header.u32(10);
  expect(Buffer.concat([header.bytes.subarray(at + 20, at + 36), header.bytes.subarray(at + 40)]).toString("hex")).toBe(expected);
});

it.each([40, 128])("publishes %i-bit CryptoAPI through the public command and preserves targets on refusal", async bits => {
  for (const mode of ["success", "password", "entropy", "same-random-halves", "work", "output", "cancel"]) {
    const fs = Volume.fromJSON({ "/in.csv": "42\n", "/out.xls": "untouched" }), controller = new AbortController();
    const errors: string[] = [], random = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const password = { async read() { if (mode === "password") return undefined; return "x".repeat(255); } };
    const entropy = { async read() {
      if (mode === "entropy") throw new Error("private-host-error");
      if (mode === "cancel") controller.abort();
      return mode === "same-random-halves" ? new Uint8Array(32) : random;
    } };
    const engine = createEngine({ codecs: [], environment: context.environment,
      limits: { ...context.limits, ...(mode === "work" ? { workbookWork: 0 } : {}), ...(mode === "output" ? { outputBytes: 2048 } : {}) }, password, entropy,
      filesystem: { async read(path) { return [new Uint8Array(fs.readFileSync(path) as Uint8Array)]; }, async write(path, bytes) { fs.writeFileSync(path, bytes); } } });
    try {
      const command = runCommand(["-T", "Gnumeric_Excel:excel_biff8", "-O", `encryption=rc4-cryptoapi-${bits}`, "/in.csv", "/out.xls"], engine,
        { signal: controller.signal, stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } });
      if (mode === "cancel") await expect(command).rejects.toMatchObject({ name: "AbortError" });
      else expect((await command).exitCode).toBe(mode === "success" ? 0 : 1);
      expect(errors.join("")).not.toContain("private-host-error");
      if (mode === "success") {
        expect(errors).toEqual([]);
        const reopened = await readBiff(new Uint8Array(fs.readFileSync("/out.xls") as Uint8Array), { ...context, password });
        expect(reopened.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
      } else expect(fs.readFileSync("/out.xls", "utf8")).toBe("untouched");
    } finally { await engine.dispose(); }
  }
});

it.each(["rc4-cryptoapi-0", "rc4-cryptoapi-39", "rc4-cryptoapi-41", "rc4-cryptoapi-136"])(
  "refuses unsupported key sizes before acquiring secrets (%s)", async profile => {
    const read = vi.fn(async () => "private");
    await expect(createBiffWriter(8)(book, [`encryption=${profile}`], { ...context, password: { read } })).rejects.toThrow("encryption profile");
    expect(read).not.toHaveBeenCalled();
  });
