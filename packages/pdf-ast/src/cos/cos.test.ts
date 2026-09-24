import { describe, expect, it } from "vitest";
import {
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosRef,
  cosStream,
  cosString,
} from "../ast.js";
import { tokenizeCos } from "./lexer.js";
import {
  decodePdfFilter,
  decodePdfFilterPipeline,
  encodeAscii85,
  encodeAsciiHex,
  encodeFlate,
  encodeLzw,
  encodeRunLength,
} from "./filters.js";
import { parseCosDocument } from "./parser.js";
import { serializeCosDocument, appendIncrementalRevision } from "./writer.js";
import { encryptCosDocument } from "./security.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("Layer 1 COS Lexer & Object Syntax", () => {
  it("tokenizes booleans, null, numbers, hex-escaped names, balanced literal strings, and hex strings with byte spans", () => {
    const input = encoder.encode(
      `true false null -42 3.1415 /Name#20With#2fSlash (Hello \\(world\\)\\n\\101\\\r\nB) <48656c6c6> % comment\n<< /Key 12 0 R >>`
    );
    const tokens = tokenizeCos(input);
    expect(tokens.map(t => t.kind)).toEqual([
      "boolean",
      "boolean",
      "null",
      "number",
      "number",
      "name",
      "string",
      "hex-string",
      "dict-start",
      "name",
      "number",
      "number",
      "keyword",
      "dict-end",
    ]);
    const nameTok = tokens[5]!;
    expect(nameTok.kind === "name" && nameTok.decoded).toBe("Name With/Slash");
    const litTok = tokens[6]!;
    expect(litTok.kind === "string" && decoder.decode(litTok.bytes)).toBe("Hello (world)\nAB");
    const hexTok = tokens[7]!;
    expect(hexTok.kind === "hex-string" && [...hexTok.bytes]).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x60]);
  });
});

describe("Layer 1 PDF Stream Filter Pipeline", () => {
  it("round-trips FlateDecode, PNG predictors (10-15), and TIFF predictor 2", () => {
    const payload = encoder.encode("The quick brown fox jumps over the lazy dog 1234567890!");
    const compressed = encodeFlate(payload);
    const decoded = decodePdfFilter("FlateDecode", compressed);
    expect(decoder.decode(decoded)).toBe(decoder.decode(payload));

    const pngPredicted = encodeFlate(Uint8Array.from([2, 10, 20, 30, 40, 2, 1, 2, 3, 4]));
    const unpredicted = decodePdfFilter("FlateDecode", pngPredicted, {
      Predictor: 12,
      Columns: 4,
      Colors: 1,
      BitsPerComponent: 8,
    });
    expect([...unpredicted]).toEqual([10, 20, 30, 40, 11, 22, 33, 44]);

    const tiffPredicted = encodeFlate(Uint8Array.from([10, 10, 10, 10, 5, 5, 5, 5]));
    const tiffDecoded = decodePdfFilter("FlateDecode", tiffPredicted, {
      Predictor: 2,
      Columns: 4,
      Colors: 1,
      BitsPerComponent: 8,
    });
    expect([...tiffDecoded]).toEqual([10, 20, 30, 40, 5, 10, 15, 20]);
  });

  it("round-trips LZWDecode, ASCII85Decode, ASCIIHexDecode, RunLengthDecode, and chained pipelines", () => {
    const sample = encoder.encode("ABABABABABAB-PDF-FOUNDATIONS-LZW-ASCII85-HEX-RLE!");
    expect(decoder.decode(decodePdfFilter("LZWDecode", encodeLzw(sample)))).toBe(decoder.decode(sample));
    expect(decoder.decode(decodePdfFilter("ASCII85Decode", encodeAscii85(sample)))).toBe(decoder.decode(sample));
    expect(decoder.decode(decodePdfFilter("ASCIIHexDecode", encodeAsciiHex(sample)))).toBe(decoder.decode(sample));
    expect(decoder.decode(decodePdfFilter("RunLengthDecode", encodeRunLength(sample)))).toBe(decoder.decode(sample));

    const chained = encodeAscii85(encodeFlate(sample));
    const out = decodePdfFilterPipeline(["ASCII85Decode", "FlateDecode"], chained);
    expect(decoder.decode(out)).toBe(decoder.decode(sample));
  });
});

describe("Layer 1 COS Document Parse, XRef Streams, Incremental Revisions & QDF Serialization", () => {
  it("serializes a COS document, parses classic xref and streams, and applies incremental revisions", () => {
    const catalog = cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) });
    const pages = cosDict({ Type: cosName("Pages"), Count: cosNumber(1), Kids: cosArray([cosRef(3)]) });
    const contentStream = cosStream(encoder.encode("BT /F1 12 Tf 72 720 Td (Hello v1) Tj ET"), { compress: true });
    const page = cosDict({
      Type: cosName("Page"),
      Parent: cosRef(2),
      MediaBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(612), cosNumber(792)]),
      Contents: cosRef(4),
    });
    const info = cosDict({ Title: cosString("Original Title") });

    const baseBytes = serializeCosDocument({
      objects: [
        { objectNumber: 1, generationNumber: 0, value: catalog },
        { objectNumber: 2, generationNumber: 0, value: pages },
        { objectNumber: 3, generationNumber: 0, value: page },
        { objectNumber: 4, generationNumber: 0, value: contentStream },
        { objectNumber: 5, generationNumber: 0, value: info },
      ],
      rootRef: cosRef(1),
      infoRef: cosRef(5),
    });

    const parsedV1 = parseCosDocument(baseBytes);
    expect(parsedV1.getInfoString("Title")).toBe("Original Title");
    expect(decoder.decode(parsedV1.getDecodedStream(4)!)).toBe("BT /F1 12 Tf 72 720 Td (Hello v1) Tj ET");

    const updatedBytes = appendIncrementalRevision(baseBytes, parsedV1, [
      { objectNumber: 5, generationNumber: 0, value: cosDict({ Title: cosString("Updated Title v2") }) },
    ]);

    const parsedV2 = parseCosDocument(updatedBytes);
    expect(parsedV2.getInfoString("Title")).toBe("Updated Title v2");
    expect(parsedV2.revisions.length).toBe(2);
  });

  it("recovers damaged startxref offsets when recovery='repair' is enabled", () => {
    const baseBytes = serializeCosDocument({
      objects: [
        { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
        { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }) },
      ],
      rootRef: cosRef(1),
    });
    const corrupted = encoder.encode(decoder.decode(baseBytes).replace(/startxref\n\d+/, "startxref\n999999"));
    expect(() => parseCosDocument(corrupted, { recovery: "strict" })).toThrow();
    const repaired = parseCosDocument(corrupted, { recovery: "repair" });
    expect(repaired.rootRef.objectNumber).toBe(1);
  });

  it("encrypts and decrypts standard security handler documents (AES-128 & AES-256 R6)", () => {
    const rawBytes = serializeCosDocument({
      objects: [
        { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
        { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }) },
        { objectNumber: 3, generationNumber: 0, value: cosDict({ Title: cosString("Top Secret Report") }) },
        { objectNumber: 4, generationNumber: 0, value: cosStream(encoder.encode("Confidential stream payload")) },
      ],
      rootRef: cosRef(1),
      infoRef: cosRef(3),
    });
    const doc = parseCosDocument(rawBytes);
    const encryptedBytes = encryptCosDocument(doc, {
      userPassword: "user-pass",
      ownerPassword: "owner-pass",
      revision: 6,
      permissions: { print: true, copy: false, modify: false, addNotes: true },
    });
    expect(decoder.decode(encryptedBytes)).not.toContain("Top Secret Report");
    expect(decoder.decode(encryptedBytes)).not.toContain("Confidential stream payload");

    expect(() => parseCosDocument(encryptedBytes, { password: "wrong" })).toThrow();

    const decrypted = parseCosDocument(encryptedBytes, { password: "user-pass" });
    expect(decrypted.getInfoString("Title")).toBe("Top Secret Report");
    expect(decoder.decode(decrypted.getDecodedStream(4)!)).toBe("Confidential stream payload");
    expect(decrypted.encryption?.permissions.print).toBe(true);
    expect(decrypted.encryption?.permissions.copy).toBe(false);
  });
});
