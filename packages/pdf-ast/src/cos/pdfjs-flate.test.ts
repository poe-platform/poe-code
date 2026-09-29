import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflate, deflateRaw, gzip } from "pako";
import { describe, expect, it, vi } from "vitest";
import { PdfError } from "../errors.js";
import { decodeFlate, encodeFlate } from "./filters.js";

// PDF.js stream_spec.js predictor case and extracted upstream regression streams.
// See fixtures/SOURCES.md and THIRD_PARTY_NOTICES.md for provenance.
describe("PDF.js FlateDecode compatibility", () => {
  it("decodes the upstream simple predictor example", () => {
    const bytes = encodeFlate(new Uint8Array([2, 100, 3, 2, 1, 255, 2, 1, 255]));
    expect(decodeFlate(bytes, { Predictor: 12, Colors: 1, BitsPerComponent: 8, Columns: 2 }))
      .toEqual(new Uint8Array([100, 3, 101, 2, 102, 1]));
  });

  it.each([
  {
    "file": "pdfjs-flate-issue11651.pdf-8.bin",
    "length": 480,
    "sha256": "022cb7cc5a374c440863c180a01bf21beddbcf2b05623ad55b49e2c8cef416ec",
    "sourceSha256": "f6d5affeefe60debabb9c08b127fb6b2639a8a3b3c613097895826146e2de36c"
  },
  {
    "file": "pdfjs-flate-issue11651.pdf-10.bin",
    "length": 67318,
    "sha256": "d064d2329272c6279c34dc4cf07234dcd9ef9ae71d64bc0751f4b6cdd4e1fd85",
    "sourceSha256": "c62db31061a61e6b273989413e2b1a932f527e5d38a5e66cbee7d75e7a16da80"
  },
  {
    "file": "pdfjs-flate-issue3885.pdf-12.bin",
    "length": 424,
    "sha256": "b33fcf5018cad8500f172e07cc5d6acc5d00b67005399bd53f8c4b82bc893b9f",
    "sourceSha256": "90a50754c0c2216bf3a2b2d3e69691cdd777203b5611e35fc6a9da701da40382"
  },
  {
    "file": "pdfjs-flate-bug1050040.pdf-2.bin",
    "length": 59211,
    "sha256": "6b285ad9ee49140b4a4784b487a12def792282c68d1143975ee146bd79a20906",
    "sourceSha256": "8720aad581e3839f8edee2fe970d377a24081898114b85e1c9849f3bf78bccc0"
  }
])("recovers $file with the upstream decoded bytes", ({ file, length, sha256 }) => {
    const bytes = readFileSync(new URL(`../fixtures/${file}`, import.meta.url));
    const before = Buffer.from(bytes);
    const decoded = decodeFlate(bytes, undefined, length);
    expect(decoded.length).toBe(length);
    expect(createHash("sha256").update(decoded).digest("hex")).toBe(sha256);
    expect(bytes).toEqual(before);
    expect(() => decodeFlate(bytes, undefined, length - 1))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });

  it.each([0, 1, 9])("decodes zlib, raw and gzip at compression level %i", level => {
    const source = new TextEncoder().encode("PDF content with repeated text. ".repeat(50));
    for (const bytes of [deflate(source, { level }), deflateRaw(source, { level }), gzip(source, { level })]) {
      expect(decodeFlate(bytes, undefined, source.length)).toEqual(source);
      expect(() => decodeFlate(bytes, undefined, source.length - 1))
        .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
    }
  });

  it("accepts empty output with a zero budget", () => {
    expect(decodeFlate(encodeFlate(new Uint8Array()), undefined, 0)).toEqual(new Uint8Array());
  });

  it.each([new Uint8Array(), new Uint8Array([255, 255, 255]), new Uint8Array([120, 156, 7])])
    ("rejects undecodable bytes", bytes => {
      expect(() => decodeFlate(bytes)).toThrow(PdfError);
    });

  it.each([false, true])("stops expansion before allocating the full output (raw: %s)", raw => {
    const source = new Uint8Array(1024 * 1024);
    const compressed = raw ? deflateRaw(source) : deflate(source);
    const sizes: number[] = [];
    const OriginalUint8Array = Uint8Array;
    vi.stubGlobal("Uint8Array", new Proxy(OriginalUint8Array, {
      construct(target, args) {
        const value = Reflect.construct(target, args) as Uint8Array;
        sizes.push(value.byteLength);
        return value;
      },
    }));
    try {
      expect(() => decodeFlate(compressed, undefined, 1024))
        .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
      expect(Math.max(...sizes)).toBeLessThanOrEqual(64 * 1024);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
