import assert from "node:assert/strict";
import { test } from "node:test";
import * as rust from "../dist/index.js";
import * as reference from "tiny-stdio-mcp-server";

const url = "https://user:password@example.test/files/sample?q=private#secret";

test("remote media helpers match detected/header MIME types and text charsets", async t => {
  for (const kind of ["Image", "Audio", "File"]) {
    assert.equal(typeof rust[kind].fromUrl, "function");
    for (const [bytes, header] of [
      [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]), "audio/wav"],
      [Uint8Array.from([255, 251, ...new Array(12).fill(0)]), "image/png"],
      [Uint8Array.from([97]), "image/PNG; ignored=1"],
      [Uint8Array.from([97]), "audio/WAV; charset=utf-8"],
      [Uint8Array.from([239, 187, 191, 97]), "text/plain; CHARSET=\"utf-8\""],
      [Uint8Array.from([233]), "text/plain; charset=windows-1252"],
      [Uint8Array.from([255, 254, 97, 0]), "text/plain; charset=utf-16"],
      [Uint8Array.from([255]), "text/plain; charset=unsupported"],
      [Uint8Array.from([97]), "application/json"],
      [Uint8Array.from([97]), null]
    ]) {
      const mocked = t.mock.method(globalThis, "fetch", async () => new Response(bytes, {
        headers: header === null ? {} : { "content-type": header }
      }));
      let expected, error;
      try { expected = (await reference[kind].fromUrl(url)).toContentBlock(); }
      catch (failure) { error = failure.message; }
      if (error) await assert.rejects(rust[kind].fromUrl(url), { message: error });
      else assert.deepEqual((await rust[kind].fromUrl(url)).toContentBlock(), expected);
      mocked.mock.restore();
    }
  }
  assert.equal(rust.DEFAULT_FROM_URL_MAX_BYTES, reference.DEFAULT_FROM_URL_MAX_BYTES);
});

test("remote byte limits reject declared/streamed/fallback overflow and redact URL details", async t => {
  for (const kind of ["Image", "Audio", "File"]) {
    for (const [makeResponse, options] of [
      [() => new Response(Uint8Array.from([97]), { status: 403, statusText: "Forbidden" }), {}],
      [() => new Response(Uint8Array.from([97]), { headers: { "content-type": "image/png", "content-length": "100" } }), { maxBytes: 2 }],
      [() => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(Uint8Array.from([97])); controller.enqueue(Uint8Array.from([98, 99])); controller.close();
      } }), { headers: { "content-type": "image/png" } }), { maxBytes: 2 }],
      [() => ({ ok: true, headers: new Headers(), body: null, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }), { maxBytes: 2 }],
      ...[0, -1, NaN, Infinity, 0.5, "2", true, {}, 1n].map(maxBytes => [() => new Response("hello"), { maxBytes }])
    ]) {
      const mocked = t.mock.method(globalThis, "fetch", async () => makeResponse());
      let error;
      try { await reference[kind].fromUrl(url, options); }
      catch (failure) { error = failure.message; }
      assert.ok(error);
      await assert.rejects(rust[kind].fromUrl(url, options), { message: error });
      assert.ok(!error.includes("password") && !error.includes("private") && !error.includes("secret"));
      mocked.mock.restore();
    }
  }
});

test("streamed byte limits cancel overflowing readers and release locks on completion/failure", async t => {
  for (const overflow of [false, true]) {
    let canceled = 0, released = 0, index = 0;
    const mocked = t.mock.method(globalThis, "fetch", async () => ({
      ok: true, headers: new Headers({ "content-type": "image/png" }), body: { getReader() {
        return {
          async read() { return index++ === 0 ? { done: false, value: Uint8Array.from([1, 2, 3]) } : { done: true }; },
          async cancel() { canceled++; }, releaseLock() { released++; }
        };
      } }
    }));
    if (overflow) await assert.rejects(rust.Image.fromUrl(url, { maxBytes: 2 }), /exceeds maximum size/);
    else assert.equal((await rust.Image.fromUrl(url, { maxBytes: 3 })).toContentBlock().data, "AQID");
    assert.equal(canceled, Number(overflow));
    assert.equal(released, 1);
    mocked.mock.restore();
  }
});
