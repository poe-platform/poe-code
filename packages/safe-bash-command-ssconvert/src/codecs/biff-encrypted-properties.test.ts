import { expect, it, vi } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb, readBiffRecords } from "./biff-binary.js";
import { writeCfb } from "./biff-write-binary.js";
import { decryptBiffPropertyContainer } from "./biff-encrypted-properties.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10, sheets: 2, operations: 1000 } };
const book = { sheets: [{ id: "S", name: "S", cells: [] }] };
const secret = { ...context, password: { async read() { return "secret"; } },
  entropy: { async read() { return Uint8Array.from({ length: 32 }, (_, i) => i); } } };
// Original MS-OFFCRYPTO 2.3.5.4 container, independently encrypted with OpenSSL RC4.
// SHA1(salt 00..0f || UTF16LE("secret")); block keys use SHA1(base || LE32(block))[:16].
const encrypted = Uint8Array.from(Buffer.from("fe6a81280c1ef55de8958128891ef75d95345f12e886dc3ac94ac4f8328db93f70b854ec31559923e23b9c7fa112565665d797707b801076bfe79ed2f2d75a0ee15f610681e0a8117ff2d5e20c57a734c9786e3d6359dc1ae2f01c1e825ab00d73f3863047e4cad96d2761cd24d25769bc2b19efb7dab9b1f934ff927c7c12720800443db3db7b850147584cf8621f43445745d591e9b343215767c85bd79040ce9157a22a2b821cc884c57a59914805a8bbce3d0e425d0f64961e666f4d67777ef1acb72976b963e0a729fc66ab58b23f68ea5806bd4c1cd0f9be4682cca92e37e90141db1699f4146a8128801ef55df5345f12e886cf3bc94ac4f8378dea3f04b839ecbcd067d169748d6f4383305628f04ba939807d76eee7ead299d7350e8e5f6106f1e0a811fdf2d5e22d57bc35cb786e3d8fa4981a93f07f1ef05add0d5e9a8c54568a99d966ff57e4eade700e2eb6acc32413fa6faff7d4e552c93b5225b5b30e1fc1bb32e0ed54c6", "hex"));

async function fixture(container = encrypted): Promise<Uint8Array> {
  const plain = await createBiffWriter(8)(book, ["encryption=rc4-cryptoapi-128"], secret);
  const workbook = readCfb(plain, context).get("Workbook")!;
  const pass = readBiffRecords(workbook, context).find(record => record.opcode === 0x2f)!;
  pass.data.view.setUint32(6, 4, true); pass.data.view.setUint32(14, 4, true);
  return writeCfb(new Map([["Workbook", workbook], ["encryption", container]]), context);
}

it("imports the independently encrypted title and custom property with one password request", async () => {
  const bytes = await fixture(), original = bytes.slice(), read = vi.fn(async () => "secret");
  const result = await readBiff(bytes, { ...context, password: { read } });
  expect(result.properties).toEqual({ "dc:title": "Hidden", Note: "Secret note" });
  expect(read).toHaveBeenCalledTimes(1);
  expect(bytes).toEqual(original);
});

it("rejects a truncated encrypted container before requesting a password", async () => {
  const read = vi.fn(async () => "secret");
  await expect(readBiff(await fixture(new Uint8Array(7)), { ...context, password: { read } })).rejects.toMatchObject({ code: "io" });
  expect(read).not.toHaveBeenCalled();
});

it("accepts the empty plaintext document-summary placeholder used by native writers", async () => {
  const streams = new Map(readCfb(await fixture(), context)), placeholder = new Uint8Array(56), view = new DataView(placeholder.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint32(24, 1, true); view.setUint32(44, 48, true); view.setUint32(48, 8, true);
  placeholder.set(Buffer.from("02d5cdd59c2e1b10939708002b2cf9ae", "hex"), 28);
  streams.set("\u0005DocumentSummaryInformation", placeholder);
  expect((await readBiff(writeCfb(streams, context), secret)).properties).toEqual({ "dc:title": "Hidden", Note: "Secret note" });
});

it("rejects plaintext summary collisions before requesting a password", async () => {
  const streams = new Map(readCfb(await fixture(), context)), read = vi.fn(async () => "secret");
  streams.set("\u0005SummaryInformation", new Uint8Array([1]));
  await expect(readBiff(writeCfb(streams, context), { ...context, password: { read } })).rejects.toThrow("ambiguous plaintext");
  expect(read).not.toHaveBeenCalled();
});

it("keeps the password refusal when an encrypted property container is present", async () => {
  const read = vi.fn(async () => "wrong");
  await expect(readBiff(await fixture(), { ...context, password: { read } })).rejects.toThrow("password required");
  expect(read).toHaveBeenCalledTimes(1);
});

it("rejects an impossible encrypted descriptor count after password verification", async () => {
  const broken = encrypted.slice(); broken[232]! ^= 0xff;
  await expect(readBiff(await fixture(broken), secret)).rejects.toThrow("encrypted property descriptor count");
});

it("retains an unknown decrypted ancillary stream with an explicit diagnostic", async () => {
  // Same independent OpenSSL derivation, descriptor block 7 and payload 01 02 03 04.
  const unknown = Uint8Array.from(Buffer.from("1a6a8128a01ef55dd26cbaa5176a8128801ef55d91345f12ef86d53bc94ac4f8738dd73f12b83decbdd06ad17a74866f73835e56", "hex"));
  const warnings: string[] = [];
  const result = await readBiff(await fixture(unknown), { ...secret, async diagnostic(d) { warnings.push(d.message); } });
  expect(result.unsupportedRecords).toContainEqual({ source: "biff", kind: "encrypted-ancillary", disposition: "retained",
    data: { stream: "Ancillary", bytes: "01020304" } });
  expect(warnings).toEqual([expect.stringContaining("Ancillary")]);
});

// A small clear framing control isolates descriptor admission from the cipher.
function framed(): Uint8Array {
  const bytes = new Uint8Array(52), view = new DataView(bytes.buffer);
  view.setUint32(0, 12, true); view.setUint32(4, 40, true); bytes.set([1, 2, 3, 4], 8);
  view.setUint32(12, 1, true); view.setUint32(16, 8, true); view.setUint32(20, 4, true);
  view.setUint16(24, 7, true); bytes[26] = 9; bytes[27] = 1;
  for (let i = 0; i < 9; i++) view.setUint16(32 + i * 2, "Ancillary".charCodeAt(i), true);
  return bytes;
}

it("owns decrypted buffers and uses the descriptor block independently of its offset", async () => {
  const cleanups: (() => void | Promise<void>)[] = [], stream = vi.fn((_block: number, length: number) => new Uint8Array(length));
  const result = decryptBiffPropertyContainer(framed(), stream, { ...context, own(cleanup) { cleanups.push(cleanup); } }, () => {});
  const bytes = result.get("Ancillary")!;
  expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(stream.mock.calls).toEqual([[0, 8], [0, 40], [7, 4]]);
  for (const cleanup of cleanups) await cleanup();
  expect(bytes).toEqual(new Uint8Array(4)); expect(result.size).toBe(0);
});

it("does not publish plaintext when disposed while generating a payload keystream", () => {
  let cleanup: (() => void | Promise<void>) | undefined;
  const stream = (block: number, length: number) => { if (block === 7) void cleanup?.(); return new Uint8Array(length); };
  expect(() => decryptBiffPropertyContainer(framed(), stream, { ...context, own(value) { cleanup = value; } }, () => {})).toThrow("disposed");
});

it("admits name text before decoding it", () => {
  const decode = vi.spyOn(TextDecoder.prototype, "decode");
  try {
    expect(() => decryptBiffPropertyContainer(framed(), (_block, length) => new Uint8Array(length),
      { ...context, limits: { ...context.limits, workbookTextBytes: 1 } }, () => {})).toThrow("text limit");
    expect(decode).not.toHaveBeenCalled();
  } finally { decode.mockRestore(); }
});

it.each(["range", "overlap", "flags", "name", "terminator", "size"])("rejects malformed encrypted property %s", kind => {
  const bytes = framed(), view = new DataView(bytes.buffer);
  if (kind === "range") view.setUint32(16, 100, true);
  if (kind === "overlap") view.setUint32(16, 12, true);
  if (kind === "flags") bytes[27] = 0;
  if (kind === "name") bytes[26] = 32;
  if (kind === "terminator") bytes[50] = 1;
  if (kind === "size") view.setUint32(4, 39, true);
  expect(() => decryptBiffPropertyContainer(bytes, (_block, length) => new Uint8Array(length), context, () => {})).toThrow("Invalid Excel BIFF");
});
