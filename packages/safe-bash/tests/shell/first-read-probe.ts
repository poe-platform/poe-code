import assert from "node:assert/strict";
import { setImmediate as turn } from "node:timers/promises";
import {
  agentCommands,
  createNodeHttpTransport,
  createOutputOperation,
  MemoryFileSystem,
  networkCommands,
  pipeBytes,
  Shell,
} from "../../src/index.js";
import type { ByteSource, FileSystem, ShellResult } from "../../src/index.js";
import { bounded, httpFixture, s3Fixture, Trace } from "../stress/remote-cancellation/helpers.js";
import {
  FirstReadOwnedFixtures,
  settlesWithin,
  type FirstReadScenario,
  type FirstReadSnapshot,
} from "./first-read-owned-fixtures.js";

const scenarios = new Set<FirstReadScenario>([
  "first-read-head-zero",
  "first-read-local-unenrolled-controlled",
  "first-read-local-owned",
  "first-read-s3",
  "first-read-webdav",
  "first-read-curl-body",
  "first-read-curl-headers",
  "first-read-webdav-body-acquired",
  "first-read-curl-body-acquired",
  "first-read-required-destinations",
]);
const requested = process.argv[2];
assert.ok(requested && scenarios.has(requested as FirstReadScenario), `known first-read scenario: ${String(requested)}`);
const scenario = requested as FirstReadScenario;
const beforeHeaders = scenario === "first-read-webdav" || scenario === "first-read-curl-body" || scenario === "first-read-curl-headers";
const trace = new Trace();
const fixture = new FirstReadOwnedFixtures(scenario);
const keepAlive = setInterval(() => {}, 1000);
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
process.on("unhandledRejection", onUnhandled);
fixture.watchSignal("caller", trace.controller.signal);
fixture.installObservers();

let fs: FileSystem = new MemoryFileSystem();
let url: string | undefined;
let instance: Shell | undefined;
let execution: Promise<ShellResult> | undefined;
let publicFinished = false;
let failure: unknown;
const cleanupFailures: unknown[] = [];
const originalOperation = trace.operation.bind(trace);
trace.operation = (name, signal): void => {
  if (name === "S3.getObjectStream:input") fixture.watchSignal("s3-get", signal);
  if (name === "DAV.GET:/dav/input") fixture.watchSignal("dav-get", signal);
  originalOperation(name, signal);
};

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function snapshotSignal(snapshot: FirstReadSnapshot, name: string): { readonly aborted: boolean; readonly code?: unknown } {
  const signal = snapshot.signals[name];
  assert.ok(signal, `public snapshot includes ${name}`);
  return signal;
}

function assertLive(snapshot: FirstReadSnapshot, name: string): void {
  assert.equal(snapshotSignal(snapshot, name).aborted, false, `${name} remains live at public settlement`);
}

function assertEpipe(snapshot: FirstReadSnapshot, name: string): void {
  assert.deepEqual(snapshotSignal(snapshot, name), { aborted: true, code: "EPIPE" }, `${name} closes with EPIPE`);
}

function assertResult(result: ShellResult, stderr = ""): void {
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, stderr);
}

function assertRemoteSignals(boundary: FirstReadSnapshot, command: "cat" | "curl", operation: "dav-get" | "curl-transport"): void {
  assertLive(boundary, "caller");
  assertLive(boundary, `command:${command}`);
  assertEpipe(boundary, `destination:${command}`);
  assertEpipe(boundary, operation);
}

try {
  const remote = scenario === "first-read-webdav"
    || scenario === "first-read-curl-body"
    || scenario === "first-read-curl-headers"
    || scenario === "first-read-webdav-body-acquired"
    || scenario === "first-read-curl-body-acquired"
    || scenario === "first-read-required-destinations";
  if (scenario === "first-read-s3") {
    ({ fs } = await s3Fixture(trace, { async getObjectStream(_input, options) {
      assert.ok(options?.abortSignal);
      return { Body: fixture.pendingSource(options.abortSignal), ContentLength: 13 };
    } }));
  } else if (remote) {
    const remoteFixture = await httpFixture(trace, (request, response) => {
      if (request.method !== "GET") return false;
      fixture.serverResponseStarted();
      response.once("close", () => fixture.serverResponseClosed());
      if (beforeHeaders) {
        assert.equal(response.headersSent, false);
        fixture.mark("server-holds-headers-before-consumer-release");
        fixture.started.resolve();
        return true;
      }
      response.writeHead(200, { "Content-Length": "13" });
      response.flushHeaders();
      if (scenario !== "first-read-webdav-body-acquired" && scenario !== "first-read-curl-body-acquired") {
        setImmediate(() => fixture.started.resolve());
      }
      if (scenario === "first-read-required-destinations") {
        void fixture.requiredRelease.promise.then(() => {
          fixture.mark("server-provides-required-body");
          response.end("first\nsecond\n");
        });
      }
      return true;
    });
    fs = scenario === "first-read-required-destinations" ? fs : remoteFixture.fs;
    const address = remoteFixture.server.address();
    assert.ok(address && typeof address !== "string");
    url = `http://127.0.0.1:${address.port}/dav/input`;
  }

  instance = new Shell({ fs }).use(agentCommands());
  if (scenario === "first-read-curl-body" || scenario === "first-read-curl-headers"
    || scenario === "first-read-curl-body-acquired" || scenario === "first-read-required-destinations") {
    assert.ok(url);
    instance.use(networkCommands({
      authorize: request => request.url === url && request.method === "GET",
      transport: fixture.observeTransport(createNodeHttpTransport()),
    }));
  }
  instance.commands.register({ name: "pending-stream", async execute(context) {
    if (scenario === "first-read-local-owned") {
      const operation = createOutputOperation(context, context.stdout);
      fixture.watchSignal("local-operation", operation.signal);
      try {
        const source = await operation.acquire(signal => {
          fixture.counters.acquiredResources++;
          fixture.mark("local-source-acquire");
          return fixture.pendingSource(signal);
        }, async source => {
          fixture.mark("local-resource-release-start");
          await source.return?.();
          fixture.counters.resourceReleases++;
          fixture.mark("local-resource-release-finish");
        });
        await pipeBytes(source, operation.output, operation.signal);
        return { exitCode: 0 };
      } catch (error) {
        context.signal.throwIfAborted();
        if (operation.signal.aborted && errorCode(operation.signal.reason) === "EPIPE") return { exitCode: 141 };
        throw error;
      } finally {
        await operation.close();
      }
    }
    const source = fixture.pendingSource(context.signal, scenario === "first-read-local-unenrolled-controlled");
    await pipeBytes(source, context.stdout, context.signal);
    return { exitCode: 0 };
  } });
  instance.use(async (context, next) => {
    fixture.watchSignal(`command:${context.command}`, context.signal);
    if (context.stdout.ownedOutput && context.command !== "head" && context.command !== "true") {
      fixture.watchSignal(`destination:${context.command}`, context.stdout.ownedOutput.consumerClosed);
      if (scenario === "first-read-required-destinations") {
        context.stdout.ownedOutput.consumerClosed.addEventListener("abort", () => {
          fixture.mark("stdout-close-allows-required-response");
          fixture.requiredRelease.resolve();
        }, { once: true });
      }
    }
    if (context.command === "head" && scenario !== "first-read-head-zero") {
      await fixture.started.promise;
      if (beforeHeaders) {
        assert.equal(fixture.counters.serverResponses, 1);
        assert.equal(fixture.counters.getResponses, 0);
        assert.equal(fixture.counters.responseAcquired, 0);
        fixture.mark("consumer-released-with-request-pending-before-headers");
      }
    }
    const result = await next();
    fixture.mark(`command-settled:${context.command}:${result.exitCode}`);
    return result;
  });

  fixture.phase = "execution";
  if (scenario === "first-read-head-zero") {
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { fixture.counters.sourceReads++; throw new Error("head zero must not read"); },
      async return() { fixture.counters.sourceReturns++; return { done: true as const, value: undefined }; },
    }; } };
    const result = await bounded(instance.exec("head -n 0", { stdin, signal: trace.controller.signal }), scenario);
    publicFinished = true;
    fixture.phase = "public-settled";
    const boundary = fixture.snapshot();
    assertResult(result);
    assert.equal(boundary.counters.sourceReads, 0);
    assert.equal(boundary.counters.sourceReturns, 1);
    assertLive(boundary, "caller");
    assertLive(boundary, "command:head");
  } else {
    assert.ok(url || scenario === "first-read-local-unenrolled-controlled"
      || scenario === "first-read-local-owned" || scenario === "first-read-s3");
    const producer = scenario === "first-read-local-unenrolled-controlled" || scenario === "first-read-local-owned"
      ? "pending-stream"
      : scenario === "first-read-required-destinations"
        ? `curl -v -o /body -D /headers ${url}`
        : scenario.startsWith("first-read-curl-")
          ? `curl ${url}`
          : "cat /input";
    let boundary: FirstReadSnapshot | undefined;
    execution = instance.exec(`${producer} | head -n 0; true`, { signal: trace.controller.signal });
    const publicExecution = execution.then(result => {
      publicFinished = true;
      fixture.phase = "public-settled";
      boundary = fixture.snapshot();
      return result;
    });
    let result: ShellResult;
    if (scenario === "first-read-local-unenrolled-controlled") {
      await bounded(fixture.started.promise, "unenrolled source starts");
      assert.equal(await settlesWithin(publicExecution, 1200), false, "unenrolled public execution remains pending for 1200ms");
      assert.equal(fixture.counters.activeSource, 1);
      assert.equal(fixture.counters.sourceReads, 1);
      assert.equal(fixture.counters.sourceReturns, 0);
      assert.equal(trace.controller.signal.aborted, false);
      assert.equal(fixture.signal("command:pending-stream").aborted, false);
      fixture.mark("controlled-host-release-after-1200ms");
      fixture.hostRelease.resolve();
      result = await bounded(publicExecution, "unenrolled settlement after controlled release");
    } else {
      result = await bounded(publicExecution, scenario);
    }
    assert.ok(boundary, "public boundary snapshot captured");
    const atPublic = boundary as FirstReadSnapshot;
    if (scenario === "first-read-required-destinations") {
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
    } else {
      assertResult(result);
    }
    assertLive(atPublic, "caller");

    if (scenario === "first-read-local-unenrolled-controlled") {
      assertLive(atPublic, "command:pending-stream");
      assertEpipe(atPublic, "destination:pending-stream");
      assert.equal(atPublic.counters.sourceReads, 1);
      assert.equal(atPublic.counters.sourceReturns, 1);
      assert.equal(atPublic.counters.activeSource, 0);
      assert.equal(fixture.signal("source").aborted, false);
    } else if (scenario === "first-read-local-owned") {
      assertLive(atPublic, "command:pending-stream");
      assertEpipe(atPublic, "destination:pending-stream");
      assertEpipe(atPublic, "local-operation");
      assert.equal(atPublic.counters.acquiredResources, 1);
      assert.equal(atPublic.counters.resourceReleases, 1);
      assert.equal(atPublic.counters.sourceReads, 1);
      assert.equal(atPublic.counters.sourceReturns, 1);
      assert.equal(atPublic.counters.activeSource, 0);
    } else if (scenario === "first-read-s3") {
      assertLive(atPublic, "command:cat");
      assertEpipe(atPublic, "destination:cat");
      assertEpipe(atPublic, "s3-get");
      assert.equal(atPublic.counters.sourceReads, 1);
      assert.equal(atPublic.counters.sourceReturns, 1);
      assert.equal(atPublic.counters.activeSource, 0);
    } else if (scenario === "first-read-webdav") {
      assertRemoteSignals(atPublic, "cat", "dav-get");
      assert.equal(atPublic.counters.getFetchCalls, 1);
      assert.equal(atPublic.counters.getFetchSettled, 1);
      assert.equal(atPublic.counters.getFetchRejected, 1);
      assert.equal(atPublic.counters.getResponses, 0);
      assert.equal(atPublic.counters.getBodyReaders, 0);
    } else if (scenario === "first-read-curl-body" || scenario === "first-read-curl-headers") {
      assertRemoteSignals(atPublic, "curl", "curl-transport");
      assert.equal(atPublic.counters.transportCleanupRegistrations, 1);
      assert.equal(atPublic.counters.transportCleanupCalls, 1);
      assert.equal(atPublic.counters.transportCleanupCompleted, 1);
      assert.equal(atPublic.counters.clientRequests, 1);
      assert.equal(atPublic.counters.clientCloses, 1);
      assert.equal(atPublic.counters.responseAcquired, 0);
      assert.equal(atPublic.counters.responseDisposals, 0);
    } else if (scenario === "first-read-webdav-body-acquired") {
      assertRemoteSignals(atPublic, "cat", "dav-get");
      assert.equal(atPublic.counters.getFetchCalls, 1);
      assert.equal(atPublic.counters.getFetchSettled, 1);
      assert.equal(atPublic.counters.getFetchRejected, 0);
      assert.equal(atPublic.counters.getResponses, 1);
      assert.equal(atPublic.counters.getBodyReaders, 1);
      assert.equal(atPublic.counters.getReadCalls, 1);
      assert.equal(atPublic.counters.getReadsPending, 0);
      assert.equal(atPublic.counters.getReaderReleases, 1);
      assert.ok(atPublic.counters.getReaderCancelCalls >= 1);
      assert.ok(atPublic.counters.getBodyCancelCalls >= 1);
      assert.equal(atPublic.counters.getReaderCancelFulfilled, 0);
      assert.equal(atPublic.counters.getReaderCancelRejected, atPublic.counters.getReaderCancelCalls);
      assert.equal(atPublic.counters.getBodyCancelFulfilled, 0);
      assert.equal(atPublic.counters.getBodyCancelRejected, atPublic.counters.getBodyCancelCalls);
      fixture.assertGetCancellationErrorsAreEpipe();
    } else if (scenario === "first-read-curl-body-acquired") {
      assertRemoteSignals(atPublic, "curl", "curl-transport");
      assert.equal(atPublic.counters.responseAcquired, 1);
      assert.equal(atPublic.counters.responseReadCalls, 1);
      assert.equal(atPublic.counters.responseReadsPending, 0);
      assert.equal(atPublic.counters.responseIteratorReturns, 1);
      assert.equal(atPublic.counters.responseIteratorReturnsDone, 1);
      assert.equal(atPublic.counters.responseDisposals, 1);
      assert.equal(atPublic.counters.responseDisposalsDone, 1);
      assert.equal(atPublic.counters.transportCleanupRegistrations, 1);
      assert.equal(atPublic.counters.transportCleanupCalls, 1);
      assert.equal(atPublic.counters.transportCleanupCompleted, 1);
      assert.equal(atPublic.counters.clientRequests, 1);
      assert.equal(atPublic.counters.clientCloses, 1);
    } else {
      assert.equal(scenario, "first-read-required-destinations");
      assertLive(atPublic, "command:curl");
      assertEpipe(atPublic, "destination:curl");
      assertLive(atPublic, "curl-transport");
      assert.equal(atPublic.counters.responseAcquired, 1);
      assert.equal(atPublic.counters.responseDisposals, 1);
      assert.equal(atPublic.counters.responseDisposalsDone, 1);
      assert.equal(atPublic.counters.transportCleanupRegistrations, 1);
      assert.equal(atPublic.counters.transportCleanupCalls, 1);
      assert.equal(atPublic.counters.transportCleanupCompleted, 1);
      assert.equal(atPublic.counters.clientRequests, 1);
      assert.equal(atPublic.counters.clientCloses, 1);
      assert.deepEqual(await fs.readFile("/body"), new TextEncoder().encode("first\nsecond\n"));
      const headers = new TextDecoder().decode(await fs.readFile("/headers"));
      assert.match(headers, /^HTTP\/1\.1 200 /u);
      assert.match(headers, /content-length: 13/iu);
      assert.match(result.stderr, /< HTTP 200/u);
    }

    if (remote) {
      fixture.phase = "passive-close";
      await bounded(fixture.closed.promise, `${scenario}: passive server response close`);
      assert.equal(fixture.counters.serverResponses, 1);
      assert.equal(fixture.counters.serverCloses, 1);
      assert.equal(fixture.counters.activeSource, 0);
      assert.equal(fixture.counters.sourceReturns, 1);
    }
  }
  await turn();
  fixture.assertNoObserverErrors();
  assert.deepEqual(unhandled, []);
} catch (error) {
  failure = error;
} finally {
  fixture.phase = "cleanup";
  if (!publicFinished) {
    fixture.hostRelease.resolve();
    fixture.requiredRelease.resolve();
    if (!trace.controller.signal.aborted) trace.controller.abort(new Error("failed first-read test teardown, never acceptance rescue"));
    if (execution) {
      try { await bounded(execution.then(() => {}, () => {}), "failed execution teardown"); }
      catch (error) { cleanupFailures.push(error); }
    }
  }
  try {
    fixture.phase = "dispose";
    await instance?.dispose();
  } catch (error) { cleanupFailures.push(error); }
  for (const cleanup of trace.cleanups.reverse()) {
    try { await bounded(Promise.resolve().then(cleanup), "first-read fixture cleanup", 2000); }
    catch (error) { cleanupFailures.push(error); }
  }
  try { await fixture.restoreObservers(); }
  catch (error) { cleanupFailures.push(error); }
  process.removeListener("unhandledRejection", onUnhandled);
  clearInterval(keepAlive);
  console.log(JSON.stringify({
    scenario,
    publicFinished,
    callerAbortedBeforeCleanup: trace.controller.signal.aborted,
    counters: fixture.counters,
    cleanupFailures: cleanupFailures.map(String),
    unhandled: unhandled.map(String),
    events: fixture.events,
    fixtureEvents: trace.events,
  }));
}

if (failure !== undefined && cleanupFailures.length) throw new AggregateError([failure, ...cleanupFailures], "first-read assertion and cleanup failures");
if (failure !== undefined) throw failure;
if (cleanupFailures.length === 1) throw cleanupFailures[0];
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, "first-read cleanup failures");
console.log(`${scenario}: passed`);
