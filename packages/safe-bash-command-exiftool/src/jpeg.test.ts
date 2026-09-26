import assert from "node:assert/strict";
import { test } from "node:test";
import { editJpeg, inspectJpeg } from "./jpeg.js";

const options = { signal: new AbortController().signal };
// Independent big-endian TIFF: inline Artist, orientation, next-directory pointer.
const original = new Uint8Array([255,216,255,225,0,46,69,120,105,102,0,0,
  77,77,0,42,0,0,0,8,0,2,
  1,18,0,3,0,0,0,1,0,6,0,0,
  1,59,0,2,0,0,0,4,66,111,98,0,0,0,0,0,
  255,192,0,11,8,0,32,0,64,1,1,17,0,255,217]);

test("big-endian EXIF edits preserve unrelated entries and accept inline and offset text", () => {
  assert.equal(inspectJpeg(original, options).tags.find(tag => tag.name === "Artist")?.value, "Bob");
  for (const value of ["Al", "Longer Artist"]) {
    const edited = editJpeg(original, [{ name: "Artist", operation: "set", value }], options);
    assert.equal(inspectJpeg(edited, options).tags.find(tag => tag.name === "Artist")?.value, value);
    assert.deepEqual(edited.subarray(22, 34), original.subarray(22, 34));
    assert.deepEqual(edited.subarray(edited.length - 15), original.subarray(original.length - 15));
  }
});

test("JPEG rejects truncated segments and EXIF pointers and honors resource bounds", () => {
  assert.throws(() => inspectJpeg(original.subarray(0, 20), options), /Truncated JPEG/);
  const malformed = new Uint8Array(original); malformed[38] = 255;
  assert.throws(() => inspectJpeg(malformed, options), /Truncated EXIF/);
  assert.throws(() => inspectJpeg(original, { ...options, maxWork: 1 }), /work budget/);
  assert.throws(() => editJpeg(original, [{ name: "Artist", operation: "set", value: "A" }], { ...options, maxOutputBytes: 1 }), /output budget/);
});
