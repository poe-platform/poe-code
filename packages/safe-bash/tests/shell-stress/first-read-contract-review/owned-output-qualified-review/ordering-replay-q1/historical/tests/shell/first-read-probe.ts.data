import assert from "node:assert/strict";
import { agentCommands, MemoryFileSystem, networkCommands, pipeBytes, Shell } from "../../src/index.js";
import type { ByteSource, FileSystem } from "../../src/contracts/index.js";
import { bounded, gate, httpFixture, s3Fixture, Trace } from "../stress/remote-cancellation/helpers.js";

const scenario = process.argv[2]!;
const trace = new Trace();
const started = gate();
const closed = gate();
const keepAlive = setInterval(() => {}, 1000);
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
process.on("unhandledRejection", onUnhandled);
let fs: FileSystem = new MemoryFileSystem();
let active = 0;
let reads = 0;
let returned = 0;
let observed: AbortSignal | undefined;
let url: string | undefined;
let instance: Shell | undefined;

function pendingSource(signal: AbortSignal): ByteSource {
  observed = signal;
  return (async function* () {
    reads++;
    active++;
    trace.event("source.next:pending-before-first-byte");
    started.resolve();
    try {
      await new Promise<never>((_resolve, reject) => {
        signal.throwIfAborted();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    } finally {
      active--;
      returned++;
      trace.event("source.finally");
      closed.resolve();
    }
  })();
}

try {
  if (scenario === "first-read-s3") {
    ({ fs } = await s3Fixture(trace, { async getObjectStream(_input, options) {
      assert.ok(options?.abortSignal);
      return { Body: pendingSource(options.abortSignal), ContentLength: 13 };
    } }));
  } else if (scenario === "first-read-webdav" || scenario.startsWith("first-read-curl-")) {
    const fixture = await httpFixture(trace, (request, response) => {
      if (request.method !== "GET") return false;
      active++;
      reads++;
      response.once("close", () => { active--; returned++; closed.resolve(); });
      if (scenario !== "first-read-curl-headers") {
        response.writeHead(200, { "Content-Length": "13" });
        response.flushHeaders();
      }
      trace.event("http.GET:pending-before-first-byte");
      setImmediate(() => started.resolve());
      return true;
    });
    fs = fixture.fs;
    const address = fixture.server.address();
    assert.ok(address && typeof address !== "string");
    url = `http://127.0.0.1:${address.port}/dav/input`;
  }
  const shell = new Shell({ fs });
  instance = shell;
  shell.use(agentCommands());
  if (url && scenario.startsWith("first-read-curl-")) {
    shell.use(networkCommands({ authorize: request => request.url === url && request.method === "GET" }));
  }
  shell.commands.register({ name: "pending-stream", async execute({ stdout, signal }) {
    await pipeBytes(pendingSource(signal), stdout, signal);
    return { exitCode: 0 };
  } });
  shell.use(async (context, next) => {
    if (context.command === "head" && scenario !== "first-read-head-zero") await started.promise;
    if (context.command === "cat" || context.command === "curl") observed = context.signal;
    const result = await next();
    trace.event(`command.settled:${context.command}:${result.exitCode}`);
    return result;
  });
  if (scenario === "first-read-head-zero") {
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { reads++; throw new Error("head zero must not read"); },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
    const result = await bounded(shell.exec("head -n 0", { stdin }), scenario);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(reads, 0);
    assert.equal(returned, 1);
  } else {
    const producer = scenario === "first-read-local" ? "pending-stream" : scenario.startsWith("first-read-curl-") ? `curl ${url}` : "cat /input";
    const result = await bounded(shell.exec(`${producer} | head -n 0; true`, { signal: trace.controller.signal }), scenario);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(trace.controller.signal.aborted, false);
    assert.equal(observed?.aborted, true);
    assert.equal((observed?.reason as { code: string }).code, "EPIPE");
    await bounded(closed.promise, "first-read closes before fixture teardown");
    assert.equal(reads, 1);
    assert.equal(returned, 1);
    assert.equal(active, 0);
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
  console.log(`${scenario}: passed`);
} finally {
  console.log(JSON.stringify({ scenario, active, reads, returned, abortedBeforeTeardown: trace.controller.signal.aborted, events: trace.events }));
  trace.controller.abort(new Error("failed-test teardown, never acceptance rescue"));
  await instance?.dispose();
  for (const cleanup of trace.cleanups.reverse()) await cleanup();
  process.removeListener("unhandledRejection", onUnhandled);
  clearInterval(keepAlive);
}
