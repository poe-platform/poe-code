import assert from "node:assert/strict";
import fs from "node:fs";
import { scenarios, defaults, requestBody, invariants } from "./cases.mjs";

const flush = async () => { for (let count = 0; count < 6; count++) await new Promise(resolve => setImmediate(resolve)); };
const modeValue = mode => mode === "NaN" ? NaN : mode === "Infinity" ? Infinity : mode === "string:1" ? "1" : mode === "null" ? null : mode;
const describe = error => ({ name: error?.name, code: error?.code, message: error?.message, stack: error?.stack });
export async function run(config) {
  const api = await import("virtual-bash");
  const leaf = await import("virtual-bash/fs/webdav");
  assert.equal(api.WebDavFileSystem, leaf.WebDavFileSystem);
  const selected = config.caseIds ? scenarios.filter(scenario => config.caseIds.includes(scenario.id)) : scenarios;
  assert.equal(selected.length, config.caseIds?.length ?? 102);
  const results = { layout: config.layout, kind: config.mutant ?? "candidate", qualification: "injected-mock-only", startedAt: new Date().toISOString(), cases: [], invariants };
  const unhandled = [];
  const listener = error => unhandled.push(describe(error));
  process.on("unhandledRejection", listener);
  let stopped = false;
  try {
    for (const scenario of selected) {
      if (stopped) { results.cases.push({ id: scenario.id, status: "blocked", reason: "prior resource/guard failure" }); continue; }
      const controller = new AbortController();
      const reason = Object.freeze({ code: "ENOENT", fixture: scenario.id });
      const errors = [];
      const requests = [];
      const responses = [];
      const deferred = [];
      const signals = [];
      const outcomes = [];
      const checkpoints = [];
      let guardFailure = false;
      let pendingCalls = 0;
      let generation = 0;
      const record = { id: scenario.id, group: scenario.group, requests, outcomes, checkpoints, errors };
      const verify = operation => { try { operation(); } catch (error) { errors.push(describe(error)); } };
      const responseFor = (expected, state) => {
        state.responses++;
        let terminal = expected.body === null && expected.delivery !== "pending-first-body-pull";
        let stream;
        if (!terminal) stream = new ReadableStream({
          pull(sink) {
            state.pulls++;
            if (expected.delivery === "pending-first-body-pull") { controller.abort(reason); return; }
            if (state.pulls === 1) sink.enqueue(new TextEncoder().encode(expected.body));
            else { terminal = true; sink.close(); }
          },
          cancel() { state.underlyingCancels++; terminal = true; },
        }, { highWaterMark: 0 });
        const response = new Response(stream ?? null, { status: expected.status, headers: expected.headers });
        if (expected.url) Object.defineProperty(response, "url", { value: expected.url });
        responses.push({ response, state, terminal: () => terminal });
        return response;
      };
      const fetch = async (url, init) => {
        const position = requests.length;
        const expected = scenario.requests[position];
        const headers = new Headers(init.headers);
        const state = { responses: 0, pulls: 0, underlyingCancels: 0, releasedLocks: true };
        const observed = { url, method: init.method, depth: headers.get("depth"), body: init.body,
          headers: Object.fromEntries(headers), redirect: init.redirect, credentials: init.credentials,
          signalPresent: init.signal instanceof AbortSignal, signalAbortedAtAdmission: init.signal?.aborted, resources: state, generation };
        requests.push(observed); signals.push(init.signal);
        if (!expected) throw new Error("UNEXPECTED_REQUEST_AFTER_FROZEN_TRACE");
        verify(() => {
          assert.equal(url, expected.url); assert.equal(init.method, expected.method); assert.equal(headers.get("depth"), expected.depth);
          assert.equal(init.redirect, "manual"); assert.equal(init.credentials, "omit"); assert.equal(headers.get("cache-control"), "no-cache");
          assert.ok(init.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false);
          assert.equal(headers.get("authorization"), (scenario.headers ?? defaults.headers).Authorization ?? null);
          if (init.method === "PROPFIND") { assert.equal(init.body, requestBody); assert.equal(headers.get("content-type"), "application/xml; charset=utf-8"); }
          else { assert.equal(init.body, undefined); assert.equal(headers.get("accept-encoding"), "identity"); }
          if (scenario.deadlineRelation && position % 2 === 1 && (scenario.deadlineRelation.startsWith("each") || position === 1)) {
            assert.equal(init.signal, signals[position - 1]);
            assert.equal(requests[position - 1].resources.underlyingCancels, 1);
          }
        });
        if (scenario.betweenRequests) generation++;
        const delivery = expected.response.delivery;
        if (delivery === "immediate-rejection") throw new Error("independent transport failure");
        if (delivery === "abort-then-reject") { controller.abort(reason); throw new Error("distinct transport error after abort"); }
        if (delivery === "deferred-response" || delivery === "deferred-rejection") {
          const promise = new Promise((resolve, reject) => deferred.push(() => delivery === "deferred-response"
            ? resolve(responseFor(expected.response, state)) : reject(new Error("independent late transport failure"))));
          if (scenario.abortAt === "after-fetch-admission") queueMicrotask(() => controller.abort(reason));
          return promise;
        }
        return responseFor(expected.response, state);
      };
      const provider = new api.WebDavFileSystem({ ...defaults, ...scenario.options, headers: scenario.headers ?? defaults.headers, fetch });
      const filesystem = scenario.wrapper === "readonly" ? new api.ReadOnlyFileSystem(provider) : provider;
      verify(() => { assert.equal(requests.length, 0); assert.equal(provider.capabilities.permissions, false); assert.equal(filesystem.capabilities.permissions, false); assert.equal("directoryNavigation" in provider.capabilities, false); });
      if (scenario.abortAt?.startsWith("public-")) {
        const phase = scenario.abortAt.includes("stat-") ? "stat" : "readdir";
        const original = provider[phase].bind(provider);
        provider[phase] = async (...args) => {
          const result = await original(...args);
          checkpoints.push(`${phase}-fulfilled`); controller.abort(reason); return result;
        };
      }
      for (const call of scenario.calls) {
        if (guardFailure) break;
        if (call.signal === "preaborted") controller.abort(reason);
        const options = ["active", "preaborted"].includes(call.signal) ? { signal: controller.signal } : {};
        let timer;
        pendingCalls++;
        const operation = Promise.resolve().then(() => call.method === "access"
          ? filesystem.access(call.path, modeValue(call.mode), options) : filesystem[call.method](call.path, options));
        operation.then(() => pendingCalls--, () => pendingCalls--);
        try {
          const value = await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("REVIEW_CALL_GUARD"), { guard: true })), 8000); })]);
          const outcome = call.method === "stat" ? value.type : "OK";
          outcomes.push({ outcome, expected: call.outcome });
          verify(() => { assert.equal(outcome, call.outcome); if (call.method === "access") assert.equal(value, undefined); });
        } catch (error) {
          if (error.guard) guardFailure = true;
          outcomes.push({ outcome: error.code ?? error.name, expected: call.outcome, error: describe(error), typed: error instanceof api.FsError,
            causeWasCallerReason: error.cause === reason, rawReasonThrown: error === reason });
          verify(() => { assert.ok(error instanceof api.FsError); assert.equal(error.code, call.outcome); assert.notEqual(error, reason); });
        } finally { clearTimeout(timer); }
        for (const release of deferred.splice(0)) release();
        await flush();
      }
      await flush();
      verify(() => assert.equal(requests.length, scenario.requests.length));
      for (let index = 0; index < requests.length; index++) {
        const response = responses.find(value => value.state === requests[index].resources);
        requests[index].resources.releasedLocks = !response?.response.body?.locked;
        if (scenario.requests[index]) verify(() => assert.deepEqual(requests[index].resources, scenario.requests[index].resources));
      }
      const leaked = responses.filter(value => !value.terminal() || value.response.body?.locked);
      const unsafe = guardFailure || leaked.length > 0 || pendingCalls !== 0 || deferred.length !== 0 || unhandled.length !== 0;
      record.resources = { guardFailure, leakedResponses: leaked.length, pendingCalls, deferredFetches: deferred.length, unhandled: [...unhandled], clean: !unsafe };
      if (unsafe) {
        controller.abort(reason);
        for (const release of deferred.splice(0)) release();
        for (const value of leaked) if (value.response.body && !value.response.body.locked) await value.response.body.cancel();
        await flush(); stopped = true;
      }
      record.status = unsafe ? "resource-failure" : errors.length ? "fail" : "pass";
      results.cases.push(record);
      console.log(JSON.stringify({ id: record.id, status: record.status, requests: requests.length, clean: record.resources.clean }));
      fs.writeFileSync(config.result, JSON.stringify(results));
    }
  } finally {
    process.removeListener("unhandledRejection", listener);
    results.finishedAt = new Date().toISOString();
    results.summary = Object.fromEntries(["pass", "fail", "blocked", "resource-failure"].map(status => [status, results.cases.filter(record => record.status === status).length]));
    fs.writeFileSync(config.result, JSON.stringify(results));
  }
  if (results.summary.fail || results.summary.blocked || results.summary["resource-failure"]) process.exitCode = 1;
}
