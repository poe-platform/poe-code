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

test("JPEG standard aliases, resolution fields and COM round-trip", () => {
  const values = { Author: "Alice", DateTime: "2026:01:02 03:04:05", XResolution: "300", YResolution: "72.5", ResolutionUnit: "2", Comment: "Hello 世界" };
  for (const input of [original, new Uint8Array([255,216,255,217])]) {
    const edited = editJpeg(input, Object.entries(values).map(([name,value]) => ({name,value,operation:"set" as const})), options);
    const tags = inspectJpeg(edited, options).tags;
    for (const [name,value] of Object.entries(values)) assert.equal(tags.find(tag => tag.name === (({Author:"Artist",DateTime:"ModifyDate"} as Record<string,string>)[name] ?? name))?.value, value);
    const cleared = editJpeg(edited, [{name:"Comment",value:"",operation:"set"}], options);
    assert.equal(inspectJpeg(cleared, options).tags.some(tag => tag.name === "Comment"), false);
    assert.equal(inspectJpeg(cleared, options).tags.find(tag => tag.name === "Artist")?.value, "Alice");
  }
});

test("repeated JPEG edits compact superseded directories and strings and keep tags sorted", () => {
  for (const input of [original, new Uint8Array([255,216,255,217])]) {
    let edited = editJpeg(input, [{name:"Copyright",value:"Copyright owner",operation:"set"}], options);
    for (let i = 0; i < 80; i++) edited = editJpeg(edited, [{name:"Artist",value:"A".repeat(1000),operation:"set"}], options);
    assert.ok(edited.length < 1200, String(edited.length));
    edited = editJpeg(edited, [{name:"Artist",value:"Al",operation:"set"}], options);
    assert.ok(edited.length < 200, String(edited.length));
    const bytes = edited.subarray(12), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const little = bytes[0] === 73, root = view.getUint32(4, little);
    const ids = Array.from({length:view.getUint16(root,little)}, (_,i) => view.getUint16(root + 2 + i * 12,little));
    assert.deepEqual(ids, [...ids].sort((a,b) => a-b));
    assert.equal(inspectJpeg(edited, options).tags.find(tag => tag.name === "Copyright")?.value, "Copyright owner");
  }
});

test("JPEG rejects invalid resolution numbers and oversized comments", () => {
  for (const [name, values] of Object.entries({XResolution:["-1","NaN","Infinity","0","1/0","4294967296"],ResolutionUnit:["0","4","1.5"]})) {
    for (const value of values) assert.throws(() => editJpeg(original, [{name,value,operation:"set"}], options), /Resolution/);
  }
  assert.throws(() => editJpeg(original, [{name:"Comment",value:"a".repeat(65534),operation:"set"}], options), /Comment segment too large/);
});

test("COM-only edits preserve EXIF bytes and replace all old comments", () => {
  const input = new Uint8Array([...original.subarray(0,2),255,254,0,5,111,108,100,...original.subarray(2)]);
  const edited = editJpeg(input, [{name:"Comment",value:"new",operation:"set"}], options);
  assert.deepEqual(edited, new Uint8Array([...original.subarray(0,2),255,254,0,5,110,101,119,...original.subarray(2)]));
});

test("compaction preserves MakerNote and thumbnail offsets while replacing both directories", () => {
  for (const little of [true,false]) {
    const bytes = new Uint8Array(140), view = new DataView(bytes.buffer);
    bytes.set(little ? [73,73,42,0] : [77,77,0,42]); view.setUint32(4,8,little);
    const directory = (offset:number, entries: number[][], next=0) => {
      view.setUint16(offset,entries.length,little);
      entries.forEach(([tag,type,count,value],i) => {
        const p = offset + 2 + i * 12;
        view.setUint16(p,tag!,little); view.setUint16(p+2,type!,little); view.setUint32(p+4,count!,little); view.setUint32(p+8,value!,little);
      });
      view.setUint32(offset+2+entries.length*12,next,little);
    };
    directory(8,[[0x8769,4,1,26]],56);
    directory(26,[[0x927c,7,8,100],[0x9003,2,20,120]]);
    directory(56,[[0x0201,4,1,108],[0x0202,4,1,8]]);
    bytes.set([1,2,3,4,5,6,7,8],100); bytes.set([255,216,9,8,7,6,255,217],108);
    bytes.set(new TextEncoder().encode("2020:01:02 03:04:05\0"),120);
    let jpeg: Uint8Array = new Uint8Array([255,216,255,225,0,148,69,120,105,102,0,0,...bytes,255,217]);
    for (let i=0;i<80;i++) jpeg = editJpeg(jpeg,[{name:"Artist",value:"A".repeat(500),operation:"set"},{name:"UserComment",value:"note".repeat(100),operation:"set"}],options);
    assert.ok(jpeg.length<1300,String(jpeg.length));
    assert.deepEqual(jpeg.subarray(12+100,12+116),bytes.subarray(100,116));
    assert.equal(inspectJpeg(jpeg,options).tags.find(tag=>tag.name==="DateTimeOriginal")?.value,"2020:01:02 03:04:05");
  }
});
