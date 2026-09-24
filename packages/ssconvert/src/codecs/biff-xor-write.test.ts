import { expect, it, vi } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb, readBiffRecords } from "./biff-binary.js";
import { encryptBiffXorStreams } from "./biff-xor-write.js";
import { writeBiffStream } from "./biff-write.js";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 4, operations: 100 } };
const options = ["encryption=xor"];
const book = { sheets: ["Private", "Other"].map(name => ({ id: name, name, cells: [
  { row: 0, column: 0, value: { kind: "string" as const, value: "Secret".repeat(100) } },
  { row: 1, column: 0, formula: "=41+1", value: { kind: "number" as const, value: 42 } }
] })) };

it.each([7, 8, "dsf"] as const)("exports XOR in every stream of BIFF %s with one host password", async profile => {
  const secret = new TextEncoder().encode("password"), original = secret.slice();
  const password = vi.fn(async () => secret), entropy = vi.fn(async () => new Uint8Array(32));
  const bindings = { ...context, password: { read: password }, entropy: { read: entropy }, outputFilename: "/private.xls" };
  const output = await createBiffWriter(profile)(book, options, bindings);
  expect(password).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ purpose: "encrypt", format: "biff",
    algorithm: "xor", revision: profile === 7 ? 7 : 8, encoding: "bytes", maxBytes: 15, outputFilename: "/private.xls" }));
  expect(entropy).not.toHaveBeenCalled();
  expect(secret).toEqual(original);
  const streams = readCfb(output, context);
  expect([...streams.keys()]).toEqual(profile === "dsf" ? ["Book", "Workbook"] : [profile === 7 ? "Book" : "Workbook"]);
  for (const [name, stream] of streams) {
    const records = readBiffRecords(stream, context), pass = records.find(r => r.opcode === 0x2f)!;
    // MS-OFFCRYPTO Method 1 known key and verifier for ASCII "password".
    expect([...pass.data.bytes]).toEqual([...(name === "Workbook" ? [0, 0] : []), 0x7a, 0x14, 0xaf, 0x83]);
    expect(records.filter(r => r.opcode === 0x85).map(r => r.data.u32(0)))
      .toEqual(records.filter(r => r.opcode === 0x809).slice(1).map(r => r.offset));
    expect(new TextDecoder().decode(stream)).not.toContain("Secret");
    const reopened = await readBiff(stream, bindings);
    expect(reopened.sheets.map(s => ({ name: s.name, cells: s.cells.map(c => ({ value: c.value, formula: c.formula })) })))
      .toEqual(book.sheets.map(s => ({ name: s.name, cells: s.cells.map(c => ({ value: c.value, formula: c.formula })) })));
    await expect(readBiff(stream, { ...context, password: { async read() { return new TextEncoder().encode("wrong"); } } }))
      .rejects.toThrow("password required");
  }
});

it.each([undefined, "password", new Uint8Array(), new Uint8Array(16)])("rejects invalid XOR export password %#", async secret => {
  await expect(createBiffWriter(8)(book, options, { ...context, password: { async read() { return secret; } } }))
    .rejects.toThrow("1 to 15 explicitly encoded password bytes");
});

it("admits work for both DSF streams before asking for a password", async () => {
  const streams = await Promise.all(([7, 8] as const).map(revision => writeBiffStream(book, revision, true, context,
    new Uint8Array(revision === 8 ? 6 : 4))));
  const password = vi.fn(async () => new Uint8Array([97]));
  await expect(encryptBiffXorStreams(streams, 8, { ...context, password: { read: password },
    limits: { ...context.limits, workbookWork: Math.max(...streams.map(s => s.length)) + 256 } })).rejects.toThrow("encryption work limit");
  expect(password).not.toHaveBeenCalled();
});

it("checks cancellation during long XOR record payloads", async () => {
  const stream = new Uint8Array(22 + 8192);
  stream.set([9, 8, 4, 0, 0, 6, 5, 0, 0x2f, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0x34, 0x12, 0, 32]);
  stream.fill(49, 22);
  const secret = new Uint8Array([97]); let checks = 0;
  const signal = { throwIfAborted() { if (++checks === 8) throw new Error("cancel cipher"); } } as AbortSignal;
  await expect(encryptBiffXorStreams([stream], 8, { ...context, signal, password: { async read() { return secret; } } }))
    .rejects.toThrow("cancel cipher");
  expect(stream[22 + 2048]).toBe(49);
  expect(stream.slice(22, 22 + 2048)).not.toEqual(new Uint8Array(2048).fill(49));
  expect(secret).toEqual(new Uint8Array([97]));
});

it.each(["excel_biff7", "excel_biff8", "excel_dsf"])("publishes %s XOR through the public command and preserves destinations on failure", async format => {
  for (const failure of ["none", "absent", "empty", "callback", "work", "output", "cancel"] as const) {
    const controller = new AbortController(), fs = Volume.fromJSON({ "/in.csv": "42\n", "/out.xls": "untouched" }), diagnostics: string[] = [];
    const secret = new Uint8Array([97]);
    const password = { async read() {
      if (failure === "callback") throw new Error("private-secret");
      if (failure === "cancel") controller.abort();
      return failure === "empty" ? new Uint8Array() : secret;
    } };
    const engine = createEngine({ codecs: [], environment: context.environment,
      limits: { ...context.limits, ...(failure === "work" ? { workbookWork: 0 } : {}), ...(failure === "output" ? { outputBytes: 2048 } : {}) },
      ...(failure === "absent" ? {} : { password }),
      filesystem: { async read(path) { return [new Uint8Array(fs.readFileSync(path) as Uint8Array)]; }, async write(path, bytes) { fs.writeFileSync(path, bytes); } } });
    try {
      const result = runCommand(["-T", `Gnumeric_Excel:${format}`, "-O", options[0]!, "/in.csv", "/out.xls"], engine,
        { signal: controller.signal, stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(new TextDecoder().decode(bytes)); } } });
      if (failure === "cancel") await expect(result).rejects.toMatchObject({ name: "AbortError" });
      else expect((await result).exitCode === 0).toBe(failure === "none");
      if (failure === "none") {
        const output = new Uint8Array(fs.readFileSync("/out.xls") as Uint8Array);
        expect((await readBiff(output, { ...context, password })).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
      } else expect(fs.readFileSync("/out.xls", "utf8")).toBe("untouched");
      expect(diagnostics.join("")).not.toContain("private-secret");
      expect(secret).toEqual(new Uint8Array([97]));
    } finally { await engine.dispose(); }
  }
});

it.each([
  [[97], "4432bbae64e97bf13def4a72c59027d0"],
  [[...new TextEncoder().encode("password")], "0418a09542f70215e06b44db0512475c"],
  [[...new TextEncoder().encode("VelvetSweatshop")], "05425e0916c0588e9525c60a1b43df02"],
  [[...new TextEncoder().encode("123456789012345")], "297d6e39aaf8ebbb29bd6b39aafae9bb"],
  [[0], "870c7890a7d7b8cffed1394c06aee4ee"],
  [[255, 128, 97], "4cfdae9ed1828e4510dcaf03205e2f3c"]
] as const)("matches independent Method 1 ciphertext vector %#", async (password, expected) => {
  // msoffcrypto-tool 6.0.0's independently implemented Method 1 array, followed
  // by the specified ROL5/XOR transform at absolute record end 38.
  const stream = new Uint8Array([9, 8, 4, 0, 0, 6, 5, 0, 0x2f, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    0x34, 0x12, 16, 0, ...Array.from({ length: 16 }, (_, i) => i)]);
  await encryptBiffXorStreams([stream], 8, { ...context, password: { async read() { return new Uint8Array(password); } } });
  expect(Buffer.from(stream.subarray(22)).toString("hex")).toBe(expected);
});
