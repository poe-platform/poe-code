import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflate, gzip } from "pako";
import { expect, it } from "vitest";
import { PdfDocument } from "../document.js";
import { decodeFlate } from "./filters.js";

// Adapted from pypdf 6.19.0 tests/test_filters.py::test_decompress (BSD-3-Clause).
// Truncation expectations were checked with pypdf.filters.decompress.
const printable = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ \t\n\r\v\f";
const source = new TextEncoder().encode(printable + [...printable].reverse().join(""));

it.each([200, 200, 200, 200, 200, 199, 198, 197, 196, 195, 194, 192].map((length, index) => ({ cut: index + 1, length })))
  ("recovers pypdf's printable bytes with $cut trailing bytes missing", ({ cut, length }) => {
    const compressed = deflate(source).slice(0, -cut);
    expect(decodeFlate(compressed, undefined, source.length)).toEqual(source.slice(0, length));
    expect(() => decodeFlate(compressed, undefined, length - 1))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });

it("recovers the original PDF.js issue11549 Unicode map and searchable text", () => {
  const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue11549_reduced.pdf", import.meta.url))));
  const stream = doc.cos.getObject(37);
  expect(stream?.kind).toBe("stream");
  if (stream?.kind !== "stream") throw new Error("Missing original ToUnicode stream");
  const decoded = decodeFlate(stream.rawBytes, undefined, 1430);
  expect(decoded).toHaveLength(1430);
  expect(createHash("sha256").update(decoded).digest("hex"))
    .toBe("46c61ed88070f84a9b1a47de394c8b67dac264969d585670438fafe50d93118d");
  expect(doc.extractText().trim()).toBe("Flags and paving");
  expect(PdfDocument.load(doc.save()).extractText().trim()).toBe("Flags and paving");
  expect(() => decodeFlate(stream.rawBytes, undefined, 1429))
    .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
});

it.each([65535, 65536, 65537, 200000])("retains all recovered gzip chunks with a %i-byte budget", length => {
  const bytes = Uint8Array.from({ length }, (_, index) => index % 251);
  const compressed = gzip(bytes).slice(0, -5);
  expect(decodeFlate(compressed, undefined, length)).toEqual(bytes);
  expect(() => decodeFlate(compressed, undefined, length - 1))
    .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
});
