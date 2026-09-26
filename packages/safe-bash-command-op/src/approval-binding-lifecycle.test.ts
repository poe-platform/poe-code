import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend, createOp, type OpBackendRequest, type OpCommandOptions } from "./index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture() {
  const backend = createObjectBackend({
    vaults: [{ id: "vault", name: "Private" }],
    items: [{ id: "item", title: "Target", vault: "vault", fields: [{ id: "password", value: "synthetic-private-value" }] }],
  });
  const calls: string[] = [];
  const execute = backend.execute;
  backend.execute = async (request, context) => {
    calls.push("execute");
    return execute(request, context);
  };
  return { backend, calls };
}

function start(options: OpCommandOptions, controller = new AbortController(), args = ["item", "get", "Target", "--format", "json"], env: Record<string, string> = {}) {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const spawned: string[] = [];
  const execution = createOp(options).execute({
    args, env, signal: controller.signal,
    stdin: (async function* () {})(),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
    async invoke(command) { spawned.push(command); return { exitCode: 0 }; },
  });
  return { execution, output, errors, spawned };
}

function assertPublicManifest(value: unknown) {
  assert.ok(value !== null && typeof value === "object");
  const allowed = ["operation", "backendId", "accountId", "targets", "optionNames", "mutation", "output", "child"];
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `Unexpected public manifest property: ${key}`);
  for (const key of allowed.filter(key => key !== "child")) assert.ok(Object.hasOwn(value, key), `Missing public manifest property: ${key}`);
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    assert.ok(Object.isFrozen(current));
    assert.equal(Object.getOwnPropertySymbols(current).length, 0);
    for (const [key, child] of Object.entries(current)) {
      assert.equal(["binding", "handle", "request", "input", "flags"].includes(key), false, `Private property in public manifest: ${key}`);
      assert.notEqual(typeof child, "function");
      pending.push(child);
    }
  }
}

for (const decision of ["allow", "deny"] as const) {
  test(`direct ${decision} does not enter metadata discovery or either approval callback`, async () => {
    const { backend, calls } = fixture();
    const operation = start(Object.assign({
      backend, authorize: () => decision,
      approve() { calls.push("literal"); return true; },
    }, {
      authorizeResolution() { calls.push("discovery"); return true; },
      approveResolved() { calls.push("resolved"); return true; },
    }));
    assert.equal((await operation.execution).exitCode, decision === "allow" ? 0 : 1);
    assert.deepEqual(calls, decision === "allow" ? ["execute"] : []);
  });
}

test("explicit literal ask retains legacy approval without discovery", async () => {
  const { backend, calls } = fixture();
  const operation = start(Object.assign({
    backend, authorize: () => "ask" as const,
    approve() { calls.push("literal"); return true; },
  }, {
    approvalMode: "literal" as const,
    authorizeResolution() { calls.push("discovery"); return true; },
    approveResolved() { calls.push("resolved"); return true; },
  }));
  assert.equal((await operation.execution).exitCode, 0);
  assert.deepEqual(calls, ["literal", "execute"]);
});

for (const missing of ["resolution callback", "resolved callback", "backend capabilities", "resolution permission"] as const) {
  test(`default ask fails closed without ${missing} and never falls back to literal approval`, async () => {
    const { backend, calls } = fixture();
    const before = backend.snapshot();
    const options = Object.assign({
      backend: missing === "backend capabilities" ? { execute: backend.execute } : backend,
      authorize: () => "ask" as const,
      approve() { calls.push("literal"); return true; },
    }, missing === "resolution callback" ? {} : {
      authorizeResolution() { calls.push("discovery"); return missing !== "resolution permission"; },
    }, missing === "resolved callback" ? {} : {
      approveResolved() { calls.push("resolved"); return true; },
    });
    const operation = start(options);
    assert.equal((await operation.execution).exitCode, 1);
    assert.equal(calls.includes("literal"), false);
    assert.equal(calls.includes("resolved"), false);
    assert.equal(calls.includes("execute"), false);
    assert.equal(operation.output.length, 0);
    assert.deepEqual(backend.snapshot(), before);
  });
}

test("resolved denial follows explicit metadata permission without executing or exposing field values", async () => {
  const { backend, calls } = fixture();
  const before = backend.snapshot();
  let observed: unknown;
  const operation = start(Object.assign({ backend, authorize: () => "ask" as const }, {
    authorizeResolution() { calls.push("discovery"); return true; },
    approveResolved(manifest: unknown) {
      calls.push("resolved");
      observed = manifest;
      return false;
    },
  }));
  assert.equal((await operation.execution).exitCode, 1);
  assertPublicManifest(observed);
  assert.equal(JSON.stringify(observed).includes("synthetic-private-value"), false);
  assert.deepEqual(calls, ["discovery", "resolved"]);
  assert.equal(operation.output.length, 0);
  assert.deepEqual(backend.snapshot(), before);
});

test("resolved run manifest exposes no handle or raw argv and keeps all argument positions redacted", async () => {
  const { backend, calls } = fixture();
  let observed: unknown;
  let observedContext: unknown;
  const operation = start(Object.assign({ backend, authorize: () => "ask" as const }, {
    authorizeResolution: () => true,
    approveResolved(manifest: unknown, context: unknown) {
      observed = manifest;
      observedContext = context;
      return false;
    },
  }), new AbortController(), ["run", "--", "worker", "--token=synthetic-argv-token", "synthetic-positional"], { PRIVATE: "synthetic-env-value", REFERENCE: "op://vault/item/password" });
  assert.equal((await operation.execution).exitCode, 1);
  assertPublicManifest(observed);
  assert.ok(observedContext !== null && typeof observedContext === "object");
  assert.equal(Object.hasOwn(observedContext, "binding") || Object.hasOwn(observedContext, "handle"), false);
  const text = JSON.stringify(observed);
  for (const secret of ["synthetic-argv-token", "synthetic-positional", "synthetic-env-value", "synthetic-private-value"]) assert.equal(text.includes(secret), false);
  const child = (observed as { child: { executable: string; argv: string[]; environmentNames: string[] } }).child;
  assert.equal(child.executable, "worker");
  assert.deepEqual(child.argv, ["[redacted]", "[redacted]"]);
  assert.deepEqual([...child.environmentNames].sort(), ["PRIVATE", "REFERENCE"]);
  assert.deepEqual(calls, []);
  assert.equal(operation.output.length, 0);
  assert.deepEqual(operation.spawned, []);
});

for (const pending of ["discovery", "resolved"] as const) {
  test(`abort during ${pending} permission settles and late approval cannot execute`, async () => {
    const { backend, calls } = fixture();
    const before = backend.snapshot();
    const entered = deferred<void>();
    const permission = deferred<boolean>();
    const controller = new AbortController();
    const operation = start(Object.assign({ backend, authorize: () => "ask" as const }, {
      authorizeResolution() {
        calls.push("discovery");
        if (pending !== "discovery") return true;
        entered.resolve();
        return permission.promise;
      },
      approveResolved() {
        calls.push("resolved");
        entered.resolve();
        return permission.promise;
      },
    }), controller);
    try {
      await Promise.race([
        entered.promise,
        operation.execution.then(result => { throw new Error(`Command settled before ${pending} entry: ${result.exitCode}`); }),
      ]);
      controller.abort();
      assert.equal((await operation.execution).exitCode, 130);
    } finally {
      controller.abort();
      permission.resolve(true);
      await operation.execution;
    }
    assert.equal(calls.includes("execute"), false);
    assert.equal(operation.output.length, 0);
    assert.deepEqual(backend.snapshot(), before);
  });
}

test("preparation is metadata-only and cloned or foreign handles cannot authorize a read", async () => {
  const { backend, calls } = fixture();
  const foreign = fixture().backend;
  const context = { signal: new AbortController().signal };
  const request: OpBackendRequest = { resource: "item", action: "get", args: ["Target"], flags: {} };
  const before = backend.snapshot();
  const prepared = await backend.prepareBinding([request], context);
  assert.deepEqual(calls, []);
  assert.deepEqual(backend.snapshot(), before);
  assert.equal(JSON.stringify(prepared.targets).includes("synthetic-private-value"), false);
  const cloned = structuredClone(prepared.handle);
  await assert.rejects(async () => backend.validateBinding(cloned, context));
  await assert.rejects(async () => foreign.validateBinding(prepared.handle, context));
  await assert.rejects(backend.execute(request, { ...context, binding: cloned }));
  assert.deepEqual(backend.snapshot(), before);
  backend.cancelBinding(prepared.handle);
});

test("cancelled binding cannot be validated or replayed to execute a read", async () => {
  const { backend } = fixture();
  const context = { signal: new AbortController().signal };
  const request: OpBackendRequest = { resource: "item", action: "get", args: ["Target"], flags: {} };
  const prepared = await backend.prepareBinding([request], context);
  const before = backend.snapshot();
  backend.cancelBinding(prepared.handle);
  await assert.rejects(async () => backend.validateBinding(prepared.handle, context));
  await assert.rejects(backend.execute(request, { ...context, binding: prepared.handle }));
  assert.deepEqual(backend.snapshot(), before);
});

test("binding cannot execute an unprepared nested request", async () => {
  const { backend } = fixture();
  const context = { signal: new AbortController().signal };
  const request: OpBackendRequest = { resource: "item", action: "get", args: ["Target"], flags: {} };
  const prepared = await backend.prepareBinding([request], context);
  const before = backend.snapshot();
  await assert.rejects(backend.execute({ resource: "secret", action: "read", args: ["op://vault/item/password"], flags: {} }, { ...context, binding: prepared.handle }));
  assert.deepEqual(backend.snapshot(), before);
  backend.cancelBinding(prepared.handle);
});

test("same-ID content update invalidates a prepared generation without undoing the other actor", async () => {
  const { backend } = fixture();
  const context = { signal: new AbortController().signal };
  const request: OpBackendRequest = { resource: "item", action: "get", args: ["Target"], flags: {} };
  const prepared = await backend.prepareBinding([request], context);
  await backend.execute({ resource: "item", action: "edit", args: ["item", "password=synthetic-changed"], flags: {} }, context);
  const afterOtherActor = backend.snapshot();
  await assert.rejects(async () => backend.validateBinding(prepared.handle, context));
  await assert.rejects(backend.execute(request, { ...context, binding: prepared.handle }));
  assert.deepEqual(backend.snapshot(), afterOtherActor);
  backend.cancelBinding(prepared.handle);
});
