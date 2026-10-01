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

test("JPEG accepts SOS followed by EOI with trailing MPF/padding bytes and extracts Orientation and ImageSize", () => {
  const withSosAndTrailing = new Uint8Array([
    ...original.subarray(0, original.length - 2),
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x7f, 0xff, 0xd9,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xd8, 0xff, 0xd9
  ]);
  const info = inspectJpeg(withSosAndTrailing, options);
  assert.equal(info.tags.find(tag => tag.name === "Orientation")?.value, "6");
  assert.equal(info.tags.find(tag => tag.name === "ImageSize")?.value, "64x32");
});

const standardTags = { ImageDescription: "1984", Make: "Camera", Model: "Model X", Software: "Editor", ModifyDate: "2026:09:26 12:00:00", Orientation: "3", UserComment: "Hello 世界", DateTimeOriginal: "2020:01:02 03:04:05", CreateDate: "2021:02:03 04:05:06" };
test("JPEG writes, replaces and deletes IFD0 and ExifIFD tags in either byte order", () => {
  for (const input of [original, new Uint8Array([255,216,255,217])]) {
    let edited = editJpeg(input, Object.entries(standardTags).map(([name,value]) => ({name,value,operation:"set" as const})), options);
    const tags = inspectJpeg(edited, options).tags;
    for (const [name,value] of Object.entries(standardTags)) assert.equal(tags.find(tag => tag.name === name)?.value, value, name);
    assert.equal(tags.find(tag => tag.name === "UserComment")?.group, "ExifIFD");
    edited = editJpeg(edited, [{name:"UserComment",value:"new",operation:"set"}], options);
    assert.equal(inspectJpeg(edited, options).tags.find(tag => tag.name === "DateTimeOriginal")?.value, standardTags.DateTimeOriginal);
    assert.equal(inspectJpeg(edited, options).tags.find(tag => tag.name === "UserComment")?.value, "new");
    edited = editJpeg(edited, Object.keys(standardTags).map(name => ({name,value:"",operation:"set" as const})), options);
    assert.equal(inspectJpeg(edited, options).tags.filter(tag => Object.hasOwn(standardTags,tag.name)).length, 0);
  }
});
test("JPEG rejects invalid orientation values", () => {
  for (const value of ["0", "9", "abc", "1.5"]) assert.throws(() => editJpeg(original, [{name:"Orientation",value,operation:"set"}], options), /Orientation/);
});

test("JPEG stores Orientation as SHORT and comment/date fields in the pointed ExifIFD", () => {
  const edited = editJpeg(original, Object.entries(standardTags).map(([name,value]) => ({name,value,operation:"set" as const})), options);
  const bytes = edited.subarray(12);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const root = view.getUint32(4);
  const fields = (offset: number) => Array.from({length:view.getUint16(offset)}, (_,i) => offset + 2 + i * 12);
  const entries = fields(root);
  const orientation = entries.find(offset => view.getUint16(offset) === 0x0112)!;
  assert.equal(view.getUint16(orientation + 2), 3);
  assert.equal(view.getUint32(orientation + 4), 1);
  assert.equal(view.getUint16(orientation + 8), 3);
  const pointer = entries.find(offset => view.getUint16(offset) === 0x8769)!;
  assert.equal(view.getUint16(pointer + 2), 4);
  const sub = fields(view.getUint32(pointer + 8));
  const comment = sub.find(offset => view.getUint16(offset) === 0x9286)!;
  assert.equal(view.getUint16(comment + 2), 7);
  const start = view.getUint32(comment + 8);
  assert.equal(new TextDecoder().decode(bytes.subarray(start, start + 8)), "UNICODE\0");
  assert.equal(new TextDecoder("utf-16be").decode(bytes.subarray(start + 8, start + view.getUint32(comment + 4))), standardTags.UserComment);
  for (const tag of [0x9003,0x9004]) {
    const entry = sub.find(offset => view.getUint16(offset) === tag)!;
    assert.equal(view.getUint16(entry + 2), 2);
    assert.equal(view.getUint32(entry + 4), 20);
  }
  assert.deepEqual(edited.subarray(edited.length - 15), original.subarray(original.length - 15));
});
