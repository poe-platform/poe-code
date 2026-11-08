import assert from "node:assert/strict";
import { test } from "node:test";
import * as rust from "../dist/index.js";
import * as reference from "tiny-stdio-mcp-server";

const fixtures = [
  ["image/png", "png", [137, 80, 78, 71, 13, 10, 26, 10]],
  ["image/jpeg", "jpg", [255, 216, 255]],
  ["image/gif", "gif", [...Buffer.from("GIF8")]],
  ["image/webp", "webp", [...Buffer.from("RIFF0000WEBP")]],
  ["audio/mpeg", "mp3", [255, 251]],
  ["audio/mpeg", "mp3", [...Buffer.from("ID3")]],
  ["audio/wav", "wav", [...Buffer.from("RIFF0000WAVE")]],
  ["audio/ogg", "ogg", [...Buffer.from("OggS")]],
  ["audio/mp4", "m4a", [...Buffer.from("0000ftypM4A ")]],
  ["video/mp4", "mp4", [...Buffer.from("0000ftypisom")]],
  ["video/webm", "webm", [26, 69, 223, 163]]
].map(([mime, ext, prefix]) => [mime, ext, Uint8Array.from([...prefix, ...new Array(20).fill(0)])]);

test("Rust media sniffing matches every signature, truncation and unaligned byte slice", () => {
  assert.equal(typeof rust.fileTypeFromBuffer, "function");
  for (const [mime, ext, bytes] of fixtures) {
    assert.deepEqual(rust.fileTypeFromBuffer(bytes), { mime, ext });
    for (let size = 0; size <= bytes.length; size++)
      assert.deepEqual(rust.fileTypeFromBuffer(bytes.subarray(0, size)), reference.fileTypeFromBuffer(bytes.subarray(0, size)));
    const padded = Uint8Array.from([4, 3, 2, ...bytes, 1]);
    assert.deepEqual(rust.fileTypeFromBuffer(padded.subarray(3, 3 + bytes.length)), { mime, ext });
  }
  assert.equal(rust.fileTypeFromBuffer(new Uint8Array(32)), undefined);
});

test("Image and Audio byte/base64 helpers match MIME aliases, detection and errors", () => {
  for (const kind of ["Image", "Audio"]) {
    assert.equal(typeof rust[kind], "function");
    for (const [, , bytes] of fixtures) {
      for (const format of [undefined, "", "PNG", "image/JPEG", "mp3", "M4A", "ogg", "audio/MPEG", "unknown"]) {
        let expected, error;
        try { expected = reference[kind].fromBytes(bytes, format).toContentBlock(); }
        catch (failure) { error = failure.message; }
        if (error) assert.throws(() => rust[kind].fromBytes(bytes, format), { message: error });
        else assert.deepEqual(rust[kind].fromBytes(bytes, format).toContentBlock(), expected);
      }
    }
    for (const base64 of ["", "YQ==", "YR==", "YWI=", "YWJ=", "YWJj", "YQ=", "!!!!", "====", "Y===", "YQ==\n"])
      for (const mime of [kind === "Image" ? "IMAGE/PNG" : "AUDIO/WAV", "wrong/type"]) {
        let expected, error;
        try { expected = reference[kind].fromBase64(base64, mime).toContentBlock(); }
        catch (failure) { error = failure.message; }
        if (error) assert.throws(() => rust[kind].fromBase64(base64, mime), { message: error });
        else assert.deepEqual(rust[kind].fromBase64(base64, mime).toContentBlock(), expected);
      }
  }
});

test("File helpers preserve text, encode binary and match UTF8 replacement and BOM decoding", () => {
  assert.equal(typeof rust.File, "function");
  for (const mime of ["text/plain", "TEXT/PLAIN", "application/json", "application/a+json", "application/xml", "application/a+xml", "application/javascript", "application/typescript", "application/octet-stream", "text/plain;charset=utf-8"])
    for (const bytes of [new Uint8Array(), Uint8Array.from([239, 187, 191, 97]), Uint8Array.from([240, 128, 128, 128, 255]), Uint8Array.from([0, 128, 255])]) {
      assert.deepEqual(rust.File.fromBytes(bytes, mime).toContentBlock(), reference.File.fromBytes(bytes, mime).toContentBlock());
      assert.deepEqual(rust.File.fromBase64(Buffer.from(bytes).toString("base64"), mime).toContentBlock(), reference.File.fromBase64(Buffer.from(bytes).toString("base64"), mime).toContentBlock());
    }
  for (const text of ["", "hello", "\u0000\ud800\udc00\ud800\udfff"])
    for (const mime of [undefined, "text/plain", "application/octet-stream"])
      assert.deepEqual(rust.File.fromText(text, mime).toContentBlock(), reference.File.fromText(text, mime).toContentBlock());
  for (const base64 of ["YR==", "YWJ=", "", "!!!!", "YQ="]) {
    let expected, error;
    try { expected = reference.File.fromBase64(base64, "application/octet-stream").toContentBlock(); }
    catch (failure) { error = failure.message; }
    if (error) assert.throws(() => rust.File.fromBase64(base64, "application/octet-stream"), { message: error });
    else assert.deepEqual(rust.File.fromBase64(base64, "application/octet-stream").toContentBlock(), expected);
  }
});

test("helpers retain reference mutation semantics and integrate with nested tool arrays", async () => {
  for (const api of [rust, reference]) {
    const bytes = Uint8Array.from([97]);
    const file = api.File.fromBytes(bytes, "text/plain");
    bytes[0] = 98;
    assert.equal(file.toContentBlock().resource.text, "b");
    const image = api.Image.fromBytes(bytes, "png");
    bytes[0] = 99;
    assert.equal(image.toContentBlock().data, "Yg==");
    const block = file.toContentBlock();
    block.resource.text = "mutated";
    assert.equal(file.toContentBlock().resource.text, "c");
  }
  const results = [];
  for (const api of [rust, reference]) {
    const server = api.createServer({ name: "media", version: "1" });
    server.tool("media", "Media", { type: "object" }, () => [
      api.Image.fromBase64("YQ==", "image/png"), [undefined, api.Audio.fromBytes(Uint8Array.from([98]), "wav"), api.File.fromText("hello")]
    ]);
    results.push(await server.handleMessage("tools/call", { name: "media", _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    } }));
  }
  assert.deepEqual(results[0], results[1]);
});

test("base64 encoding and decoding match Buffer across byte lengths and the complete byte alphabet", () => {
  let seed = 42;
  for (let length = 0; length < 512; length++) {
    const bytes = Uint8Array.from({ length }, () => {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      return seed >>> 24;
    });
    const encoded = Buffer.from(bytes).toString("base64");
    assert.equal(rust.Image.fromBytes(bytes, "png").toContentBlock().data, encoded);
    assert.equal(rust.File.fromBase64(encoded, "application/octet-stream").toContentBlock().resource.blob, encoded);
  }
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  assert.equal(rust.Audio.fromBytes(bytes, "wav").toContentBlock().data, Buffer.from(bytes).toString("base64"));
});

test("UTF8 file decoding matches the platform decoder across seeded malformed sequences", () => {
  let seed = 123;
  const decoder = new TextDecoder();
  for (let sample = 0; sample < 4096; sample++) {
    const bytes = Uint8Array.from({ length: sample % 17 }, () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 24;
    });
    assert.equal(rust.File.fromBytes(bytes, "text/plain").toContentBlock().resource.text, decoder.decode(bytes));
  }
});

test("helper-array conversion retains rejected hooks and does not call overridable helper methods", async () => {
  let calls = 0;
  const image = rust.Image.fromBase64("YQ==", "image/png");
  image.toContentBlock = () => { calls++; throw new Error("Must not run"); };
  const server = rust.createServer({ name: "media", version: "1" });
  let value = [image];
  server.tool("media", "Media", { type: "object" }, () => value);
  await server.handleMessage("initialize");
  assert.equal((await server.handleMessage("tools/call", { name: "media" })).result.content[0].type, "image");
  for (const inherited of [false, true]) {
    value = [image];
    const hook = { toJSON() { calls++; return []; } };
    if (inherited) Object.setPrototypeOf(value, Object.assign(Object.create(Array.prototype), hook));
    else Object.defineProperty(value, "toJSON", { value: hook.toJSON });
    assert.equal((await server.handleMessage("tools/call", { name: "media" })).result.isError, true);
  }
  assert.equal(calls, 0);
});
