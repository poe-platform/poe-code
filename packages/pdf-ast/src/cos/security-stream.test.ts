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
