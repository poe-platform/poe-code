import assert from "node:assert/strict";
import { test } from "node:test";
import { classify } from "./classify.js";

test("SVG recognition preserves text encoding and XML precedence", () => {
  for (const text of ['<svg/>', '<?xml version="1.0"?>\n<svg>雪</svg>']) {
    const result = classify(Buffer.from(text), true);
    assert.equal(result.mime, "image/svg+xml");
    assert.equal(result.encoding, text.includes("雪") ? "utf-8" : "us-ascii");
  }
  for (const text of ["<svgish/>", "<svg", "text <svg/>", "<!-- <svg/> -->"]) {
    assert.equal(classify(Buffer.from(text), true).mime, "text/plain");
  }
  assert.equal(classify(Buffer.from('<?xml version="1.0"?><root/>'), true).mime, "text/xml");
  assert.equal(classify(Buffer.from("<svg/>\0"), true).mime, "application/octet-stream");
});

test("short ELF headers retain type, word size and byte order", () => {
  for (const wordSize of [1, 2]) {
    for (const byteOrder of [1, 2]) {
      for (const [type, mime] of [[1, "application/x-object"], [2, "application/x-executable"], [3, "application/x-sharedlib"]] as const) {
        const bytes = Buffer.alloc(18);
        bytes.set([127, 69, 76, 70, wordSize, byteOrder, 1]);
        if (byteOrder === 1) bytes.writeUInt16LE(type, 16);
        else bytes.writeUInt16BE(type, 16);
        assert.equal(classify(bytes, true).mime, mime);
        assert.equal(classify(bytes.subarray(0, 17), true).mime, "application/octet-stream");
      }
    }
  }
});

test("RAR versions share the registered MIME type and require complete signatures", () => {
  for (const hex of ["526172211a0700", "526172211a070100"]) {
    const bytes = Buffer.from(hex, "hex");
    assert.equal(classify(bytes, true).mime, "application/vnd.rar");
    assert.notEqual(classify(bytes.subarray(0, -1), true).mime, "application/vnd.rar");
  }
});

test("RIFF subtypes and ISO media brands do not become WAV or MP4 indiscriminately", () => {
  for (const subtype of ["AVI ", "WEBX"]) {
    const bytes = Buffer.from("RIFF\x24\0\0\0" + subtype + "fmt ");
    assert.equal(classify(bytes, true).mime, "application/octet-stream");
  }
  for (const brand of ["avif", "heic", "M4A ", "qt  ", "xxxx"]) {
    const bytes = Buffer.from("\0\0\0\x18ftyp" + brand + "\0\0\0\0mp42isom");
    assert.equal(classify(bytes, true).mime, "application/octet-stream");
  }
});
