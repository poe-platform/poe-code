import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import defaultProof from "../../../../docs/ssconvert/biff-rc4-gap-proof.json" with { type: "json" };
import proof from "../../../../docs/ssconvert/biff-password-gap-proof.json" with { type: "json" };
import type { CapabilityContext, PasswordCapability } from "../contracts.js";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { readBiff } from "./biff.js";
import { Binary, readBiffRecords } from "./biff-binary.js";
import { decryptBiffRecords } from "./biff-encryption.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: { PWD: "/wrong" }, cwd: "/actual", locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const bytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
const rc4 = proof.cases[1]!;

it.each(proof.cases)("acquires one explicit host password for $id", async fixture => {
  const read = vi.fn(async () => fixture.algorithm === "xor" ? bytes(fixture.passwordHex) : fixture.password);
  const input = bytes(fixture.inputHex), original = input.slice();
  const book = await readBiff(input, { ...context, inputFilename: "/actual/input.xls", password: { read } });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
  expect(input).toEqual(original);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0]).toEqual([expect.objectContaining({ format: "biff", algorithm: fixture.algorithm,
    revision: 8, encoding: fixture.algorithm === "xor" ? "bytes" : "utf16le",
    maxBytes: fixture.algorithm === "xor" ? 15 : 510, inputFilename: "/actual/input.xls", signal: context.signal })]);
});
it.each(proof.cases.filter(f => f.algorithm !== "xor"))("accepts explicit UTF-16LE bytes for $id", async fixture => {
  const book = await readBiff(bytes(fixture.inputHex), { ...context, password: { async read() { return bytes(fixture.passwordHex); } } });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});
it("never acquires a secret for plaintext, duplicate or unsupported headers", async () => {
  const read = vi.fn(async () => rc4.password), records = readBiffRecords(bytes(rc4.inputHex), context);
  const header = records.find(r => r.opcode === 0x2f)!;
  await decryptBiffRecords([], 8, { ...context, password: { read } });
  await expect(decryptBiffRecords([header, header], 8, { ...context, password: { read } })).rejects.toThrow("duplicate FILEPASS");
  const altered = header.data.bytes.slice(); altered[2] = 5;
  await expect(decryptBiffRecords([{ ...header, data: new Binary(altered) }], 8, { ...context, password: { read } }))
    .rejects.toThrow("encrypted Excel workbook");
  await expect(decryptBiffRecords([{ ...header, data: new Binary(altered.subarray(0, 5)) }], 8, { ...context, password: { read } }))
    .rejects.toThrow("Invalid Excel BIFF");
  expect(read).not.toHaveBeenCalled();
});
it.each([undefined, "wrong", "x".repeat(256), new Uint8Array(511), new Uint8Array(1)])("refuses absent, wrong or excessive RC4 passwords (%#)", async secret => {
  const read = vi.fn(async () => secret);
  await expect(readBiff(bytes(rc4.inputHex), { ...context, password: { read } })).rejects.toThrow("encrypted Excel workbook password");
  expect(read).toHaveBeenCalledTimes(1);
});
it.each(["x", new Uint8Array(0), new Uint8Array(16)])("requires explicit bounded XOR password bytes (%#)", async secret => {
  await expect(readBiff(bytes(proof.cases.at(-1)!.inputHex), { ...context, password: { async read() { return secret; } } }))
    .rejects.toThrow("encrypted Excel workbook password");
});
it("charges both RC4 verification attempts before any plaintext payload copy", async () => {
  const records = readBiffRecords(bytes(rc4.inputHex), context), data = records.find(r => r.opcode === 0x42)!.data;
  const copy = vi.spyOn(data.bytes, "slice"), read = vi.fn(async () => rc4.password);
  await expect(decryptBiffRecords(records, 8, { ...context, password: { read }, limits: { ...context.limits, workbookWork: 1599 } }))
    .rejects.toThrow("decryption work limit");
  expect(read).toHaveBeenCalledTimes(1);
  expect(copy).not.toHaveBeenCalled();
});
it("observes cancellation after host acquisition without retaining or publishing plaintext", async () => {
  const controller = new AbortController(), input = bytes(rc4.inputHex), original = input.slice();
  await expect(readBiff(input, { ...context, signal: controller.signal, password: { async read(request) {
    expect(request.signal).toBe(controller.signal); controller.abort(new Error("cancel acquisition")); return rc4.password;
  } } })).rejects.toThrow("cancel acquisition");
  expect(input).toEqual(original);
});
it("snapshots host callback and sanitizes callback errors at the public command boundary", async () => {
  const volume = Volume.fromJSON({ "/target.csv": "untouched\n" }); volume.writeFileSync("/input.xls", bytes(rc4.inputHex));
  let writes = 0;
  const password: PasswordCapability = { async read() { throw new Error("secret:" + rc4.password); } };
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits, password,
    filesystem: { cwd: "/", async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, value) { writes++; volume.writeFileSync(uri, value); } } });
  password.read = vi.fn(async () => rc4.password);
  const stderr: Uint8Array[] = [];
  try {
    expect(await runCommand(["/input.xls", "/target.csv"], engine, { signal: context.signal,
      stdout: { async write() {} }, stderr: { async write(value) { stderr.push(value); } } })).toMatchObject({ exitCode: 1 });
    const diagnostic = Buffer.concat(stderr).toString();
    expect(diagnostic).toContain("encrypted Excel workbook password acquisition failed");
    expect(diagnostic).not.toContain(rc4.password);
    expect(password.read).not.toHaveBeenCalled();
    expect(writes).toBe(0); expect(volume.readFileSync("/target.csv", "utf8")).toBe("untouched\n");
  } finally { await engine.dispose(); }
});

it.each(proof.cases)("publishes exact nondefault-password conversion for $id", async fixture => {
  const input = bytes(fixture.inputHex), volume = Volume.fromJSON({ "/target.csv": "untouched\n" });
  volume.writeFileSync("/input.xls", input);
  const read = vi.fn<PasswordCapability["read"]>(async request => {
    expect(request.inputFilename).toBe("/input.xls");
    return bytes(fixture.passwordHex);
  });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits, password: { read },
    filesystem: { cwd: "/", async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, value) { volume.writeFileSync(uri, value); } } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  try {
    expect(await runCommand(["/input.xls", "/target.csv"], engine, { signal: context.signal,
      stdout: { async write(value) { stdout.push(value); } }, stderr: { async write(value) { stderr.push(value); } } }))
      .toMatchObject({ exitCode: 0 });
    expect(volume.readFileSync("/target.csv", "utf8")).toBe(fixture.expectedCsv);
    expect(new Uint8Array(volume.readFileSync("/input.xls") as Uint8Array)).toEqual(input);
    expect(stdout).toEqual([]); expect(stderr).toEqual([]); expect(read).toHaveBeenCalledTimes(1);
  } finally { await engine.dispose(); }
});

it("does not acquire a host password when the built-in password succeeds", async () => {
  const read = vi.fn(async () => { throw new Error("host reader must not run"); });
  const book = await readBiff(bytes(defaultProof.cases[0]!.inputHex), { ...context, password: { read } });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
  expect(read).not.toHaveBeenCalled();
});
