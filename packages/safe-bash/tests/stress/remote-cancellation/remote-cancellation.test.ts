import assert from "node:assert/strict";
import { setImmediate as turn } from "node:timers/promises";
import { S3RenameError, toByteSource } from "../../../src/index.js";
import type { S3HeadOutput } from "../../../src/index.js";
import type { S3StreamGetOutput } from "../../../src/fs/s3/transport.js";
import {
  audit, bounded, bytes, canceled, gate, httpFixture, injectedDav, observe, original,
  producer, s3Fixture, saved, shell, shellFailure, text,
} from "./helpers.js";

audit("S01 S3 pre-aborted aggregate pipeline starts no transport", async trace => {
  const { fs } = await s3Fixture(trace);
  trace.abort();
  await shellFailure(shell(fs, trace)("cat /input | cat"), trace);
  assert.equal(trace.events.filter(event => event.startsWith("op:")).length, 0);
});

audit("S02 S3 pending metadata stops waiting and observes late rejection", async trace => {
  const entered = gate();
  const pending = gate<S3HeadOutput>();
  const { fs } = await s3Fixture(trace, { headObject(_input, options) {
    assert.equal(options?.abortSignal, trace.controller.signal);
    entered.resolve(); return pending.promise;
  } });
  const reading = observe(fs.stat("/input", { signal: trace.controller.signal }));
  await bounded(entered.promise, "HEAD acquisition");
  try {
    trace.abort();
    await canceled(reading, trace, "pending S3 HEAD");
    trace.noNewOperations();
  } finally { pending.reject(new Error("late HEAD rejection")); await turn(); }
});

audit("S03 S3 aggregate GET abort closes cooperative body", async trace => {
  const body = producer(trace, bytes("first\n"));
  const { fs } = await s3Fixture(trace, { async getObjectStream(_input, options) {
    assert.ok(options?.abortSignal);
    options.abortSignal.addEventListener("abort", () => {
      trace.event("GET.signal.abort"); body.pending.reject(options.abortSignal!.reason);
    }, { once: true });
    return { Body: body.source, ContentLength: original.length };
  } });
  const reading = shell(fs, trace)("cat /input | cat");
  await bounded(body.entered.promise, "GET pending next");
  trace.abort();
  await shellFailure(reading, trace);
  await bounded(body.returned.promise, "GET iterator return");
  assert.ok(trace.events.includes("GET.signal.abort"));
  trace.noNewOperations();
});

audit("S04 S3 noncooperative GET next and late rejecting return are observed", async trace => {
  const body = producer(trace, bytes("first\n"), true);
  const { fs } = await s3Fixture(trace, { async getObjectStream() { return { Body: body.source, ContentLength: original.length }; } });
  const stream = fs.readStream!("/input", { signal: trace.controller.signal })[Symbol.asyncIterator]();
  assert.deepEqual((await bounded(stream.next(), "first GET chunk")).value, bytes("first\n"));
  const reading = observe(stream.next());
  await bounded(body.entered.promise, "noncooperative GET pull");
  trace.abort();
  await canceled(reading, trace, "noncooperative S3 body");
  await bounded(body.returned.promise, "uncooperative iterator cleanup invoked");
  body.pending.reject(new Error("late body next rejection"));
  body.cleanup.reject(new Error("late body return rejection"));
  await turn();
  trace.noNewOperations();
});

audit("S05 S3 late GET response body is disposed after prompt cancellation", async trace => {
  const entered = gate();
  const response = gate<S3StreamGetOutput>();
  const disposed = gate();
  const { fs } = await s3Fixture(trace, { getObjectStream() { entered.resolve(); return response.promise; } });
  const stream = fs.readStream!("/input", { signal: trace.controller.signal })[Symbol.asyncIterator]();
  const reading = observe(stream.next());
  await bounded(entered.promise, "GET transport entry");
  try {
    trace.abort();
    await canceled(reading, trace, "pending S3 GET response");
  } finally {
    response.resolve({ Body: Object.assign(toByteSource(original), { destroy() { trace.event("late.body.destroy"); disposed.resolve(); } }), ContentLength: original.length });
    await bounded(disposed.promise, "late response body disposal");
    trace.noNewOperations();
  }
});

audit("S06 S3 aggregate PUT staging abort preserves old destination", async trace => {
  const staged = gate();
  const release = gate();
  const returned = gate();
  const { fs, contents } = await s3Fixture(trace, { async putObjectStream(input, options) {
    assert.ok(options?.abortSignal);
    const iterator = input.Body[Symbol.asyncIterator]();
    trace.event("PUT.body.acquire");
    try {
      const chunk = await iterator.next();
      assert.equal(chunk.done, false);
      trace.event(`PUT.stage:${chunk.value!.length}`);
      staged.resolve();
      await release.promise;
      assert.equal(options.abortSignal.aborted, true);
      throw options.abortSignal.reason;
    } finally {
      await iterator.return?.(); trace.event("PUT.body.return"); returned.resolve();
    }
  } });
  const writing = shell(fs, trace)("cat | sort -o /output", { stdin: original });
  await bounded(staged.promise, "S3 PUT staging");
  try {
    trace.abort();
    await shellFailure(writing, trace);
    assert.deepEqual(await contents("output"), saved);
    trace.event("state:output=KEEP:publication=not-started");
  } finally { release.resolve(); await bounded(returned.promise, "transport-owned iterator returned"); }
  trace.noNewOperations();
});

audit("S07 S3 append staging abort returns pending producer before PUT", async trace => {
  const body = producer(trace, bytes("new"), true);
  const { fs, contents } = await s3Fixture(trace);
  const writing = observe(fs.writeStream!("/output", body.source, { flag: "a", signal: trace.controller.signal }));
  await bounded(body.entered.promise, "append pending producer");
  trace.abort();
  await canceled(writing, trace, "S3 append staging");
  await bounded(body.returned.promise, "append producer return");
  assert.equal(trace.events.some(event => event.startsWith("op:S3.put")), false);
  assert.deepEqual(await contents("output"), saved);
  trace.event("state:output=KEEP:publication=not-started");
  trace.noNewOperations();
});

audit("S08 S3 aggregate head early exit cancels upstream GET", async trace => {
  const body = producer(trace, original);
  const delivered = gate();
  let signal: AbortSignal | undefined;
  const { fs } = await s3Fixture(trace, { async getObjectStream(_input, options) {
    signal = options?.abortSignal;
    return { Body: body.source, ContentLength: original.length };
  } });
  const reading = shell(fs, trace)("cat /input | head -n 1", { stdout: { async write(chunk) {
    assert.equal(text(chunk), "first\n"); trace.event("head.stdout:first\\n"); delivered.resolve();
  } } });
  await bounded(delivered.promise, "head output delivered");
  const result = await bounded(reading, "head early exit").catch(async error => {
    trace.event(`head.before-rescue:signalAborted=${signal?.aborted}:returned=${trace.events.filter(event => event === "source.return").length}:headSettled=${trace.events.includes("command.settled:head")}`);
    trace.abort();
    await shellFailure(reading, trace);
    await bounded(body.returned.promise, "rescue closes upstream S3 iterator");
    trace.event("head.rescue:iterator-returned-before-fixture-release");
    trace.noNewOperations();
    throw error;
  });
  assert.equal(result.kind, "value");
  if (result.kind === "value") {
    trace.event(`settled:exit=${result.value.exitCode}:stdout=${JSON.stringify(result.value.stdout)}`);
    assert.equal(result.value.exitCode, 0);
    assert.equal(result.value.stdout, "first\n");
  }
  await bounded(body.returned.promise, "head upstream return");
  assert.equal(signal?.aborted, true);
  trace.noNewOperations();
});

audit("S09 S3 aggregate output quota releases GET iterator", async trace => {
  const body = producer(trace);
  let signal: AbortSignal | undefined;
  const { fs } = await s3Fixture(trace, { async getObjectStream(_input, options) {
    signal = options?.abortSignal;
    return { Body: body.source, ContentLength: original.length };
  } });
  await shellFailure(shell(fs, trace)("cat /input | cat", { limits: { maxOutputBytes: 5 } }), trace, "quota");
  await bounded(body.returned.promise, "quota GET return");
  assert.equal(signal?.aborted, true);
  trace.noNewOperations();
});

audit("S10 S3 aggregate upload quota closes body without publication", async trace => {
  const { fs, contents, client } = await s3Fixture(trace, {}, 3);
  const result = await bounded(shell(fs, trace)("cat | sort -o /output", { stdin: original }), "upload quota");
  assert.equal(result.kind, "value");
  if (result.kind === "value") {
    trace.event(`settled:exit=${result.value.exitCode}:stderr=${result.value.stderr.trim()}`);
    assert.equal(result.value.exitCode, 1);
    assert.match(result.value.stderr, /large|limit|EFBIG/i);
  }
  assert.ok(trace.events.some(event => event.startsWith("op:S3.putObjectStream")));
  assert.ok(trace.events.includes("PUT.transport.body.error:EFBIG"));
  assert.ok(trace.events.includes("PUT.transport.body.return"));
  assert.equal(client.requests.filter(request => request.operation === "putObject").length, 3);
  assert.deepEqual(await contents("output"), saved);
  trace.event("state:output=KEEP:publication=not-started");
  trace.noNewOperations();
});

audit("S11 S3 rename abort after accepted copy retains documented partial effect", async trace => {
  const fixture = await s3Fixture(trace, { async copyObject(input, options) {
    const result = await client.copyObject(input, options);
    trace.event(`copy.accepted:${input.Key}`);
    trace.abort();
    return result;
  } });
  const client: Awaited<ReturnType<typeof s3Fixture>>["client"] = fixture.client;
  const result = await bounded(observe(fixture.fs.rename("/input", "/copied", { signal: trace.controller.signal })), "partial rename");
  assert.equal(result.kind, "error");
  if (result.kind === "error") {
    assert.ok(result.error instanceof S3RenameError);
    assert.equal(result.error.code, "ECANCELED");
    assert.equal(result.error.phase, "copy");
    assert.deepEqual(result.error.deletedKeys, []);
    trace.event(`settled:${result.error.name}:${result.error.code}:phase=${result.error.phase}:copiedKeys=${JSON.stringify(result.error.copiedKeys)}`);
  }
  assert.deepEqual(await fixture.contents("input"), original);
  assert.deepEqual(await fixture.contents("copied"), original);
  assert.equal(trace.events.some(event => event.startsWith("op:S3.delete")), false);
  trace.event("state:input=original:copied=original:accepted-copy-not-undone");
  trace.noNewOperations();
});

audit("S12 S3 streaming PUT abort returns pending producer before mock publication", async trace => {
  const body = producer(trace, bytes("new"), true);
  const { fs, contents } = await s3Fixture(trace);
  const writing = observe(fs.writeStream!("/output", body.source, { signal: trace.controller.signal }));
  await bounded(body.entered.promise, "S3 streaming PUT pending producer");
  trace.abort();
  await canceled(writing, trace, "S3 streaming PUT producer abort");
  await bounded(body.returned.promise, "S3 streaming PUT producer returned before release");
  assert.ok(trace.events.some(event => event.startsWith("op:S3.putObjectStream")));
  assert.deepEqual(await contents("output"), saved);
  trace.event("state:output=KEEP:publication=not-started");
  trace.noNewOperations();
});

audit("D01 native HTTP WebDAV pre-aborted aggregate pipeline sends nothing", async trace => {
  const { fs } = await httpFixture(trace);
  trace.abort();
  await shellFailure(shell(fs, trace)("cat /input | cat"), trace);
  assert.equal(trace.events.some(event => event.startsWith("http.request:")), false);
  trace.noNewOperations();
});

audit("D02 injected WebDAV pending metadata stops waiting despite noncooperative fetch", async trace => {
  const entered = gate();
  const pending = gate<Response>();
  const { fs } = injectedDav(trace, async (_url, init) => {
    assert.ok(init.signal);
    entered.resolve(); return pending.promise;
  });
  const reading = observe(fs.stat("/input", { signal: trace.controller.signal }));
  await bounded(entered.promise, "PROPFIND entry");
  try {
    trace.abort();
    await canceled(reading, trace, "noncooperative WebDAV metadata");
  } finally {
    pending.reject(new Error("late PROPFIND rejection"));
    trace.event("after-fixture-release:metadata");
    await canceled(reading, trace, "released metadata");
    trace.noNewOperations();
  }
});

audit("D03 native HTTP WebDAV aggregate GET abort closes stalled socket", async trace => {
  const disconnected = gate();
  const delivered = gate();
  const { fs } = await httpFixture(trace, (request, response) => {
    if (request.method !== "GET") return false;
    response.on("close", () => disconnected.resolve());
    response.writeHead(200, { "Content-Length": String(original.length) });
    response.write(bytes("first\n"));
    return true;
  });
  const reading = shell(fs, trace)("cat /input | cat", { stdout: { async write(chunk) { trace.event(`stdout:${chunk.length}`); delivered.resolve(); } } });
  await bounded(delivered.promise, "GET bytes reached downstream");
  trace.abort();
  await shellFailure(reading, trace);
  await bounded(disconnected.promise, "GET socket disconnect before fixture teardown");
  trace.noNewOperations();
});

audit("D04 injected WebDAV stalled body releases reader and observes late cancel rejection", async trace => {
  const entered = gate();
  const pulled = gate();
  const cleanup = gate();
  const returned = gate();
  const body = new ReadableStream<Uint8Array>({
    pull() { trace.event("body.pull"); entered.resolve(); return pulled.promise; },
    cancel() { trace.event("body.cancel"); returned.resolve(); return cleanup.promise; },
  }, { highWaterMark: 0 });
  const { fs } = injectedDav(trace, async (_url, init) => init.method === "GET" ? new Response(body) : undefined);
  const stream = fs.readStream("/input", { signal: trace.controller.signal });
  const reading = observe(stream.next());
  await bounded(entered.promise, "WebDAV pending body pull");
  try {
    trace.abort();
    await canceled(reading, trace, "WebDAV pending reader");
    await bounded(returned.promise, "WebDAV cancel invoked");
    assert.equal(body.locked, false);
    trace.event("body.reader.released=true");
    trace.noNewOperations();
  } finally {
    pulled.reject(new Error("late pull rejection"));
    cleanup.reject(new Error("late cancel rejection"));
    await turn();
  }
});

audit("D05 injected WebDAV late GET response is canceled after bounded caller settlement", async trace => {
  const entered = gate();
  const pending = gate<Response>();
  const disposed = gate();
  const body = new ReadableStream<Uint8Array>({ cancel() { trace.event("late.body.cancel"); disposed.resolve(); } }, { highWaterMark: 0 });
  const { fs } = injectedDav(trace, async (_url, init) => {
    if (init.method !== "GET") return undefined;
    entered.resolve(); return pending.promise;
  });
  const stream = fs.readStream("/input", { signal: trace.controller.signal });
  const reading = observe(stream.next());
  await bounded(entered.promise, "WebDAV GET entry");
  try {
    trace.abort();
    await canceled(reading, trace, "noncooperative WebDAV GET response");
  } finally {
    pending.resolve(new Response(body));
    trace.event("after-fixture-release:GET-response");
    await canceled(reading, trace, "GET after fixture release");
    await bounded(disposed.promise, "late GET response canceled");
    assert.equal(body.locked, false);
    trace.event("late.body.reader.released=true");
    trace.noNewOperations();
  }
});

audit("D06 native HTTP WebDAV aggregate PUT abort before server publication", async trace => {
  const staged = gate();
  const disconnected = gate();
  const { fs, mock } = await httpFixture(trace, async (request, response) => {
    if (request.method !== "PUT") return false;
    response.on("close", () => disconnected.resolve());
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    trace.event(`PUT.staged:${Buffer.concat(chunks).length}:publication=not-started`);
    staged.resolve();
    return true;
  });
  const writing = shell(fs, trace)("cat | sort -o /output", { stdin: original });
  await bounded(staged.promise, "HTTP PUT staging");
  trace.abort();
  await shellFailure(writing, trace);
  await bounded(disconnected.promise, "PUT socket closed before fixture teardown");
  assert.deepEqual(mock.files.get("/output"), saved);
  trace.event("state:output=KEEP:publication=not-started");
  trace.noNewOperations();
});

audit("D07 native HTTP WebDAV PUT abort returns blocked producer and preserves unpublished bytes", async trace => {
  const body = producer(trace, bytes("new"), true);
  const uploaded = gate();
  const disconnected = gate();
  const { fs, mock } = await httpFixture(trace, (request, response) => {
    if (request.method !== "PUT") return false;
    response.on("close", () => disconnected.resolve());
    request.on("data", chunk => { trace.event(`PUT.received:${chunk.length}`); uploaded.resolve(); });
    return true;
  });
  const writing = observe(fs.writeStream("/output", body.source, { signal: trace.controller.signal }));
  await bounded(body.entered.promise, "PUT pending producer");
  await bounded(uploaded.promise, "PUT bytes reach server");
  trace.abort();
  await canceled(writing, trace, "WebDAV PUT producer abort");
  await bounded(body.returned.promise, "PUT producer return before release");
  await bounded(disconnected.promise, "PUT socket close before fixture teardown");
  assert.deepEqual(mock.files.get("/output"), saved);
  trace.event("state:output=KEEP:publication=not-started");
  trace.noNewOperations();
});

audit("D08 native HTTP WebDAV aggregate head early exit cancels GET socket", async trace => {
  const disconnected = gate();
  const delivered = gate();
  let closed = false;
  const { fs } = await httpFixture(trace, (request, response) => {
    if (request.method !== "GET") return false;
    response.on("close", () => { closed = true; disconnected.resolve(); });
    response.writeHead(200, { "Content-Length": String(original.length) });
    response.write(bytes("first\n"));
    return true;
  });
  const reading = shell(fs, trace)("cat /input | head -n 1", { stdout: { async write(chunk) {
    assert.equal(text(chunk), "first\n"); trace.event("head.stdout:first\\n"); delivered.resolve();
  } } });
  await bounded(delivered.promise, "HTTP head output delivered");
  const result = await bounded(reading, "HTTP head early exit").catch(async error => {
    trace.event(`head.before-rescue:GETclosed=${closed}:headSettled=${trace.events.includes("command.settled:head")}`);
    trace.abort();
    await shellFailure(reading, trace);
    await bounded(disconnected.promise, "rescue closes upstream HTTP response before teardown");
    trace.event("head.rescue:GET-closed-before-fixture-teardown");
    trace.noNewOperations();
    throw error;
  });
  assert.equal(result.kind, "value");
  if (result.kind === "value") {
    trace.event(`settled:exit=${result.value.exitCode}:stdout=${JSON.stringify(result.value.stdout)}`);
    assert.equal(result.value.exitCode, 0);
    assert.equal(result.value.stdout, "first\n");
  }
  await bounded(disconnected.promise, "head GET socket close before teardown");
  trace.noNewOperations();
});

audit("D09 native HTTP WebDAV aggregate output quota cancels GET socket", async trace => {
  const disconnected = gate();
  const { fs } = await httpFixture(trace, (request, response) => {
    if (request.method !== "GET") return false;
    response.on("close", () => disconnected.resolve());
    response.writeHead(200, { "Content-Length": String(original.length) });
    response.write(bytes("first\n"));
    return true;
  });
  await shellFailure(shell(fs, trace)("cat /input | cat", { limits: { maxOutputBytes: 5 } }), trace, "quota");
  await bounded(disconnected.promise, "quota GET socket close before teardown");
  trace.noNewOperations();
});

audit("D10 native HTTP WebDAV aggregate upload quota preserves unpublished destination", async trace => {
  const { fs, mock } = await httpFixture(trace, undefined, 3);
  const result = await bounded(shell(fs, trace)("cat | sort -o /output", { stdin: original }), "HTTP upload quota");
  assert.equal(result.kind, "value");
  if (result.kind === "value") {
    trace.event(`settled:exit=${result.value.exitCode}:stderr=${result.value.stderr.trim()}`);
    assert.equal(result.value.exitCode, 1);
    assert.match(result.value.stderr, /large|limit|EFBIG/i);
  }
  assert.ok(trace.events.some(event => event.startsWith("op:DAV.PUT")));
  assert.deepEqual(mock.files.get("/output"), saved);
  trace.event("state:output=KEEP:publication=not-started");
  trace.noNewOperations();
});

audit("D11 native HTTP WebDAV MOVE accepted before abort is not rolled back", async trace => {
  const accepted = gate();
  const disconnected = gate();
  const { fs, mock } = await httpFixture(trace, async (request, response, backend) => {
    if (request.method !== "MOVE") return false;
    response.on("close", () => disconnected.resolve());
    request.resume();
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
    const result = await backend.fetch(`http://${request.headers.host}${request.url}`, { method: "MOVE", headers });
    assert.equal(result.status, 201);
    await result.body?.cancel();
    trace.event("MOVE.accepted:201:response-withheld");
    accepted.resolve();
    return true;
  });
  const moving = observe(fs.rename("/input", "/moved", { signal: trace.controller.signal }));
  await bounded(accepted.promise, "server accepted MOVE");
  trace.abort();
  await canceled(moving, trace, "MOVE canceled response wait");
  await bounded(disconnected.promise, "MOVE response socket closed");
  assert.equal(mock.files.has("/input"), false);
  assert.equal(text(mock.files.get("/moved")!), text(original));
  trace.event("state:input=absent:moved=original:accepted-MOVE-not-undone");
  trace.noNewOperations();
});

audit("D12 native HTTP WebDAV pending metadata abort closes response socket", async trace => {
  const entered = gate();
  const disconnected = gate();
  const { fs } = await httpFixture(trace, (request, response) => {
    assert.equal(request.method, "PROPFIND");
    response.on("close", () => disconnected.resolve());
    request.resume();
    entered.resolve();
    return true;
  });
  const reading = observe(fs.stat("/input", { signal: trace.controller.signal }));
  await bounded(entered.promise, "native PROPFIND awaiting headers");
  trace.abort();
  await canceled(reading, trace, "native WebDAV metadata");
  await bounded(disconnected.promise, "metadata socket closed before teardown");
  assert.equal(trace.events.some(event => event.startsWith("op:DAV.GET")), false);
  trace.noNewOperations();
});
