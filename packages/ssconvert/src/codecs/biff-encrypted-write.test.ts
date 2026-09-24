import { expect, it, vi } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb, readBiffRecords } from "./biff-binary.js";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { encryptBiffStream } from "./biff-encrypted-write.js";
import { writeBiffStream } from "./biff-write.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 100 } };
const options = ["encryption=rc4"];
const book = { sheets: ["Private", "Other"].map(name => ({ id: name, name, cells: [
  { row: 0, column: 0, value: { kind: "string" as const, value: "Secret".repeat(1800) } },
  { row: 1, column: 0, formula: "=41+1", value: { kind: "number" as const, value: 42 } }
] })) };
function bindings(secret: string | Uint8Array = "海🌊") {
  const random = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const password = vi.fn(async () => secret), entropy = vi.fn(async () => random);
  return { random, password, entropy, context: { ...context, password: { read: password }, entropy: { read: entropy } } };
}

it.each(["password", "", "海🌊", new Uint8Array([0x77, 0, 0, 0, 0xff, 0x12])])(
  "writes encrypted BIFF8 with explicit password %# and preserves multi-block records", async secret => {
    const b = bindings(secret), original = structuredClone(book);
    const output = await createBiffWriter(8)(book, options, { ...b.context, outputFilename: "/private.xls" });
    const streams = readCfb(output, context), records = readBiffRecords(streams.get("Workbook")!, context);
    expect([...streams.keys()]).toEqual(["Workbook"]);
    const pass = records.find(r => r.opcode === 0x2f);
    expect(pass?.data.bytes).toHaveLength(54);
    expect(pass?.data.bytes.subarray(0, 6)).toEqual(new Uint8Array([1, 0, 1, 0, 1, 0]));
    expect(pass?.data.bytes.subarray(6, 22)).toEqual(b.random.subarray(0, 16));
    expect(records.filter(r => r.opcode === 0x85).map(r => r.data.u32(0)))
      .toEqual(records.filter(r => r.opcode === 0x809).slice(1).map(r => r.offset));
    expect(new TextDecoder("utf-16le").decode(output)).not.toContain("Secret");
    const reopened = await readBiff(output, b.context);
    expect(reopened.sheets.map(s => ({ name: s.name, cells: s.cells.map(c => ({ value: c.value, formula: c.formula })) })))
      .toEqual(book.sheets.map(s => ({ name: s.name, cells: s.cells.map(c => ({ value: c.value, formula: c.formula })) })));
    expect(b.password.mock.calls[0]).toEqual([expect.objectContaining({ purpose: "encrypt", format: "biff", algorithm: "rc4",
      revision: 8, encoding: "utf16le", maxBytes: 510, outputFilename: "/private.xls" })]);
    expect(b.entropy).toHaveBeenCalledExactlyOnceWith({ length: 32, signal: context.signal });
    expect(b.random).toEqual(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    expect(book).toEqual(original);
    await expect(readBiff(output, bindings("wrong").context)).rejects.toThrow("password required");
  });

it("requires explicit capabilities and rejects unsupported writer profiles", async () => {
  await expect(createBiffWriter(8)(book, options, context)).rejects.toThrow("password and cryptographic entropy");
  const b = bindings();
  for (const profile of [7, "dsf"] as const)
    await expect(createBiffWriter(profile)(book, options, b.context)).rejects.toThrow("encryption profile");
  await expect(createBiffWriter(8)(book, ["encryption=unknown"], b.context)).rejects.toThrow("encryption profile");
  expect(b.password).not.toHaveBeenCalled();
  await createBiffWriter(8)(book, [], b.context);
  expect(b.entropy).not.toHaveBeenCalled();
});

it("matches the independently generated standard RC4 password verifier", async () => {
  // msoffcrypto-tool 6.0.0 key derivation and cryptography ARC4, password
  // 'password', salt 01..10 and verifier 11..20 (hex); MS-OFFCRYPTO 2.3.6.
  const output = await createBiffWriter(8)(book, options, bindings("password").context);
  const pass = readBiffRecords(readCfb(output, context).get("Workbook")!, context).find(r => r.opcode === 0x2f)!;
  expect(Buffer.from(pass.data.bytes.subarray(22)).toString("hex"))
    .toBe("acb443fe26de9f26bafb2d655aacd64df1092496b262f0cba1eb01453827e5f5");
});

it.each([undefined, "x".repeat(256), new Uint8Array(1), new Uint8Array(512)])(
  "rejects absent or invalid passwords before entropy acquisition (%#)", async secret => {
    const b = bindings(); b.password.mockImplementation(async () => secret!);
    await expect(createBiffWriter(8)(book, options, b.context)).rejects.toThrow("password");
    expect(b.entropy).not.toHaveBeenCalled();
  });

it("copies host-owned secrets before awaiting entropy and generates a fresh verifier and salt", async () => {
  const secret = new Uint8Array([0x61, 0]), b = bindings(secret);
  const entropy = { async read() { secret.fill(0x62); return b.random; } };
  const output = await createBiffWriter(8)(book, options, { ...b.context, entropy });
  expect((await readBiff(output, bindings("a").context)).sheets[0]!.name).toBe("Private");
  expect(secret).toEqual(new Uint8Array([0x62, 0x62]));
  b.random.fill(0x37);
  const other = await createBiffWriter(8)(book, options, bindings("a").context);
  expect(output).toEqual(other);
  expect(await createBiffWriter(8)(book, options, { ...bindings("a").context, entropy: b.context.entropy })).not.toEqual(output);
});

it("bounds cryptographic work before acquiring capabilities", async () => {
  const b = bindings();
  const stream = await writeBiffStream(book, 8, false, context, new Uint8Array(54));
  await expect(encryptBiffStream(stream, { ...b.context, limits: { ...context.limits, workbookWork: 0 } }))
    .rejects.toThrow("encryption work limit");
  expect(b.password).not.toHaveBeenCalled(); expect(b.entropy).not.toHaveBeenCalled();
});

it.each(["password", "entropy", "short-entropy", "absent-entropy", "work", "output", "cancel-password", "cancel-entropy"])(
  "preserves the public command destination on %s failure without leaking callback errors", async failure => {
    const b = bindings(), controller = new AbortController();
    if (failure === "password") b.password.mockRejectedValue(new Error("private-secret"));
    if (failure === "entropy") b.entropy.mockRejectedValue(new Error("private-secret"));
    if (failure === "short-entropy") b.entropy.mockResolvedValue(new Uint8Array(31));
    if (failure === "absent-entropy") b.entropy.mockResolvedValue(undefined!);
    if (failure === "cancel-password") b.password.mockImplementation(async () => { controller.abort(); return "private-secret"; });
    if (failure === "cancel-entropy") b.entropy.mockImplementation(async () => { controller.abort(); return b.random; });
    const limits = { ...context.limits, ...(failure === "work" ? { workbookWork: 0 } : {}), ...(failure === "output" ? { outputBytes: 2048 } : {}) };
    const fs = Volume.fromJSON({ "/in.csv": "42\n", "/out.xls": "untouched" }), diagnostics: string[] = [];
    const engine = createEngine({ codecs: [], environment: context.environment, limits, password: b.context.password, entropy: b.context.entropy,
      filesystem: { async read(path) { return [new Uint8Array(fs.readFileSync(path) as Uint8Array)]; }, async write(path, bytes) { fs.writeFileSync(path, bytes); } } });
    try {
      const command = runCommand(["-T", "Gnumeric_Excel:excel_biff8", "-O", options[0]!, "/in.csv", "/out.xls"], engine,
        { signal: controller.signal, stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(new TextDecoder().decode(bytes)); } } });
      if (failure.startsWith("cancel-")) await expect(command).rejects.toMatchObject({ name: "AbortError" });
      else expect((await command).exitCode).not.toBe(0);
      expect(fs.readFileSync("/out.xls", "utf8")).toBe("untouched");
      expect(diagnostics.join("")).not.toContain("private-secret");
    } finally { await engine.dispose(); }
  });

it("publishes encrypted output through the same public export option grammar", async () => {
  const b = bindings(), fs = Volume.fromJSON({ "/in.csv": "42\n" });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    password: b.context.password, entropy: b.context.entropy,
    filesystem: { async read(path) { return [new Uint8Array(fs.readFileSync(path) as Uint8Array)]; }, async write(path, bytes) { fs.writeFileSync(path, bytes); } } });
  try {
    const result = await runCommand(["-T", "Gnumeric_Excel:excel_biff8", "-O", options[0]!, "/in.csv", "/out.xls"], engine,
      { ...context, stdout: { async write() {} }, stderr: { async write() {} } });
    expect(result.exitCode).toBe(0);
    expect((await readBiff(new Uint8Array(fs.readFileSync("/out.xls") as Uint8Array), b.context)).sheets[0]!.cells[0]!.value)
      .toEqual({ kind: "number", value: 42 });
    expect(b.password.mock.calls[0]).toEqual([expect.objectContaining({ purpose: "encrypt", outputFilename: "/out.xls" })]);
  } finally { await engine.dispose(); }
});

it("checks cancellation inside long encrypted records", async () => {
  const b = bindings(), stream = await writeBiffStream(book, 8, false, context, new Uint8Array(54));
  let checks = 0;
  const signal = { throwIfAborted() { if (++checks === 80) throw new Error("cancel cipher"); } } as AbortSignal;
  await expect(encryptBiffStream(stream, { ...b.context, signal })).rejects.toThrow("cancel cipher");
  expect(b.random).toEqual(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
});
