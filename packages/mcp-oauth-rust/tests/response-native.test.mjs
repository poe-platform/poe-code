import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "mcp-oauth";
function response(chunks, headers) {
  let canceled = 0;
  const body = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); }, cancel() { canceled++; } });
  return { response: new Response(body, { headers }), canceled: () => canceled };
}
test("bounded readers match strict streaming UTF8, declared and actual byte limits", async () => {
  for (const factory of [native, reference]) {
    const bytes = Buffer.from("\ufeff🦊é");
    const readers = new Set();
    assert.equal(await factory.readBoundedResponseText(response([...bytes].map(byte => Uint8Array.of(byte))).response, bytes.length, readers), "🦊é");
    assert.equal(readers.size, 0);
    assert.equal(await factory.readBoundedResponseText(new Response(null), 4), "");
    for (const limit of [0, -1, 0.5, NaN, -Infinity, Number.MAX_SAFE_INTEGER+1]) await assert.rejects(factory.readBoundedResponseText(new Response(null), limit), { message: "HTTP response byte limit must be a positive safe integer" });
    for (const input of [response([Buffer.from("12345")]).response, response([], { "Content-Length": "000000000000000000005" }).response]) await assert.rejects(factory.readBoundedResponseText(input, 4), { message: "HTTP response exceeds 4 bytes" });
    await assert.rejects(factory.readBoundedResponseText(response([Uint8Array.of(0xc3,0x28)]).response, 4));
    assert.equal(await factory.readBoundedResponseText(response([Buffer.from("1234")], { "Content-Length": "5x" }).response, 4), "1234");
  }
});
test("unlimited readers accept large declared lengths and retain strict decoding", async () => {
  for (const factory of [native, reference]) {
    const readers = new Set();
    assert.equal(await factory.readBoundedResponseText(response([Buffer.from("ok")], { "Content-Length": "9".repeat(128) }).response, Infinity, readers), "ok");
    assert.equal(readers.size, 0);
    await assert.rejects(factory.readBoundedResponseText(response([Uint8Array.of(0xc3, 0x28)]).response, Infinity));
  }
});
test("bounded readers cancel and release locks and tracking entries on failure or abort", async () => {
  for (const factory of [native, reference]) {
    const readers = new Set();
    let controller; let canceled = 0;
    const body = new ReadableStream({ start(value) { controller = value; }, cancel() { canceled++; } });
    const abort = new AbortController();
    const pending = factory.readBoundedResponseText(new Response(body), 16, readers, abort.signal);
    const rejection = assert.rejects(pending, { message: "stop" });
    assert.equal(readers.size, 1); abort.abort(new Error("stop")); await rejection;
    assert.equal(readers.size, 0); assert.equal(body.locked, false); assert.equal(canceled, 1);
    const pre = new AbortController(); pre.abort(new Error("pre"));
    await assert.rejects(factory.readBoundedResponseText(response([]).response, 16, readers, pre.signal), { message: "pre" });
    assert.equal(readers.size, 0);
    void controller;
  }
});
test("fetch always rejects redirects and cancels unexpected redirected response bodies", async () => {
  for (const factory of [native, reference]) {
    let observed; const ordinary = new Response("ok");
    assert.equal(await factory.fetchMcpResponse(async (input, init) => { observed = { input, init }; return ordinary; }, "https://example.test", { method: "POST", redirect: "follow" }), ordinary);
    assert.equal(observed.init.redirect, "error"); assert.equal(observed.init.method, "POST");
    for (const flags of [{ redirected: true, type: "basic" }, { redirected: false, type: "opaqueredirect" }]) {
      let canceled = 0;
      await assert.rejects(factory.fetchMcpResponse(async () => ({ ...flags, body: { async cancel() { canceled++; } } }), "https://example.test"), { message: "MCP HTTP redirects are not allowed" });
      assert.equal(canceled, 1);
    }
  }
});

test("public HTTP validation errors retain the reference Error shape", async () => {
  for (const factory of [native, reference]) {
    const operations = [
      () => factory.readBoundedResponseText(new Response(null), 0),
      () => factory.readBoundedResponseText(response([Buffer.from("12345")]).response, 4),
      () => factory.readBoundedResponseText(response([], { "Content-Length": "5" }).response, 4),
      () => factory.fetchMcpResponse(async () => ({ redirected:true, type:"basic", body:null }), "https://example.test")
    ];
    for (const run of operations) await assert.rejects(run(), error => error.name === "Error" && !Object.hasOwn(error, "code"));
  }
});

test("explicit Infinity admits complete response bodies and oversized declared lengths", async () => {
  for (const factory of [native, reference]) {
    const readers = new Set();
    const body = response([Buffer.from("first"), Buffer.from("🦊last")], { "Content-Length": "9999999999999999999999999999999999999" });
    assert.equal(await factory.readBoundedResponseText(body.response, Infinity, readers), "first🦊last");
    assert.equal(readers.size, 0);
    assert.equal(body.response.body.locked, false);
    assert.equal(await factory.readBoundedResponseText(new Response(null), Infinity), "");
    await assert.rejects(factory.readBoundedResponseText(response([Uint8Array.of(255)]).response, Infinity), TypeError);
    const abort = new AbortController(), reason = { unlimitedCancelled: true }; abort.abort(reason);
    await assert.rejects(factory.readBoundedResponseText(new Response("body"), Infinity, readers, abort.signal), error => error === reason);
  }
});
