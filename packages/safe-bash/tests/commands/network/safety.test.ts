import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { FsError, toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { createCurlCommand, type HttpResponse, type HttpTransport } from "../../../src/commands/network/index.js";
import { fixture, run, server } from "./helpers.js";

function response(body: ByteSource = toByteSource("ok")): HttpResponse {
  return { status: 200, statusText: "OK", headers: [], body, async dispose() {} };
}

test("registration requires an explicit authorizer", () => {
  assert.throws(() => createCurlCommand({} as never), /authorizer/);
});

for (const args of [
  ["--connect-timeout", "1"], ["--proxy", "http://proxy.invalid"], ["--netrc"], ["-k"], ["--compressed"],
  ["-X", "GET\r\nInjected: bad"], ["-X", "CONNECT"], ["-H", "Authorization: secret\r\nX: injection"],
  ["-H", "Content-Length: 9"], ["-H", "Host: elsewhere"], ["--max-time", "NaN"], ["--retry", "-1"],
  ["--data", "x", "-T", "file"], ["--json", "{}", "-F", "x=y"], ["-u", "user-without-password"],
]) test(`unsupported/malformed arguments fail before networking: ${JSON.stringify(args)}`, async () => {
  let called = false;
  const result = await run([...args, "http://127.0.0.1/"], { options: { transport: async () => { called = true; return response(); } } });
  assert.equal(result.exitCode, 2); assert.equal(called, false);
  assert.doesNotMatch(result.stderr.toString(), /secret|proxy\.invalid|elsewhere|user-without-password/);
});

test("denied URLs neither invoke transport nor consume uploads", async () => {
  let reads = 0; let calls = 0;
  const stdin = (async function* () { reads++; yield Buffer.from("secret"); })();
  const result = await run(["-T", "-", "http://127.0.0.1/"], { stdin,
    options: { authorize: () => false, transport: async () => { calls++; return response(); } },
  });
  assert.equal(result.exitCode, 7); assert.equal(reads, 0); assert.equal(calls, 0);
});

test("timeout covers authorization and observes late rejection", async () => {
  const result = await run(["-m", "0.01", "http://127.0.0.1/"], { options: {
    authorize: async () => { await sleep(30); throw new Error("private policy detail"); },
  } });
  assert.equal(result.exitCode, 28); await sleep(40);
  assert.doesNotMatch(result.stderr.toString(), /private policy/);
});

test("late transport responses are disposed after timeout", async () => {
  let disposed = 0;
  const result = await run(["-m", "0.01", "http://127.0.0.1/"], { options: {
    transport: async () => { await sleep(30); return { ...response(), async dispose() { disposed++; } }; },
  } });
  assert.equal(result.exitCode, 28); await sleep(40); assert.equal(disposed, 1);
});

test("pre-aborted commands perform no work", async () => {
  const controller = new AbortController(); controller.abort(new Error("stopped"));
  await assert.rejects(run(["http://127.0.0.1/"], { signal: controller.signal }), /stopped/);
});

test("external abort closes a streaming HTTP response", { timeout: 2000 }, async () => {
  const host = await server(); const controller = new AbortController();
  try {
    await assert.rejects(run([host.origin + "/stream"], { signal: controller.signal, stdout: {
      async write() { controller.abort(new Error("consumer canceled")); },
    } }), /consumer canceled/);
    await sleep(40); assert.equal(host.closedStreams, 1);
  } finally { await host.close(); }
});

test("downstream EPIPE closes request/body without a shell workaround", { timeout: 2000 }, async () => {
  const host = await server();
  try {
    const result = await run([host.origin + "/stream"], { stdout: { async write() { throw new FsError("EPIPE"); } } });
    assert.equal(result.exitCode, 23); await sleep(40); assert.equal(host.closedStreams, 1);
  } finally { await host.close(); }
});

test("total timeout closes a server that never sends headers", { timeout: 2000 }, async () => {
  const host = await server();
  try { const result = await run(["-m", "0.03", host.origin + "/slow"]); assert.equal(result.exitCode, 28); await sleep(30); assert.equal(host.closedStreams, 1); }
  finally { await host.close(); }
});

test("download quota stops stream and returns curl 63", async () => {
  const host = await server();
  try { const result = await run(["--max-filesize", "100", host.origin + "/stream"]); assert.equal(result.exitCode, 63); assert.equal(result.stdout.length, 0); await sleep(30); assert.equal(host.closedStreams, 1); }
  finally { await host.close(); }
});

test("upload quota stops bytes rather than truncating successfully", async () => {
  const host = await server();
  try { const result = await run(["-T", "-", host.origin + "/echo"], { stdin: "too large", options: { limits: { maxUploadBytes: 3 } } }); assert.equal(result.exitCode, 63); }
  finally { await host.close(); }
});

test("stdin replay overflow fails honestly instead of sending a prefix", async () => {
  const host = await server();
  try {
    const result = await run(["-L", "-T", "-", host.origin + "/redirect/307"], { stdin: Buffer.alloc(400, 97), options: { limits: { maxBufferBytes: 128 } } });
    assert.equal(result.exitCode, 65); assert.equal(host.requests.filter(request => request.path === "/echo").length, 0);
  } finally { await host.close(); }
});

test("output awaits sink pressure before pulling subsequent chunks", async () => {
  let produced = 0; let writes = 0; let disposed = 0;
  const source = (async function* () { for (let index = 0; index < 12; index++) { produced++; yield Buffer.from("x"); } })();
  const result = await run(["http://127.0.0.1/"], { stdout: { async write() { assert.equal(produced, ++writes); await sleep(1); } },
    options: { transport: async () => ({ ...response(source), async dispose() { disposed++; } }) },
  });
  assert.equal(result.exitCode, 0); assert.equal(writes, 12); assert.equal(disposed, 1);
});

test("producer throws and partial output cannot become success", async () => {
  const source = (async function* () { yield Buffer.from("prefix"); throw new Error("secret transport detail"); })();
  const result = await run(["http://127.0.0.1/"], { options: { transport: async () => response(source) } });
  assert.equal(result.exitCode, 56); assert.equal(result.stdout.toString(), "prefix"); assert.doesNotMatch(result.stderr.toString(), /secret/);
});

test("empty-chunk producers do not starve timeout cancellation", { timeout: 2000 }, async () => {
  const source = (async function* () { while (true) yield new Uint8Array(); })();
  const result = await run(["-m", "0.02", "http://127.0.0.1/"], { options: { transport: async () => response(source) } });
  assert.equal(result.exitCode, 28);
});

test("VFS output errors remain failure and dispose the response", async () => {
  const fs = await fixture(); let disposed = 0;
  fs.writeStream = async () => { throw new FsError("ENOSPC"); };
  const result = await run(["-o", "out", "http://127.0.0.1/"], { fs, options: { transport: async () => ({ ...response(), async dispose() { disposed++; } }) } });
  assert.equal(result.exitCode, 23); assert.equal(disposed, 1);
});

test("sensitive URL userinfo is absent from policy, transport and diagnostics", async () => {
  let seen = "";
  const result = await run(["-v", "http://user:secret@127.0.0.1/path"], { options: {
    authorize: request => { assert.doesNotMatch(request.url, /user|secret/); return true; },
    transport: async request => { seen = request.url; throw new Error("secret transport exception"); },
  } });
  assert.equal(seen, "http://127.0.0.1/path"); assert.equal(result.exitCode, 56); assert.doesNotMatch(result.stderr.toString(), /secret|dXNlcjpzZWNyZXQ=/);
});
