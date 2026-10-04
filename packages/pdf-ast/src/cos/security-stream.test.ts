import { createCipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosHexString, cosName, cosNumber, cosRef, cosStream, type PdfCosNode } from "../ast.js";
import { derivePdfEncryptionKey, encryptPdfBuffer, decryptPdfStreamChunks, decodePdfEncryptedStreamChunks } from "./security.js";
import { ParsedCosDocument } from "./parser.js";
import { decryptCosDocument } from "./security.js";
import { encodeAsciiHex, encodeFlate } from "./filters.js";

const vectors = JSON.parse(readFileSync(new URL("../fixtures/pdfjs-security-vectors.json", import.meta.url), "utf8")) as {
  fileId1: string; dictionaries: Record<string, Record<string, string | number | { name: string }>>;
};
function state(kind: "RC4" | "AESV2" | "AESV3", overrides: Record<string, PdfCosNode> = {}) {
  const entries = Object.fromEntries(Object.entries(vectors.dictionaries[kind === "AESV3" ? "aes256IsoDict" : "dict1"]!).map(([key, value]): [string, PdfCosNode] => [key,
    typeof value === "number" ? cosNumber(value) : typeof value === "string" ? cosHexString(new Uint8Array(Buffer.from(value, "hex"))) : cosName(value.name),
  ]));
  const filters = kind === "RC4" ? {} : { CF: cosDict({ StdCF: cosDict({ CFM: cosName(kind) }) }), StrF: cosName("StdCF"), StmF: cosName("StdCF") };
  return derivePdfEncryptionKey(cosDict({ ...entries, ...filters, ...(kind === "AESV2" ? { V: cosNumber(4), R: cosNumber(4) } : {}), ...overrides }),
    Buffer.from(vectors.fileId1, "hex"), kind === "AESV3" ? "user" : "123456");
}
async function* chunks(bytes: Uint8Array, length = 7) {
  const scratch = new Uint8Array(length);
  for (let i = 0; i < bytes.length; i += length) { const part = bytes.subarray(i, i + length); scratch.set(part); yield scratch.subarray(0, part.length); }
}
async function collect(input: AsyncIterable<Uint8Array>, maximum = 31) {
  const result: number[] = [];
  for await (const chunk of input) { expect(chunk.length).toBeLessThanOrEqual(maximum); result.push(...chunk); }
  return new Uint8Array(result);
}
function encrypted(plain: Uint8Array, key: Uint8Array) {
  const iv = new Uint8Array(16).fill(7);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return new Uint8Array(Buffer.concat([iv, cipher.update(plain), cipher.final()]));
}

describe("bounded PDF stream security", () => {
  it.each([false, true])("decrypts native image payloads with explicit Crypt=%s", async explicit => {
    const security = state("AESV3");
    const plain = new Uint8Array([255, 216, 17, 23, 255, 217]);
    const raw = explicit ? encodeAsciiHex(encrypted(plain, security.fileKey)) : encrypted(encodeAsciiHex(plain), security.fileKey);
    const dict = cosDict({ Filter: cosArray([cosName("ASCIIHexDecode"), ...(explicit ? [cosName("Crypt")] : []), cosName("DCTDecode"), cosName("Unsupported")]),
      DecodeParms: cosArray([cosDict({}), ...(explicit ? [cosDict({ Name: cosName("StdCF") })] : [])]) });
    expect(await collect(decodePdfEncryptedStreamChunks(security, 2, 0, dict, () => chunks(raw), { chunkBytes: 31, stopBeforeImageCodec: true }))).toEqual(plain);
  });
  it("bounds native bytes when explicit Crypt occurs after the image boundary", async () => {
    const security = state("AESV3");
    const bytes = new Uint8Array(80).fill(17);
    const dict = cosDict({ Filter: cosArray([cosName("DCTDecode"), cosName("Crypt")]) });
    const options = { chunkBytes: 7, stopBeforeImageCodec: true };
    expect(await collect(decodePdfEncryptedStreamChunks(security, 2, 0, dict, chunks(bytes, 80), options), 7)).toEqual(bytes);
    await expect(collect(decodePdfEncryptedStreamChunks(security, 2, 0, dict, chunks(bytes, 80), { ...options, maxDecodedBytes: 79 }))).rejects.toMatchObject({ code: "E_LIMIT" });
  });

  it.each(["RC4", "AESV2", "AESV3"] as const)("decrypts %s across arbitrary input and final padding boundaries", async kind => {
    const security = state(kind);
    for (const size of [0, 1, 15, 16, 17, 511, 512, 513, 1031]) {
      const plain = Uint8Array.from({ length: size }, (ignored, i) => i % 251);
      const cipher = encryptPdfBuffer(security, 15, 3, plain);
      for (const length of [1, 7, 16, 31, 513]) expect(await collect(decryptPdfStreamChunks(security, 15, 3, chunks(cipher, length), { chunkBytes: 31 }))).toEqual(plain);
    }
  });

  it("uses StmF independently of StrF and EFF for attachments", async () => {
    const security = state("AESV3", { StrF: cosName("Identity"), StmF: cosName("Identity"), EFF: cosName("StdCF") });
    const plain = new TextEncoder().encode("separate string and stream ciphers");
    expect(await collect(decryptPdfStreamChunks(security, 1, 0, chunks(plain), { chunkBytes: 31 }))).toEqual(plain);
    expect(await collect(decryptPdfStreamChunks(security, 1, 0, chunks(encrypted(plain, security.fileKey)), { chunkBytes: 31, type: "EmbeddedFile" }))).toEqual(plain);
  });

  it.each(["Identity", "StdCF"])("respects explicit Crypt %s at its declared filter position", async name => {
    const security = state("AESV3");
    const plain = new TextEncoder().encode("ASCIIHex then Crypt then Flate");
    const compressed = encodeFlate(plain);
    const raw = encodeAsciiHex(name === "Identity" ? compressed : encrypted(compressed, security.fileKey));
    const dict = cosDict({ Filter: cosArray([cosName("ASCIIHexDecode"), cosName("Crypt"), cosName("FlateDecode")]),
      DecodeParms: cosArray([cosDict({}), cosDict({ Name: cosName(name) }), cosDict({})]) });
    expect(await collect(decodePdfEncryptedStreamChunks(security, 2, 0, dict, () => chunks(raw), { chunkBytes: 31 }))).toEqual(plain);
  });

  it("keeps XRef and excluded Metadata plaintext", async () => {
    const security = state("AESV3");
    const plain = new TextEncoder().encode("plaintext structural stream");
    for (const type of ["XRef", "Metadata"]) {
      const effective = type === "Metadata" ? state("AESV3", { EncryptMetadata: { kind: "boolean", value: false } }) : security;
      expect(await collect(decodePdfEncryptedStreamChunks(effective, 2, 0, cosDict({ Type: cosName(type) }), () => chunks(plain), { chunkBytes: 31 }))).toEqual(plain);
    }
  });

  it("closes its input on output limit, cancellation and early return", async () => {
    const security = state("RC4");
    const cipher = encryptPdfBuffer(security, 1, 0, new Uint8Array(1024));
    let returned = 0;
    async function* input() { try { yield* chunks(cipher, 7); } finally { returned++; } }
    await expect(collect(decryptPdfStreamChunks(security, 1, 0, input(), { chunkBytes: 31, maxDecodedBytes: 3 }))).rejects.toThrow("limit");
    expect(returned).toBe(1);
    const abort = new AbortController();
    const stream = decryptPdfStreamChunks(security, 1, 0, input(), { chunkBytes: 31, signal: abort.signal });
    await stream.next(); abort.abort(new Error("cancel stream"));
    await expect(stream.next()).rejects.toThrow("cancel stream");
    expect(returned).toBe(2);
    for await (const ignored of decryptPdfStreamChunks(security, 1, 0, input(), { chunkBytes: 31 })) break;
    expect(returned).toBe(3);
  });

  it("does not consume the full ciphertext before first output", async () => {
    const security = state("RC4");
    let pulls = 0;
    async function* input() { const reused = new Uint8Array(16); for (let i = 0; i < 4096; i++) { pulls++; yield reused; } }
    const stream = decryptPdfStreamChunks(security, 1, 0, input(), { chunkBytes: 31 });
    const first = await stream.next();
    expect(first.value?.length).toBeGreaterThan(0); expect(pulls).toBeLessThanOrEqual(33);
    await stream.return();
  });
  it("preserves buffered recovery for truncated AES blocks", async () => {
    const security = state("AESV3");
    const cipher = encrypted(new Uint8Array(1100).fill(1), security.fileKey);
    for (const length of [1, 15, 17, 31, 511, 513, 529, 1023, 1030]) {
      const raw = cipher.subarray(0, length);
      const doc = new ParsedCosDocument({ version: "2.0", bytes: new Uint8Array(), rootRef: cosRef(1), revisions: [], objects: new Map(), encryption: security });
      doc.setObject(1, cosStream(raw)); decryptCosDocument(doc, security);
      const object = doc.getObject(1);
      if (object?.kind !== "stream") throw new Error("Expected stream");
      expect(await collect(decryptPdfStreamChunks(security, 1, 0, chunks(raw), { chunkBytes: 31 }))).toEqual(object.rawBytes);
    }
  });

});
it.each([false, true])("raw stream recovery still decrypts through the last explicit Crypt (%s)", async explicit => {
  const security = state("AESV3"); const plain = encodeFlate(new Uint8Array(40).fill(17));
  const cipher = encrypted(plain, security.fileKey); const raw = explicit ? encodeAsciiHex(cipher) : cipher;
  const dict = cosDict({ Filter: cosArray([...(explicit ? [cosName("ASCIIHexDecode"), cosName("Crypt")] : []), cosName("FlateDecode"), cosName("Unsupported")]),
    DecodeParms: cosArray(explicit ? [cosDict({}), cosDict({ Name: cosName("StdCF") })] : []) });
  expect(await collect(decodePdfEncryptedStreamChunks(security, 2, 0, dict, () => chunks(raw), { raw: true, chunkBytes: 31 }))).toEqual(plain);
});
it("raw recovery reaches the final Crypt while preserving admission and plaintext metadata", async () => {
  const security = state("AESV3"); const plain = new Uint8Array(40).fill(17);
  const raw = encodeAsciiHex(encrypted(encodeAsciiHex(encrypted(plain, security.fileKey)), security.fileKey));
  const dict = cosDict({ Filter: cosArray([cosName("ASCIIHexDecode"), cosName("Crypt"), cosName("ASCIIHexDecode"), cosName("Crypt"), cosName("Unsupported")]),
    DecodeParms: cosArray([cosDict({}), cosDict({ Name: cosName("StdCF") }), cosDict({}), cosDict({ Name: cosName("StdCF") })]) });
  expect(await collect(decodePdfEncryptedStreamChunks(security, 2, 0, dict, () => chunks(raw), { raw: true, chunkBytes: 31 }))).toEqual(plain);
  await expect(collect(decodePdfEncryptedStreamChunks(security, 2, 0, dict, () => chunks(raw), { raw: true, chunkBytes: 31, maxDecodedBytes: 39 }))).rejects.toMatchObject({ code: "E_LIMIT" });
  const metadata = state("AESV3", { EncryptMetadata: { kind: "boolean", value: false } });
  expect(await collect(decodePdfEncryptedStreamChunks(metadata, 2, 0, cosDict({ Type: cosName("Metadata"), Filter: cosName("Unsupported") }), () => chunks(plain), { raw: true, chunkBytes: 31 }))).toEqual(plain);
});


it.each(["RC4", "AESV2", "AESV3"] as const)("decrypts caller-backed strings with the %s string cipher", async kind => {
  const { decryptPdfObjectStrings } = await import("./security.js");
  const security = state(kind, kind === "RC4" ? {} : { StmF: cosName("Identity") });
  const plain = new TextEncoder().encode("backed text ".repeat(2048)), ciphertext = encryptPdfBuffer(security, 15, 3, plain);
  const data = new Uint8Array(ciphertext.length * 2 + 1024); data.set(ciphertext); let end = ciphertext.length;
  const storage = { allocate(n: number) { const at = end; end += n; return at; },
    async read(at: number, n: number) { expect(n).toBeLessThanOrEqual(512); return data.subarray(at, at + n); },
    async write(at: number, bytes: Uint8Array) { expect(bytes.length).toBeLessThanOrEqual(512); data.set(bytes, at); } };
  const node = await decryptPdfObjectStrings(security, 15, 3, { kind: "string", encoding: "hex", bytes: new Uint8Array(), storedBytes: {storage, position: 0, byteLength: ciphertext.length} });
  if (node.kind !== "string" || !node.storedBytes) throw Error("Expected stored string");
  expect(node.storedBytes.byteLength).toBe(plain.length);
  expect(data.subarray(node.storedBytes.position, node.storedBytes.position + node.storedBytes.byteLength)).toEqual(plain);
  expect(data.subarray(0, ciphertext.length)).toEqual(ciphertext);
});


it.each(["AESV2", "AESV3"] as const)("preserves %s stored-string recovery and cancellation", async kind => {
  const { decryptPdfObjectStrings, decryptPdfBuffer } = await import("./security.js");
  const security = state(kind), ciphertext = encryptPdfBuffer(security, 7, 0, new Uint8Array(1024).fill(77));
  for (const length of [0, 1, 15, 16, 17, 511, 512, 513, ciphertext.length - 1, ciphertext.length]) {
    const input = ciphertext.slice(0, length), data = new Uint8Array(length * 2 + 512); data.set(input);
    const storage = { allocate() { return length; }, async read(at: number, n: number) { return data.subarray(at, at + n); }, async write(at: number, bytes: Uint8Array) { data.set(bytes, at); } };
    const result = await decryptPdfObjectStrings(security, 7, 0, {kind: "string", encoding: "hex", bytes: new Uint8Array(), storedBytes: {storage, position: 0, byteLength: length}});
    if (result.kind !== "string" || !result.storedBytes) throw Error("Expected stored string");
    expect(data.slice(result.storedBytes.position, result.storedBytes.position + result.storedBytes.byteLength)).toEqual(decryptPdfBuffer(security, 7, 0, input));
  }
  const controller = new AbortController(), failure = new Error("cancelled string read");
  const storage = { allocate() { return 0; }, async read(at: number, n: number) { controller.abort(failure); return ciphertext.subarray(at, at + n); }, async write() { throw Error("write after cancellation"); } };
  await expect(decryptPdfObjectStrings(security, 7, 0, {kind: "string", encoding: "hex", bytes: new Uint8Array(), storedBytes: {storage, position: 0, byteLength: ciphertext.length}}, {signal: controller.signal})).rejects.toBe(failure);
});
