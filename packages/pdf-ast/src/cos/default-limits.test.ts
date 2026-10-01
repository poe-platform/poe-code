import { expect, it } from "vitest";
import { CosByteLexer } from "./lexer.js";
import { ParsedCosDocument, parseCosDocument } from "./parser.js";
import { cosRef, cosNumber, cosDict, cosName } from "../ast.js";
import { serializeCosDocument } from "./writer.js";
import { decodePdfFilter, encodeFlate } from "./filters.js";

it("defaults lexer and document resource limits to Infinity and preserves explicit limits", () => {
  const bytes = new TextEncoder().encode("(hello)");
  expect(new CosByteLexer(bytes).maxTokenBytes).toBe(Infinity);
  expect(new CosByteLexer(bytes, 0, bytes.length, 3).maxTokenBytes).toBe(3);
  const params = { version: "1.7", bytes, objects: new Map(), revisions: [], rootRef: cosRef(1) };
  // Verify constructor defaults without allocating hundreds of megabytes.
  expect(new ParsedCosDocument(params)).toMatchObject({ maxDecompressedBytes: Infinity, maxRecursionDepth: Infinity });
  expect(new ParsedCosDocument({ ...params, maxDecompressedBytes: 10, maxRecursionDepth: 5 })).toMatchObject({ maxDecompressedBytes: 10, maxRecursionDepth: 5 });
});

it("resolves references beyond the former default and enforces requested limits", () => {
  const objects = new Map(Array.from({ length: 71 }, (_, index) => [index + 1, { objectNumber: index + 1, generationNumber: 0, value: index === 70 ? cosNumber(42) : cosRef(index + 2) }]));
  const params = { version: "1.7", bytes: new Uint8Array(), objects, revisions: [], rootRef: cosRef(1) };
  expect(new ParsedCosDocument(params).resolve(cosRef(1))).toEqual(cosNumber(42));
  expect(() => new ParsedCosDocument({ ...params, maxRecursionDepth: 5 }).resolve(cosRef(1))).toThrow(/recursion limit/);
  const bytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n42\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
  expect(parseCosDocument(bytes, { recovery: "repair" }).objects.size).toBe(2);
  expect(() => parseCosDocument(bytes, { recovery: "repair", maxObjects: 1 })).toThrow();
  expect(() => decodePdfFilter("FlateDecode", encodeFlate(new Uint8Array(3)), undefined, 2)).toThrow();
});

it("enforces object and decompression budgets for classic and repaired object streams", () => {
  const objects = [
    { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog") }) },
    { objectNumber: 2, generationNumber: 0, value: cosNumber(42) },
  ];
  const classic = serializeCosDocument({ objects, rootRef: cosRef(1) });
  expect(() => parseCosDocument(classic, { maxObjects: 1 })).toThrow(/object count limit/);
  const packed = serializeCosDocument({ objects, rootRef: cosRef(1), objectStreams: "generate" });
  expect(() => parseCosDocument(packed, { maxObjects: 3 })).toThrow(/object count limit/);
  const marker = new TextEncoder().encode("startxref");
  const damaged = packed.subarray(0, packed.findIndex((_, index) => marker.every((byte, offset) => packed[index + offset] === byte)));
  expect(parseCosDocument(damaged, { recovery: "repair" }).resolve(cosRef(1))).toBeDefined();
  expect(() => parseCosDocument(damaged, { recovery: "repair", maxDecompressedBytes: 1 })).toThrow(/decoded byte budget/);
  expect(() => serializeCosDocument({ objects, rootRef: cosRef(1), maxObjects: 1 })).toThrow();
  expect(() => serializeCosDocument({ objects, rootRef: cosRef(1), maxOutputBytes: 1 })).toThrow();
});
it.each([undefined, Infinity])("reads literal strings beyond the former token ceiling with limit %s", limit => {
  const size = 16_000_001;
  const bytes = new Uint8Array(size + 2).fill(0x61);
  bytes[0] = 0x28;
  bytes[bytes.length - 1] = 0x29;
  const token = new CosByteLexer(bytes, 0, bytes.length, limit).nextToken();
  expect(token?.kind).toBe("string");
  if (token?.kind !== "string") throw new Error("Expected literal string");
  expect(token.bytes.length).toBe(size);
  expect(token.bytes[0]).toBe(0x61);
  expect(token.bytes[size - 1]).toBe(0x61);
  expect(() => new CosByteLexer(bytes, 0, bytes.length, 3).nextToken()).toThrow(/maximum byte length/);
});
