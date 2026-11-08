import assert from "node:assert/strict";
import { test } from "node:test";
import { createOp, createObjectBackend, type OpBackend, type OpBackendContext, type OpBindingHandle } from "./index.js";

function fixture() {
  return createObjectBackend({
    vaults: [{ id: "vault", name: "Private" }],
    items: [{ id: "item", title: "Login", vault: "vault", fields: [{ id: "password", value: "synthetic-secret-value" }] }],
  });
}

for (const failure of ["rejected-prepare", "synchronous-prepare", "malformed-metadata"] as const) {
  test(`independent resolved ${failure} errors do not disclose adapter secrets before approval`, async () => {
    const object = fixture();
    const marker = "synthetic-private-adapter-token";
    let approvals = 0;
    let resolutionGrants = 0;
    let preparations = 0;
    let metadataReads = 0;
    let executions = 0;
    let output = "";
    let errors = "";
    const backend: OpBackend = {
      ...object,
      prepareBinding(requests, context) {
        preparations++;
        if (failure === "synchronous-prepare") throw new Error(marker);
        if (failure === "rejected-prepare") return Promise.reject(new Error(marker));
        return object.prepareBinding(requests, context).then(prepared => Object.defineProperty({ ...prepared }, "metadata", { get() { metadataReads++; throw new Error(marker); } }));
      },
      async execute(request, context) { executions++; return object.execute(request, context); },
    };
    const command = createOp({ backend, authorize: () => "ask", authorizeResolution() { resolutionGrants++; return true; }, approveResolved() { approvals++; return true; } });
    const result = await command.execute({
      args: ["read", "op://Private/Login/password"], env: {}, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { output += Buffer.from(bytes); } },
      stderr: { async write(bytes) { errors += Buffer.from(bytes); } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(resolutionGrants, 1);
    assert.equal(preparations, 1);
    assert.equal(metadataReads, failure === "malformed-metadata" ? 1 : 0);
    assert.equal(approvals, 0);
    assert.equal(executions, 0);
    assert.equal(output, "");
    assert.equal(errors.includes(marker), false, errors);
  });
}

for (const contextMode of ["exact", "omitted-authentication"] as const) {
test(`independent synchronous binding handoff validates ${contextMode} context before later invalidation`, async () => {
  const object = fixture();
  let handle: OpBindingHandle | undefined;
  let validationContext: OpBackendContext | undefined;
  let validations = 0;
  let staleHandoffs = 0;
  let outputCalls = 0;
  let invalidated = false;
  const events: string[] = [];
  const signal = new AbortController().signal;
  const backend: OpBackend = {
    ...object,
    async prepareBinding(requests, context) {
      const prepared = await object.prepareBinding(requests, context);
      handle = prepared.handle;
      return prepared;
    },
    validateBinding(binding, context) {
      object.validateBinding(binding, context);
      validationContext = context;
      validations++;
      events.push(`validate:${validations}`);
      if (validations === 2) queueMicrotask(() => {
        invalidated = true;
        events.push("invalidate");
        object.cancelBinding(binding);
      });
    },
  };
  const command = createOp({ backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: () => true });
  const result = await command.execute({
    args: ["read", "op://Private/Login/password"], env: {}, signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {
      outputCalls++;
      events.push("handoff");
      assert.ok(validationContext);
      assert.notEqual(validationContext.authentication, undefined);
      const context = contextMode === "exact" ? validationContext : { signal };
      try { object.validateBinding(handle!, context); }
      catch { staleHandoffs++; }
    } },
    stderr: { async write() {} },
  });
  assert.ok(validations >= 2, JSON.stringify(events));
  assert.deepEqual(result, { exitCode: 0 });
  assert.equal(outputCalls, 1);
  assert.equal(invalidated, true);
  assert.ok(events.indexOf("handoff") < events.indexOf("invalidate"), JSON.stringify(events));
  assert.equal(staleHandoffs, contextMode === "exact" ? 0 : 1, JSON.stringify({ result, outputCalls, events }));
});
}
