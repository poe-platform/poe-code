import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  CommandRegistry,
  MemoryFileSystem,
  createCurlCommand,
  type ByteSink,
  type CommandContext,
  type CommandResult,
  type HttpRequest,
  type HttpResponse,
} from "../../../../../src/index.js";

interface CaseExpectation {
  id: string;
  kind: "Buffer" | "Uint8Array";
  expectedFirst: number[];
  expectedSecond: number[];
}

interface Expectations {
  profile: string;
  args: string[];
  inputChunks: number[][];
  backingLength: number;
  viewOffset: number;
  finalizerFill: number;
  cases: CaseExpectation[];
  expectedExitCode: number;
  expectedMethods: string[];
  expectedUrls: string[];
  expectedResponseStatuses: number[];
  expectedStdinYields: number;
  expectedStdinEmptyYields: number;
  expectedStdinFinalizations: number;
  expectedResponseGeneratorFinalizations: number[];
  expectedResponseDisposals: number[];
  expectedStdout: number[];
  expectedStderr: number[];
}

const expectations = JSON.parse(readFileSync(new URL("./expectations.json", import.meta.url), "utf8")) as Expectations;

for (const fixture of expectations.cases) {
  test(fixture.id, { timeout: 7_000 }, async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const errors: string[] = [];
    const stdout: number[] = [];
    const stderr: number[] = [];
    const requests: { url: string; method: string; bytes: number[]; finalizedAtStart: number }[] = [];
    const authorizations: { url: string; method: string; redirectFrom: string | null }[] = [];
    const responseStates: { status: number; finalized: number; disposed: number; closed: boolean }[] = [];
    const responseClosers: (() => Promise<void>)[] = [];
    const activeUploads = new Set<AsyncIterator<Uint8Array>>();
    let stdinFinalizations = 0;
    let stdinYields = 0;
    let stdinEmptyYields = 0;
    let activeTransports = 0;
    let watchdogFired = false;
    const backing = fixture.kind === "Buffer"
      ? Buffer.alloc(expectations.backingLength, 165)
      : new Uint8Array(expectations.backingLength).fill(165);
    const view = backing.subarray(expectations.viewOffset, expectations.viewOffset + 4);
    const empty = backing.subarray(expectations.viewOffset, expectations.viewOffset);
    assert.ok(view.byteOffset > 0);
    assert.equal(Buffer.isBuffer(view), fixture.kind === "Buffer");
    const stdin = (async function* () {
      try {
        controller.signal.throwIfAborted();
        stdinYields++;
        stdinEmptyYields++;
        yield empty;
        for (const block of expectations.inputChunks) {
          controller.signal.throwIfAborted();
          backing.fill(165);
          view.set(block);
          events.push(`stdin-data-${stdinYields}`);
          stdinYields++;
          yield view;
          controller.signal.throwIfAborted();
          stdinYields++;
          stdinEmptyYields++;
          yield empty;
        }
      } finally {
        backing.fill(expectations.finalizerFill);
        await Promise.resolve();
        stdinFinalizations++;
        events.push("stdin-finalized");
      }
    })();
    const sink = (target: number[]): ByteSink => ({
      async write(chunk) {
        controller.signal.throwIfAborted();
        if (target.length + chunk.length > 1_024) throw new Error("Harness output limit exceeded");
        target.push(...Array.from(chunk));
      },
    });
    const transport = async (request: HttpRequest): Promise<HttpResponse> => {
      request.signal.throwIfAborted();
      assert.ok(request.body);
      assert.ok(requests.length < 2, "No additional request admitted");
      const requestIndex = requests.length;
      events.push(`transport-${requestIndex + 1}-start`);
      const captured = { url: request.url, method: request.method, bytes: [] as number[], finalizedAtStart: stdinFinalizations };
      requests.push(captured);
      const upload = request.body[Symbol.asyncIterator]();
      activeUploads.add(upload);
      activeTransports++;
      try {
        while (true) {
          request.signal.throwIfAborted();
          const item = await upload.next();
          if (item.done) break;
          if (captured.bytes.length + item.value.length > 256) throw new Error("Harness upload limit exceeded");
          captured.bytes.push(...Array.from(item.value));
          events.push(`transport-${requestIndex + 1}-snapshot`);
        }
      } finally {
        try { await upload.return?.(); }
        finally { activeUploads.delete(upload); activeTransports--; }
      }
      const state = { status: requestIndex === 0 ? 307 : 200, finalized: 0, disposed: 0, closed: false };
      responseStates.push(state);
      const body = (async function* () {
        try { yield new Uint8Array(0); }
        finally { state.finalized++; }
      })();
      let disposal: Promise<void> | undefined;
      const dispose = (): Promise<void> => {
        disposal ??= (async () => {
          state.disposed++;
          const returned = await body.return(undefined);
          state.closed = returned.done === true;
          events.push(`response-${requestIndex + 1}-disposed`);
        })();
        return disposal;
      };
      responseClosers.push(dispose);
      return {
        status: state.status,
        statusText: requestIndex === 0 ? "Temporary Redirect" : "OK",
        headers: requestIndex === 0 ? [["location", "/replay"]] : [],
        body,
        dispose,
      };
    };
    const registry = new CommandRegistry();
    registry.register(createCurlCommand({
      authorize(request) {
        request.signal.throwIfAborted();
        authorizations.push({ url: request.url, method: request.method, redirectFrom: request.redirectFrom ?? null });
        return expectations.expectedUrls.includes(request.url);
      },
      transport,
      limits: { maxUploadBytes: 256, maxBufferBytes: 1_024, maxDownloadBytes: 256, maxRedirects: 1, maxTimeMs: 2_000 },
    }));
    const command = registry.get("curl");
    assert.ok(command);
    const context: CommandContext = {
      command: "curl", args: expectations.args, stdin, stdinIsDefault: false,
      stdout: sink(stdout), stderr: sink(stderr), cwd: "/", env: {},
      fs: new MemoryFileSystem(), signal: controller.signal,
    };
    let result: CommandResult | undefined;
    let finalizedAtExecuteSettlement = -1;
    let disposalsAtExecuteSettlement: number[] = [];
    let activeTransportsAtExecuteSettlement = -1;
    let activeUploadsAtExecuteSettlement = -1;
    let pendingExecution: Promise<CommandResult> | undefined;
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      controller.abort(new Error("Direct curl test watchdog"));
    }, 3_000);
    try {
      pendingExecution = Promise.resolve(command.execute(context));
      result = await pendingExecution;
    } catch (error) {
      errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    } finally {
      finalizedAtExecuteSettlement = stdinFinalizations;
      disposalsAtExecuteSettlement = responseStates.map(response => response.disposed);
      activeTransportsAtExecuteSettlement = activeTransports;
      activeUploadsAtExecuteSettlement = activeUploads.size;
      clearTimeout(watchdog);
      controller.abort(new Error("Harness invocation finished"));
      if (pendingExecution) await pendingExecution.then(() => {}, () => {});
      const cleanup = await Promise.allSettled([
        stdin.return(undefined),
        ...Array.from(activeUploads, upload => upload.return?.()),
        ...responseClosers.map(close => close()),
      ]);
      for (const entry of cleanup) if (entry.status === "rejected") errors.push(`cleanup: ${String(entry.reason)}`);
      await setImmediate();
    }
    const observed = {
      id: fixture.id, profile: expectations.profile, kind: fixture.kind, byteOffset: view.byteOffset,
      expectedFirst: fixture.expectedFirst, expectedSecond: fixture.expectedSecond,
      exitCode: result?.exitCode ?? null, requests, authorizations, responseStates,
      stdinYields, stdinEmptyYields, stdinFinalizations, finalizedAtExecuteSettlement,
      disposalsAtExecuteSettlement, activeTransportsAtExecuteSettlement, activeUploadsAtExecuteSettlement,
      activeTransports, activeUploads: activeUploads.size, watchdogFired, errors, stdout, stderr, events,
      activeResourceTypesAfterCleanup: process.getActiveResourcesInfo(),
    };
    if (process.env.VIRTUAL_BASH_DIRECT_CURL_CAPTURE === "1") {
      console.log(`VIRTUAL_BASH_DIRECT_CURL_OBSERVATION ${Buffer.from(JSON.stringify(observed)).toString("base64")}`);
    }
    assert.equal(watchdogFired, false);
    assert.deepEqual(errors, []);
    assert.equal(result?.exitCode, expectations.expectedExitCode);
    assert.equal(stdinYields, expectations.expectedStdinYields);
    assert.equal(stdinEmptyYields, expectations.expectedStdinEmptyYields);
    assert.equal(stdinFinalizations, expectations.expectedStdinFinalizations);
    assert.equal(finalizedAtExecuteSettlement, 1);
    assert.deepEqual(disposalsAtExecuteSettlement, expectations.expectedResponseDisposals);
    assert.equal(activeTransportsAtExecuteSettlement, 0);
    assert.equal(activeUploadsAtExecuteSettlement, 0);
    assert.equal(activeTransports, 0);
    assert.equal(activeUploads.size, 0);
    assert.deepEqual(requests.map(request => request.method), expectations.expectedMethods);
    assert.deepEqual(requests.map(request => request.url), expectations.expectedUrls);
    assert.deepEqual(requests.map(request => request.finalizedAtStart), [0, 1]);
    assert.deepEqual(authorizations.map(request => request.url), expectations.expectedUrls);
    assert.deepEqual(authorizations.map(request => request.method), expectations.expectedMethods);
    assert.deepEqual(authorizations.map(request => request.redirectFrom), [null, expectations.expectedUrls[0]]);
    assert.deepEqual(responseStates.map(response => response.status), expectations.expectedResponseStatuses);
    assert.deepEqual(responseStates.map(response => response.disposed), expectations.expectedResponseDisposals);
    assert.deepEqual(responseStates.map(response => response.finalized), expectations.expectedResponseGeneratorFinalizations);
    assert.ok(responseStates.every(response => response.closed));
    assert.deepEqual(stdout, expectations.expectedStdout);
    assert.deepEqual(stderr, expectations.expectedStderr);
    assert.deepEqual(requests[0]?.bytes, fixture.expectedFirst, "First upload must snapshot the original binary chunks");
    assert.deepEqual(requests[1]?.bytes, fixture.expectedSecond, "307 replay must retain original stdin bytes after producer finalization");
  });
}
