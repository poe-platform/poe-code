import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.js";
import { inspectPng, editPng, pngChunk } from "./png.js";

const signature = new Uint8Array([137,80,78,71,13,10,26,10]);
const signal = new AbortController().signal;

test("parse and write loops observe cancellation at an interior resource checkpoint", () => {
  const bytes = fixture(...Array<string>(64).fill("value"));
  for (const write of [false, true]) {
    const controller = new AbortController(); const reason = new Error("interior cancellation");
    let checkpoints = 0;
    const observed = new Proxy(controller.signal, {
      get(target, key) {
        if (key === "throwIfAborted") return () => {
          if (++checkpoints === 20) controller.abort(reason);
          target.throwIfAborted();
        };
        return Reflect.get(target, key, target);
      },
    });
    assert.throws(() => write ? editPng(bytes, [{ name: "Title", operation: "set", value: "new" }], { signal: observed }) :
      inspectPng(bytes, { signal: observed }), error => error === reason);
    assert.equal(checkpoints, 20);
    assert.deepEqual(bytes, fixture(...Array<string>(64).fill("value")));
  }
});
function imageChunks(bytes: Uint8Array): Uint8Array[] {
  const result: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset < bytes.length;) {
    const end = offset + view.getUint32(offset) + 12;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (["IHDR", "IDAT", "IEND"].includes(type)) result.push(bytes.slice(offset, end));
    offset = end;
  }
  return result;
}

test("PNG extraction retains duplicate identity, offsets and lexical value", () => {
  const tags = inspectPng(fixture("first", "1e999"), { signal }).tags;
  assert.deepEqual(tags.map(tag => [tag.name, tag.value, tag.instance]), [["Title", "first", 0], ["Title", "1e999", 1]]);
  assert.notEqual(tags[0]!.offset, tags[1]!.offset);
  assert.equal(tags[0]!.group, "PNG");
});

test("scalar last assignment wins, updates duplicates and preserves image chunks", () => {
  const original = fixture("first", "second");
  const changed = editPng(original, [{ name: "Title", operation: "set", value: "old" }, { name: "Title", operation: "set", value: "new" }], { signal });
  assert.deepEqual(inspectPng(changed, { signal }).tags.map(tag => tag.value), ["new", "new"]);
  assert.deepEqual(changed.subarray(0,33), original.subarray(0,33));
  assert.deepEqual(imageChunks(changed), imageChunks(original));
  assert.deepEqual(original, fixture("first", "second"));
});

test("new PNG text is published before IDAT to avoid post-image metadata warnings", () => {
  const original = fixture();
  const changed = editPng(original, [{ name: "Title", operation: "set", value: "new" }], { signal });
  assert.equal(inspectPng(changed, { signal }).tags[0]!.index, 1);
  assert.deepEqual(imageChunks(changed), imageChunks(original));
});

test("UTF-8 writes use uncompressed iTXt, including Latin-1 characters, without changing pixels", () => {
  const original = fixture("old", "older");
  for (const value of ["café", "café 水😀", "a\0b\u0001\u007f"]) {
    const changed = editPng(original, [{ name: "Title", operation: "set", value }], { signal });
    const tags = inspectPng(changed, { signal }).tags;
    assert.equal(tags.length, 2);
    assert.equal(tags[0]!.value, value);
    assert.equal(tags[0]!.chunkType, value === "a\0b\u0001\u007f" ? "tEXt" : "iTXt");
    assert.deepEqual(tags[0]!.raw, new TextEncoder().encode(value));
    assert.deepEqual(imageChunks(changed), imageChunks(original));
  }
});

test("UTF-8 writes admit encoded bytes and refuse lossy lone-surrogate conversion", () => {
  const assignments = [{ name: "Title", operation: "set" as const, value: "水😀" }];
  const changed = editPng(fixture(), assignments, { signal });
  assert.throws(() => editPng(fixture(), assignments, { signal, maxOutputBytes: changed.length - 1 }), /output/);
  assert.throws(() => editPng(fixture(), [{ name: "Title", operation: "set", value: "\ud800" }], { signal }), /surrogate/);
  assert.throws(() => editPng(fixture(), [{ name: "Title", operation: "set", value: "\udc00" }], { signal }), /surrogate/);
});

test("malformed IHDR encoding fields are refused before edits", () => {
  const base = fixture();
  for (const [index, value] of [[8, 3], [9, 1], [10, 1], [11, 1], [12, 2]]) {
    const header = base.slice(16, 29);
    header[index!] = value!;
    const bytes = new Uint8Array(Buffer.concat([signature, pngChunk("IHDR", header), base.subarray(33)]));
    assert.throws(() => editPng(bytes, [{ name: "Title", operation: "set", value: "new" }], { signal }), /IHDR/);
  }
});

test("PNG tIME normalizes explicit timestamp syntax without ambient timezone or losing raw identity", () => {
  const base = fixture("keep");
  for (const value of ["2024:02:29 12:34:56", "2024-02-29T12:34:56.789+05:30", "2024-02-29T12:34:56Z"]) {
    const changed = editPng(base, [{ name: "ModifyDate", operation: "set", value }], { signal });
    const tag = inspectPng(changed, { signal }).tags.find(tag => tag.name === "ModifyDate")!;
    assert.equal(tag.value, "2024:02:29 12:34:56");
    assert.equal(tag.rawName, "tIME");
    assert.equal(tag.chunkType, "tIME");
    assert.deepEqual(tag.raw, new Uint8Array([7, 232, 2, 29, 12, 34, 56]));
    assert.deepEqual(imageChunks(changed), imageChunks(base));
    assert.deepEqual(editPng(changed, [{ name: "ModifyDate", operation: "set", value: "" }], { signal }), base);
  }
});

test("tIME duplicate deletion preserves other text; temporal shifts are independently refused", () => {
  const base = fixture("keep");
  const time = pngChunk("tIME", new Uint8Array([7, 232, 2, 29, 12, 34, 56]));
  const input = new Uint8Array(Buffer.concat([base.subarray(0, 33), time, time, base.subarray(33)]));
  assert.deepEqual(inspectPng(input, { signal }).tags.filter(tag => tag.name === "ModifyDate").map(tag => tag.instance), [0, 1]);
  assert.deepEqual(editPng(input, [{ name: "ModifyDate", operation: "set", value: "" }], { signal }), base);
  for (const operation of ["add", "remove"] as const) {
    assert.throws(() => editPng(input, [{ name: "ModifyDate", operation, value: "2024:02:29 12:34:56" }], { signal }), /Temporal shifts.*not yet supported/);
  }
  assert.deepEqual(editPng(input, [{ name: "all", operation: "set", value: "" }], { signal }), fixture());
});

test("tIME refuses malformed lengths and unqualified date syntax without output", () => {
  const base = fixture();
  const input = new Uint8Array(Buffer.concat([base.subarray(0, 33), pngChunk("tIME", new Uint8Array(6)), base.subarray(33)]));
  assert.throws(() => inspectPng(input, { signal }), /tIME/);
  for (const value of ["now", "2024:13:01 12:00:00", "2024-02-29T12:34:56+99:99", "2024-02-29T12:34:56junk"]) {
    assert.throws(() => editPng(base, [{ name: "ModifyDate", operation: "set", value }], { signal }), /timestamp/);
  }
});

test("tIME extraction keeps oversized stored fields in ValueConv without shifting separators", () => {
  const base = fixture();
  const raw = new Uint8Array([255, 255, 255, 255, 255, 255, 255]);
  const input = new Uint8Array(Buffer.concat([base.subarray(0, 33), pngChunk("tIME", raw), base.subarray(33)]));
  const tag = inspectPng(input, { signal }).tags[0]!;
  assert.equal(tag.value, "65535:255:255 255:255:255");
  assert.deepEqual(tag.raw, raw);
});

test("timestamp writes preserve unknown text with a colliding ModifyDate keyword", () => {
  const base = fixture();
  const unknown = pngChunk("tEXt", new TextEncoder().encode("ModifyDate\0opaque"));
  const input = new Uint8Array(Buffer.concat([base.subarray(0, 33), unknown, base.subarray(33)]));
  const edited = editPng(input, [{ name: "ModifyDate", operation: "set", value: "2024:02:29 12:34:56" }], { signal });
  assert.deepEqual(edited.subarray(33, 33 + unknown.length), unknown);
  assert.deepEqual(inspectPng(edited, { signal }).tags.map(tag => tag.value), ["opaque", "2024:02:29 12:34:56"]);
  assert.deepEqual(editPng(edited, [{ name: "ModifyDate", operation: "set", value: "" }], { signal }), input);
});

test("delete removes all selected duplicates; remove matches only specified scalar", () => {
  assert.deepEqual(inspectPng(editPng(fixture("first", "second"), [{ name: "Title", operation: "remove", value: "first" }], { signal }), { signal }).tags.map(tag => tag.value), ["second"]);
  assert.deepEqual(editPng(fixture("first", "second"), [{ name: "Title", operation: "set", value: "" }], { signal }), fixture());
});

test("unknown chunks survive selected tag editing and scalar += is refused", () => {
  const input = new Uint8Array(Buffer.concat([fixture("first").subarray(0,33), pngChunk("vpAg", new Uint8Array([1,2,3])), fixture("first").subarray(33)]));
  const output = editPng(input, [{ name: "Title", operation: "set", value: "second" }], { signal });
  assert.deepEqual(output.subarray(33,48), input.subarray(33,48));
  assert.throws(() => editPng(input, [{ name: "Title", operation: "add", value: "extra" }], { signal }), /Shift value.*not a number/);
});

test("PNG refuses malformed image structure before publication", () => {
  const base = fixture();
  assert.throws(() => inspectPng(new Uint8Array(Buffer.concat([signature, base.subarray(33)])), { signal }), /IHDR/);
  assert.throws(() => inspectPng(new Uint8Array(Buffer.concat([base.subarray(0,33), base.subarray(base.length - 12)])), { signal }), /IDAT/);
  assert.throws(() => inspectPng(new Uint8Array(Buffer.concat([base.subarray(0,33), base.subarray(8)])), { signal }), /IHDR/);
  const header = base.slice(16,29); header.fill(0,0,4);
  assert.throws(() => inspectPng(new Uint8Array(Buffer.concat([signature, pngChunk("IHDR", header), base.subarray(33)])), { signal }), /dimensions/);
});

test("extracted metadata owns raw byte provenance independently of input and display", () => {
  const input = fixture("a\0b"); const result = inspectPng(input, { signal });
  input.fill(0);
  assert.equal(result.tags[0]!.value, "a\0b");
  assert.deepEqual(result.tags[0]!.raw, new Uint8Array([97,0,98]));
});

test("tag identity retains exact stored keyword and source chunk separately from display name", () => {
  const bytes = fixture();
  const input = new Uint8Array(Buffer.concat([bytes.subarray(0,33), pngChunk("tEXt", new TextEncoder().encode("title\0value")), bytes.subarray(33)]));
  const tag = inspectPng(input, { signal }).tags[0]!;
  assert.equal(tag.name, "Title"); assert.equal(tag.rawName, "title"); assert.equal(tag.chunkType, "tEXt"); assert.equal(tag.index, 1);
});

test("retained bytes and algorithm work include assignment and unknown chunk storage", () => {
  assert.throws(() => inspectPng(fixture("value"), { signal, maxRetainedBytes: 100 }), /retained/);
  assert.throws(() => editPng(fixture(), [{ name: "Title", operation: "set", value: "x".repeat(100) }], { signal, maxWork: 1000 }), /work/);
});

test("all= removes text metadata on admitted text-only PNG, preserving image chunks", () => {
  const input = fixture("first", "second");
  assert.deepEqual(editPng(input, [{ name: "all", operation: "set", value: "" }], { signal }), fixture());
  const unknown = new Uint8Array(Buffer.concat([input.subarray(0,33), pngChunk("vpAg", new Uint8Array([1])), input.subarray(33)]));
  assert.throws(() => editPng(unknown, [{ name: "all", operation: "set", value: "" }], { signal }), /all deletion.*not yet supported/);
});

test("reject truncated lengths, CRC damage, compressed metadata and resource exhaustion", () => {
  assert.throws(() => inspectPng(fixture("x").subarray(0,40), { signal }), /truncated/);
  const damaged = fixture("x"); damaged[42] = damaged[42]! ^ 1;
  assert.throws(() => inspectPng(damaged, { signal }), /CRC/);
  const compressed = new Uint8Array(Buffer.concat([fixture().subarray(0,33), pngChunk("zTXt", new Uint8Array([65,0,0])), fixture().subarray(33)]));
  assert.throws(() => inspectPng(compressed, { signal }), /not yet supported/);
  assert.throws(() => inspectPng(fixture("x"), { signal, maxInputBytes: 10 }), /input/);
  assert.throws(() => inspectPng(fixture("x"), { signal, maxWork: 10 }), /work/);
  assert.throws(() => inspectPng(fixture("x"), { signal, maxDecodedBytes: 1 }), /decoded/);
  assert.throws(() => editPng(fixture("x"), [{ name: "Title", operation: "set", value: "new" }], { signal, maxOutputBytes: 10 }), /output/);
  assert.throws(() => inspectPng(fixture(), { signal: AbortSignal.abort("cancel") }), error => error === "cancel");
});
