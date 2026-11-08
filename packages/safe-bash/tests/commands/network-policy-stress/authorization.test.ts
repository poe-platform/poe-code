import assert from "node:assert/strict";
import { test } from "node:test";
import type { HttpRequest, NetworkAuthorization, NetworkCommandsOptions } from "../../../src/commands/network/index.js";
import { bounded, deferred, drain, response, start } from "./helpers.js";

const originalUrl = "http://allowed.invalid/path";

test("async policy request mutation cannot retarget the authorized transport", { timeout: 5000 }, async () => {
  const entered = deferred<NetworkAuthorization>();
  const decision = deferred<boolean>();
  const requests: HttpRequest[] = [];
  const execution = start([originalUrl], {
    authorize(request) { entered.resolve(request); return decision.promise; },
    transport: async request => { requests.push(request); return response(); },
  });
  try {
    const policy = await bounded(entered.promise, "authorizer entered");
    const originalSignal = policy.signal;
    await drain();
    assert.equal(requests.length, 0, "transport must not start while policy is pending");
    for (const [field, value] of Object.entries({ url: "http://denied.invalid/", method: "DELETE", attempt: 99,
      redirectFrom: "http://invented.invalid/", signal: new AbortController().signal })) {
      Reflect.set(policy, field, value);
    }
    decision.resolve(true);
    const result = await bounded(execution.done, "approved execution");
    assert.equal(result.exitCode, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, originalUrl);
    assert.equal(requests[0]!.method, "GET");
    assert.equal(requests[0]!.signal, originalSignal);
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
});

test("pending policy retains captured authorizer and transport for later URLs", { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const decision = deferred<boolean>();
  let transports = 0;
  let authorizations = 0;
  let replacements = 0;
  const options: NetworkCommandsOptions = {
    authorize() { authorizations++; entered.resolve(); return decision.promise; },
    transport: async () => { transports++; return response(); },
    limits: { maxTimeMs: 1000 },
  };
  const execution = start([originalUrl, "http://allowed.invalid/second"], options);
  try {
    await bounded(entered.promise, "authorizer entered");
    Reflect.set(options, "authorize", () => { replacements++; return true; });
    Reflect.set(options, "transport", async () => { replacements++; return response(); });
    decision.resolve(true);
    assert.equal((await bounded(execution.done, "captured options execution")).exitCode, 0);
    assert.equal(transports, 2);
    assert.equal(authorizations, 2);
    assert.equal(replacements, 0);
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
});

test("pending denial never invokes transport", { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const decision = deferred<boolean>();
  let transports = 0;
  const execution = start([originalUrl], {
    authorize() { entered.resolve(); return decision.promise; },
    transport: async () => { transports++; return response(); },
  });
  try {
    await bounded(entered.promise, "authorizer entered");
    await drain();
    assert.equal(transports, 0);
    decision.resolve(false);
    const result = await bounded(execution.done, "denied execution");
    assert.equal(result.exitCode, 7);
    assert.match(result.stderr, /denied by host policy/);
    assert.equal(transports, 0);
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
});

test("caller abort during pending policy wins over late approval", { timeout: 5000 }, async () => {
  const entered = deferred<NetworkAuthorization>();
  const decision = deferred<boolean>();
  let transports = 0;
  const reason = new Error("caller-policy-abort");
  const execution = start([originalUrl], {
    authorize(request) { entered.resolve(request); return decision.promise; },
    transport: async () => { transports++; return response(); },
  });
  try {
    const policy = await bounded(entered.promise, "authorizer entered");
    execution.controller.abort(reason);
    await assert.rejects(bounded(execution.done, "pending policy cancellation"), error => error === reason);
    assert.equal(policy.signal.aborted, true);
    assert.equal(policy.signal.reason, reason);
    decision.resolve(true);
    await drain();
    assert.equal(transports, 0);
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
});

test("host deadline aborts pending policy before any approval", { timeout: 5000 }, async () => {
  const entered = deferred<NetworkAuthorization>();
  const decision = deferred<boolean>();
  let transports = 0;
  const execution = start([originalUrl], {
    limits: { maxTimeMs: 50 },
    authorize(request) { entered.resolve(request); return decision.promise; },
    transport: async () => { transports++; return response(); },
  });
  try {
    const policy = await bounded(entered.promise, "authorizer entered before deadline");
    assert.equal(policy.signal.aborted, false);
    const result = await bounded(execution.done, "host deadline with unsettled policy");
    assert.equal(result.exitCode, 28);
    assert.match(result.stderr, /Operation timed out/);
    assert.equal(policy.signal.aborted, true);
    assert.equal(policy.signal.reason.exitCode, 28);
    decision.resolve(true);
    await drain();
    assert.equal(transports, 0);
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
});

test("approval settlement followed by same-turn abort cannot start transport", { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const decision = deferred<boolean>();
  let transports = 0;
  const reason = new Error("abort-after-policy-settlement");
  const execution = start([originalUrl], {
    authorize() { entered.resolve(); return decision.promise; },
    transport: async () => { transports++; return response(); },
  });
  try {
    await bounded(entered.promise, "authorizer entered");
    decision.resolve(true);
    execution.controller.abort(reason);
    await assert.rejects(bounded(execution.done, "same-turn cancellation"), error => error === reason);
    await drain();
    assert.equal(transports, 0);
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
});

test("policy rejection fails closed without disclosing callback error", { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const decision = deferred<boolean>();
  let transports = 0;
  const execution = start([originalUrl], {
    authorize() { entered.resolve(); return decision.promise; },
    transport: async () => { transports++; return response(); },
  });
  try {
    await bounded(entered.promise, "authorizer entered");
    decision.reject(new Error("private-policy-detail"));
    const result = await bounded(execution.done, "policy rejection");
    assert.equal(result.exitCode, 7);
    assert.match(result.stderr, /Network authorization failed/);
    assert.doesNotMatch(result.stderr, /private-policy-detail/);
    assert.equal(transports, 0);
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
});
