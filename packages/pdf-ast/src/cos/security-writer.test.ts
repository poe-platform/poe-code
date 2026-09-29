import { createDecipheriv } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosStream, cosString, dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { bytesToString, stringToBytes } from "../bytes.js";
import { CipherTransformFactory, Dict, Name, Stream } from "../vendor/pdfjs-fonts.mjs";
import { parseCosDocument } from "./parser.js";
import { encryptCosDocument, encryptPdfBuffer } from "./security.js";
import { serializeCosDocument } from "./writer.js";

function inputDocument(version = "1.7") {
  return parseCosDocument(serializeCosDocument({
    objects: [
      { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
      { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }) },
      { objectNumber: 3, generationNumber: 0, value: cosDict({ Title: cosString("Independent encryption check") }) },
      { objectNumber: 4, generationNumber: 0, value: cosStream(new TextEncoder().encode("Confidential stream payload")) },
    ], rootRef: cosRef(1), infoRef: cosRef(3), version,
  }));
}

function dictionaryBytes(dict: PdfCosDict, name: string): Uint8Array {
  const value = dictGet(dict, name);
  expect(value?.kind, name).toBe("string");
  if (value?.kind !== "string") throw new Error(`Missing ${name}`);
  return value.bytes;
}

function pdfJsValue(node: PdfCosNode): unknown {
  switch (node.kind) {
    case "name": return Name.get(node.decoded);
    case "string": return bytesToString(node.bytes);
    case "number": case "boolean": return node.value;
    case "array": return node.items.map(pdfJsValue);
    case "dict": {
      const result = new Dict();
      for (const entry of node.entries) result.set(entry.key.decoded, pdfJsValue(entry.value));
      return result;
    }
    default: throw new Error(`Unexpected encryption value: ${node.kind}`);
  }
}

const passwords = { userPassword: "fixture-user", ownerPassword: "fixture-owner" };
afterEach(() => vi.restoreAllMocks());

describe("standard encryption writer interoperability", () => {
  it("emits AESV3 crypt filters and an independently verifiable permissions block", () => {
    const bytes = encryptCosDocument(inputDocument(), passwords);
    const parsed = parseCosDocument(bytes, { password: passwords.userPassword });
    const dict = parsed.resolveDict(parsed.encryptRef)!;
    const cf = dictGet(dict, "CF");
    expect(cf?.kind).toBe("dict");
    if (cf?.kind !== "dict") throw new Error("Missing crypt filters");
    const std = dictGet(cf, "StdCF");
    expect(std?.kind).toBe("dict");
    if (std?.kind !== "dict") throw new Error("Missing standard crypt filter");
    expect(dictGet(std, "CFM")).toMatchObject({ kind: "name", decoded: "AESV3" });
    expect(dictGet(std, "AuthEvent")).toMatchObject({ kind: "name", decoded: "DocOpen" });
    expect(dictGet(std, "Length")).toMatchObject({ kind: "number", value: 32 });
    expect(dictGet(dict, "StmF")).toMatchObject({ kind: "name", decoded: "StdCF" });
    expect(dictGet(dict, "StrF")).toMatchObject({ kind: "name", decoded: "StdCF" });
    const decipher = createDecipheriv("aes-256-ecb", parsed.encryption!.fileKey, null);
    decipher.setAutoPadding(false);
    const permissions = Buffer.concat([decipher.update(dictionaryBytes(dict, "Perms")), decipher.final()]);
    expect(permissions.readInt32LE(0)).toBe(-1052);
    expect(permissions.subarray(4, 12)).toEqual(Buffer.from([255, 255, 255, 255, 84, 97, 100, 98]));
    expect(parsed.version).toBe("2.0");
  });

  it("uses fresh file keys, password salts, file identifiers, and object IVs", () => {
    const firstBytes = encryptCosDocument(inputDocument(), passwords);
    const secondBytes = encryptCosDocument(inputDocument(), passwords);
    expect(firstBytes).not.toEqual(secondBytes);
    const first = parseCosDocument(firstBytes, { password: passwords.userPassword });
    const second = parseCosDocument(secondBytes, { password: passwords.userPassword });
    expect(first.encryption!.fileKey).not.toEqual(second.encryption!.fileKey);
    expect(first.idArray).not.toEqual(second.idArray);
    for (const key of ["U", "O"]) {
      expect(dictionaryBytes(first.resolveDict(first.encryptRef)!, key).subarray(32))
        .not.toEqual(dictionaryBytes(second.resolveDict(second.encryptRef)!, key).subarray(32));
    }
    const one = encryptPdfBuffer(first.encryption!, 3, 0, new Uint8Array(32));
    const two = encryptPdfBuffer(first.encryption!, 3, 0, new Uint8Array(32));
    expect(one.subarray(0, 16)).not.toEqual(two.subarray(0, 16));
  });

  it("fails when cryptographic entropy is unavailable", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => { throw new Error("Entropy unavailable"); });
    expect(() => encryptCosDocument(inputDocument(), passwords)).toThrow("Entropy unavailable");
  });

  it("raises pre-1.4 headers when writing revision 3 encryption", () => {
    const bytes = encryptCosDocument(inputDocument("1.0"), { ...passwords, revision: 3 });
    expect(parseCosDocument(bytes, { password: passwords.userPassword }).version).toBe("1.4");
  });

  it("honors explicit revision 3 and uses RC4 with a 128-bit key", () => {
    const bytes = encryptCosDocument(inputDocument(), { ...passwords, revision: 3 });
    const parsed = parseCosDocument(bytes, { password: passwords.userPassword });
    expect(parsed.encryption!.revision).toBe(3);
    expect(parsed.encryption!.version).toBe(2);
    expect(parsed.encryption!.fileKey.length).toBe(16);
    expect(parsed.getInfoString("Title")).toBe("Independent encryption check");
    expect(bytesToString(parsed.getDecodedStream(4)!)).toBe("Confidential stream payload");
  });

  it.each([3, 6] as const)("opens revision %i with PDF.js using both user and owner passwords", revision => {
    for (const [userPassword, ownerPassword] of [["fixture-user", "fixture-owner"], ["pässwört", "Öwner"]]) {
      const bytes = encryptCosDocument(inputDocument(), { userPassword, ownerPassword, revision });
      const parsed = parseCosDocument(bytes, { password: userPassword });
      const dict = pdfJsValue(parsed.resolveDict(parsed.encryptRef)!) as Dict;
      const id = parsed.idArray!.items[0]!;
      if (id.kind !== "string") throw new Error("Missing ID");
      for (const password of [userPassword, ownerPassword]) {
        const factory = new CipherTransformFactory(dict, bytesToString(id.bytes), password);
        expect(factory.encryptionKey).toEqual(parsed.encryption!.fileKey);
        const plaintext = Uint8Array.from({ length: 256 }, (_, i) => i);
        const ciphertext = encryptPdfBuffer(parsed.encryption!, 123, 7, plaintext);
        const transform = factory.createCipherTransform(123, 7);
        expect(stringToBytes(transform.decryptString(bytesToString(ciphertext)))).toEqual(plaintext);
        expect(transform.createStream(new Stream(ciphertext), ciphertext.length).getBytes()).toEqual(plaintext);
      }
      expect(() => new CipherTransformFactory(dict, bytesToString(id.bytes), "wrong")).toThrow();
    }
  });

  // Length cases ported from PDF.js test/unit/crypto_spec.js, AES256.
  // Validate ciphertext with Node's independent AES implementation.
  it.each([0, 4, 5, 16, 22])("pads an AES256 string of %i bytes, including complete blocks", length => {
    const parsed = parseCosDocument(encryptCosDocument(inputDocument(), passwords), { password: passwords.userPassword });
    const plain = new Uint8Array(length).fill(97);
    const encrypted = encryptPdfBuffer(parsed.encryption!, 17, 2, plain);
    expect(encrypted.length).toBe(16 + 16 * (Math.floor(length / 16) + 1));
    const decipher = createDecipheriv("aes-256-cbc", parsed.encryption!.fileKey, encrypted.subarray(0, 16));
    expect(new Uint8Array(Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]))).toEqual(plain);
  });

  // pypdf 6.19.0 AlgV4/AlgV5 values with each random request filled 0,1,... .
  it.each([3, 6] as const)("matches pypdf revision %i password and file-key vectors", revision => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(array => {
      if (!array) throw new Error("Expected a random buffer");
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i;
      return array;
    });
    const parsed = parseCosDocument(encryptCosDocument(inputDocument(), { ...passwords, revision }), { password: passwords.userPassword });
    const dict = parsed.resolveDict(parsed.encryptRef)!;
    const expected = revision === 6 ? R6_VALUES : R3_VALUES;
    for (const [key, hex] of Object.entries(expected)) {
      const actual = key === "key" ? parsed.encryption!.fileKey : dictionaryBytes(dict, key);
      expect(Buffer.from(actual).toString("hex"), key).toBe(hex);
    }
  });

  it("normalizes R6 Unicode passwords before encrypting", () => {
    const bytes = encryptCosDocument(inputDocument(), { userPassword: "SªSL\u00adprep", ownerPassword: "owner" });
    for (const password of ["SaSLprep", "SªSL\u00adprep"]) {
      const parsed = parseCosDocument(bytes, { password });
      expect(parsed.getInfoString("Title")).toBe("Independent encryption check");
    }
  });
});

const R6_VALUES = {
  "U": "c29b673ea81b4861a54177f2d8f7bfa7f32d7b944520445d3719231afb41902c000102030405060708090a0b0c0d0e0f",
  "UE": "b90577b459745f2a5df84ae659049776a2033ba516203bee38a8d9f67d58886a",
  "O": "ce68741669b9717b485fdf77420dc7a5a7c2b5a069763fceaa029ae26e2aca3c000102030405060708090a0b0c0d0e0f",
  "OE": "2050d25b98ad079c80f9fb28b537ef131684d23a96052d7e1c6380420d28d7b4",
  "Perms": "99dadbfe944d41ff4e423ad8f7f32dfc"
};
const R3_VALUES = {
  "O": "414ee99f151ea8ea2d018b0784fcb3de1d7a034d4b43dd11a4f00e981c536bb2",
  "key": "2f7ea62ffdd9ea1e19fc1eb781bf0512",
  "U": "0cc6c14b624803aa43346725961a692828bf4e5e4e758a4164004e56fffa0108"
};
