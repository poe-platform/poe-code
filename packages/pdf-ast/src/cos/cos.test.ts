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

  it("recovers damaged PDFs where /Type /Catalog and /Info are packed inside a /Type /ObjStm stream", () => {
    const obj1 = "<< /Type /Catalog /Pages 2 0 R >>\n";
    const obj2 = "<< /Type /Pages /Count 0 /Kids [] >>\n";
    const obj3 = "<< /Title (Packed In ObjStm) >>";
    const headerTable = `1 0 2 ${obj1.length} 3 ${obj1.length + obj2.length} `;
    const bodyObjects = obj1 + obj2 + obj3;
    const objStmPayload = encoder.encode(headerTable + bodyObjects);
    const baseBytes = serializeCosDocument({
      objects: [
        {
          objectNumber: 10,
          generationNumber: 0,
          value: cosStream(objStmPayload, {
            dict: cosDict({
              Type: cosName("ObjStm"),
              N: cosNumber(3),
              First: cosNumber(headerTable.length),
            }),
            compress: true,
          }),
        },
      ],
      rootRef: cosRef(1),
      infoRef: cosRef(3),
    });
    const corrupted = Uint8Array.from(
      Buffer.from(
        Buffer.from(baseBytes).toString("latin1").replace("startxref", "startxref\n999999\n%corrupted"),
        "latin1"
      )
    );
    const repaired = parseCosDocument(corrupted, { recovery: "repair" });
    expect(repaired.rootRef.objectNumber).toBe(1);
    expect(repaired.getInfoString("Title")).toBe("Packed In ObjStm");
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

  it("decodes sub-byte Predictor 2 (TIFF horizontal differencing) and CCITTFaxDecode Group 3 1D / Group 4 2D streams", () => {
    // 1. 4-bit Predictor 2: 4 samples [2, 3, 1, 4] -> cumulative mod 16: [2, 5, 6, 10] -> packed bytes [0x25, 0x6a]
    const diffBytes4 = Uint8Array.from([0x23, 0x14]);
    const predDecoded = decodePdfFilter("FlateDecode", encodeFlate(diffBytes4), {
      Predictor: 2,
      Colors: 1,
      BitsPerComponent: 4,
      Columns: 4,
    });
    expect(Array.from(predDecoded)).toEqual([0x25, 0x6a]);

    // 2. CCITTFaxDecode Group 4 (K = -1, Columns = 8, Rows = 1):
    // Horizontal mode (001) + White run 4 (1011) + Black run 4 (011) + EOFB (000000000001000000000001)
    // Bitstream: 001 1011 011 000000000001000000000001 -> 00110110 11000000 00000100 00000001
    const g4Bits = Uint8Array.from([0b00110110, 0b11000000, 0b00000100, 0b00000001]);
    // With BlackIs1 = false (default PDF DeviceGray): 4 white (1111) + 4 black (0000) = 0xf0
    const g4White1 = decodePdfFilter("CCITTFaxDecode", g4Bits, {
      K: -1,
      Columns: 8,
      Rows: 1,
      BlackIs1: false,
    });
    expect(Array.from(g4White1)).toEqual([0xf0]);

    // With BlackIs1 = true: 4 white (0000) + 4 black (1111) = 0x0f
    const g4Black1 = decodePdfFilter("CCITTFaxDecode", g4Bits, {
      K: -1,
      Columns: 8,
      Rows: 1,
      BlackIs1: true,
    });
    expect(Array.from(g4Black1)).toEqual([0x0f]);
  });
});
