// Authentication cases ported from PDF.js test/unit/crypto_spec.js (Apache-2.0).
// See THIRD_PARTY_NOTICES.md and fixtures/SOURCES.md for the pinned source.
import { createCipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosHexString, cosName, cosNumber, cosRef, cosStream, cosString, dictGet, type PdfCosNode } from "../ast.js";
import { encodeAsciiHex, encodeFlate } from "./filters.js";
import { PdfDocument } from "../document.js";
import { serializeCosDocument } from "./writer.js";
import { ParsedCosDocument, parseCosDocument } from "./parser.js";
import { derivePdfEncryptionKey, decryptCosDocument, encryptPdfBuffer } from "./security.js";

type Vector = Record<string, string | number | { name: string }>;
const vectors = JSON.parse(readFileSync(new URL("../fixtures/pdfjs-security-vectors.json", import.meta.url), "utf8")) as {
  fileId1: string; fileId2: string; dictionaries: Record<string, Vector>;
};
function dictionary(name: string) {
  return cosDict(Object.fromEntries(Object.entries(vectors.dictionaries[name]!).map(([key, value]): [string, PdfCosNode] => [key,
    typeof value === "number" ? cosNumber(value) : typeof value === "string" ? cosHexString(new Uint8Array(Buffer.from(value, "hex"))) : cosName(value.name),
  ])));
}

const authenticationCases: Array<[string, string, boolean]> = [
  ["aes256Dict", "user", true], ["aes256Dict", "owner", true],
  ["aes256Dict", "", false], ["aes256Dict", "wrong", false], ["aes256BlankDict", "", true],
  ["aes256UnicodeDict", "pässwört", true], ["aes256UnicodeDict", "Öwner", true],
  ["aes256UnicodeDict", "pÃ¤sswÃ¶rt", false], ["aes256UnicodeDict", "wrong", false],
  ["aes256IsoDict", "user", true], ["aes256IsoDict", "owner", true],
  ["aes256IsoDict", "", false], ["aes256IsoDict", "wrong", false], ["aes256IsoBlankDict", "", true],
  ["aes256SaslPrepDict", "SªSL\u00adprep", true], ["aes256SaslPrepDict", "SaSLprep", true],
  ["aes256SaslPrepDict", "wrong", false], ["aes256SaslPrepFallbackDict", "pass\u00adword", true],
  ["dict1", "123456", true], ["dict1", "654321", true],
  ["dict1", "", false], ["dict1", "wrong", false], ["dict2", "", true],
];

describe("PDF.js standard security authentication", () => {
  it.each([undefined, Infinity])("does not impose an encryption dictionary depth ceiling with %s", maxRecursionDepth => {
    let nested = cosDict({});
    for (let i = 0; i < 160; i++) nested = cosDict({ Nested: nested });
    const entries = Object.fromEntries(dictionary("aes256IsoDict").entries.map(entry => [entry.key.decoded, entry.value]));
    expect(derivePdfEncryptionKey(cosDict({ ...entries, Extra: nested }), Buffer.from(vectors.fileId1, "hex"), "user", { maxRecursionDepth }).fileKey.length)
      .toBe(32);
  });

  it("enforces the configured encryption dictionary recursion limit", () => {
    let nested = cosDict({});
    for (let i = 0; i < 12; i++) nested = cosDict({ Nested: nested });
    const entries = Object.fromEntries(dictionary("aes256IsoDict").entries.map(entry => [entry.key.decoded, entry.value]));
    expect(() => derivePdfEncryptionKey(cosDict({ ...entries, Extra: nested }), Buffer.from(vectors.fileId1, "hex"), "user", { maxRecursionDepth: 8 }))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });

  it.each(authenticationCases)("%s password %j is accepted=%s", (name, password, accepted) => {
    const id = Buffer.from(name === "dict2" ? vectors.fileId2 : vectors.fileId1, "hex");
    const authenticate = () => derivePdfEncryptionKey(dictionary(name), id, password);
    if (accepted) {
      const state = authenticate();
      expect(state.fileKey.length).toBe(name.startsWith("dict") ? 16 : 32);
    } else expect(authenticate).toThrow();
  });
});

describe("PDF.js encrypted document regressions", () => {
  it.each(["SªSL\u00adprep", "SaSLprep"])("opens pypdf's R5 SASLprep password %j", password => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pypdf-r5-saslprep.pdf", import.meta.url))), { password });
    expect(doc.extractText()).toContain("Independent reader check");
  });

  it.each([
    ["issue6010_1", "abc", "Issue 6010"],
    ["issue6010_2", "æøå", "Issue 6010"],
    ["saslprep-r6", "SªSL\u00adprep", "Hello pdf.js world"],
  ])("extracts %s with its upstream password", (name, password, text) => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL(`../fixtures/pdfjs-${name}.pdf`, import.meta.url))), { password });
    expect(doc.getPage(0).extractText()).toContain(text);
  });

  it.each(["empty_protected", "issue19484_1", "issue19484_2"])("opens and evaluates %s", name => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL(`../fixtures/pdfjs-${name}.pdf`, import.meta.url))));
    expect(doc.pageCount).toBeGreaterThan(0);
    expect(doc.getPage(0).evaluateDisplayList()).toBeDefined();
  });
});

// Signature and metadata streams are plaintext exclusions in PDF 7.6.2.
// These isolated COS objects reproduce eager-decryption failures without writing files.
describe("plaintext encryption exclusions", () => {
  it("retains signature Contents while decrypting other signature strings", () => {
    const state = { filter: "Standard", version: 5, revision: 6, keyLengthBits: 256, encryptMetadata: true,
      fileKey: new Uint8Array(32), permissions: { print: true, modify: true, copy: true, addNotes: true, fillForms: true, extractAccessibility: true, assemble: true, printHighRes: true } };
    const contents = new Uint8Array(32).fill(42);
    const signature = cosDict({ FT: cosName("Sig"), Filter: cosName("Adobe.PPKMS"),
      ByteRange: cosArray([cosNumber(0), cosNumber(100), cosNumber(164), cosNumber(50)]),
      Contents: cosHexString(contents), Name: cosHexString(encryptPdfBuffer(state, 1, 0, new TextEncoder().encode("Signer"))),
    });
    const doc = new ParsedCosDocument({ version: "2.0", bytes: new Uint8Array(), rootRef: cosRef(1), revisions: [],
      objects: new Map([[1, { objectNumber: 1, generationNumber: 0, value: signature }]]) });
    decryptCosDocument(doc, state);
    const result = doc.resolveDict(cosRef(1))!;
    expect(result.entries.find(entry => entry.key.decoded === "Contents")!.value).toMatchObject({ bytes: contents });
    expect(result.entries.find(entry => entry.key.decoded === "Name")!.value).toMatchObject({ bytes: cosString("Signer").bytes });
  });

  it.each(["XRef", "Metadata"])("preserves plaintext %s streams", type => {
    const value = cosStream(new Uint8Array(32).fill(42), { dict: cosDict({ Type: cosName(type) }) });
    const state = { filter: "Standard", version: 5, revision: 6, keyLengthBits: 256, encryptMetadata: false,
      fileKey: new Uint8Array(32), permissions: { print: true, modify: true, copy: true, addNotes: true, fillForms: true, extractAccessibility: true, assemble: true, printHighRes: true } };
    const doc = new ParsedCosDocument({ version: "2.0", bytes: new Uint8Array(), rootRef: cosRef(1), revisions: [],
      objects: new Map([[1, { objectNumber: 1, generationNumber: 0, value }]]) });
    decryptCosDocument(doc, state);
    expect(doc.getObject(1)).toEqual(value);
  });
});

function encryptedBytes(plain: Uint8Array, key: Uint8Array): Uint8Array {
  const iv = new Uint8Array(16).fill(7);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return new Uint8Array(Buffer.concat([iv, cipher.update(plain), cipher.final()]));
}

function cryptFilterDocument(overrides: Record<string, PdfCosNode> = {}) {
  const entries = Object.fromEntries(dictionary("aes256IsoDict").entries.map(entry => [entry.key.decoded, entry.value]));
  const encryption = cosDict({ ...entries,
    CF: cosDict({ StdCF: cosDict({ CFM: cosName("AESV3"), Length: cosNumber(32) }) }),
    StrF: cosName("StdCF"), StmF: cosName("StdCF"), ...overrides,
  });
  const state = derivePdfEncryptionKey(encryption, Buffer.from(vectors.fileId1, "hex"), "user");
  const doc = new ParsedCosDocument({ version: "2.0", bytes: new Uint8Array(), rootRef: cosRef(1), revisions: [], objects: new Map(), encryption: state });
  return { doc, state };
}

describe("PDF.js crypt-filter selection", () => {
  it("uses separate string and stream filters", () => {
    const { doc, state } = cryptFilterDocument({ StrF: cosName("Identity") });
    const plain = new TextEncoder().encode("stream uses AES; string uses Identity");
    doc.setObject(1, cosString("Visible title"));
    doc.setObject(2, cosStream(encryptedBytes(plain, state.fileKey)));
    decryptCosDocument(doc, state);
    expect(doc.getObject(1)).toMatchObject({ bytes: cosString("Visible title").bytes });
    expect(doc.getDecodedStream(2)).toEqual(plain);
    expect(encryptPdfBuffer(state, 3, 0, plain)).toEqual(plain);
  });

  it.each([undefined, "Identity", "StdCF"])("honors explicit Crypt filter %s without applying StmF first", cryptName => {
    const encrypted = cryptName === "StdCF";
    const { doc, state } = cryptFilterDocument({ StmF: cosName(encrypted ? "Identity" : "StdCF") });
    const plain = new TextEncoder().encode("explicit Crypt stream");
    const compressed = encodeFlate(plain);
    const params = cosDict(cryptName ? { Name: cosName(cryptName) } : {});
    doc.setObject(1, cosStream(encrypted ? encryptedBytes(compressed, state.fileKey) : compressed, { dict: cosDict({
      Filter: cosArray([cosName("Crypt"), cosName("FlateDecode")]),
      DecodeParms: cosArray([params, cosDict({})]),
    }) }));
    decryptCosDocument(doc, state);
    expect(doc.getDecodedStream(1)).toEqual(plain);
  });

  it("decrypts Crypt at its declared position and keeps the remaining filters serializable", () => {
    const { doc, state } = cryptFilterDocument({ StmF: cosName("Identity") });
    const plain = new TextEncoder().encode("ASCIIHex then Crypt then Flate");
    const raw = encodeAsciiHex(encryptedBytes(encodeFlate(plain), state.fileKey));
    doc.setObject(1, cosStream(raw, { dict: cosDict({
      Filter: cosArray([cosName("ASCIIHexDecode"), cosName("Crypt"), cosName("FlateDecode")]),
      DecodeParms: cosArray([cosDict({}), cosDict({ Name: cosName("StdCF") }), cosDict({})]),
    }) }));
    decryptCosDocument(doc, state);
    expect(doc.getDecodedStream(1)).toEqual(plain);
    const stream = doc.getObject(1)!;
    expect(stream.kind).toBe("stream");
    if (stream.kind !== "stream") throw new Error("Expected stream");
    expect(dictGet(stream.dict, "Filter")).toEqual(cosArray([cosName("FlateDecode")]));
    const saved = serializeCosDocument({ objects: [...doc.objects.values()], rootRef: doc.rootRef });
    expect(parseCosDocument(saved).getDecodedStream(1)).toEqual(plain);
  });

  it("uses EFF for embedded-file streams with Identity as the default stream filter", () => {
    const { doc, state } = cryptFilterDocument({ StmF: cosName("Identity"), EFF: cosName("StdCF") });
    const plain = new TextEncoder().encode("encrypted attachment");
    doc.setObject(1, cosStream(encryptedBytes(plain, state.fileKey), { dict: cosDict({ Type: cosName("EmbeddedFile") }) }));
    decryptCosDocument(doc, state);
    expect(doc.getDecodedStream(1)).toEqual(plain);
  });

  it("resolves and preserves indirect encryption entries", () => {
    const entries = Object.fromEntries(dictionary("aes256IsoDict").entries.map(entry => [entry.key.decoded, entry.value]));
    const owner = entries.O!;
    const cf = cosDict({ StdCF: cosRef(9) });
    const cfEntry = cosDict({ CFM: cosName("AESV3"), Length: cosNumber(32) });
    const doc = new ParsedCosDocument({ version: "2.0", bytes: new Uint8Array(), rootRef: cosRef(1), revisions: [], objects: new Map() });
    doc.setObject(7, owner); doc.setObject(8, cf); doc.setObject(9, cfEntry);
    const dict = cosDict({ ...entries, O: cosRef(7), CF: cosRef(8), StmF: cosName("StdCF"), StrF: cosName("StdCF") });
    const state = derivePdfEncryptionKey(dict, Buffer.from(vectors.fileId1, "hex"), "user", { resolve: node => node.kind === "ref" ? doc.getObject(node.objectNumber) : node });
    decryptCosDocument(doc, state);
    expect(doc.getObject(7)).toEqual(owner); expect(doc.getObject(8)).toEqual(cf); expect(doc.getObject(9)).toEqual(cfEntry);
    expect(dictGet(dict, "O")).toEqual(cosRef(7));
  });
});
