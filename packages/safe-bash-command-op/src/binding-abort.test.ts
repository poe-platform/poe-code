import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { createManagedControlController } from "safe-bash-contracts/signals";
import { createObjectBackend } from "./backend.js";
import type { OpBackendRequest } from "./types.js";

const request: OpBackendRequest = { resource: "vault", action: "list", args: [], flags: {} };

test("completed bindings release their abort listener without cancelling post-execution validation", async () => {
  const backend = createObjectBackend();
  const signal = new AbortController().signal;
  const borrowed = () => {};
  signal.addEventListener("abort", borrowed);
  for (let run = 0; run < 15; run++) {
    const prepared = await backend.prepareBinding([request, request], { signal });
    assert.equal(getEventListeners(signal, "abort").length, 2);
    const context = { signal, binding: prepared.handle };
    await backend.execute(request, context);
    assert.equal(getEventListeners(signal, "abort").length, 2);
    await backend.execute(request, context);
    assert.deepEqual(getEventListeners(signal, "abort"), [borrowed]);
    backend.validateBinding(prepared.handle, context);
    await assert.rejects(backend.execute(request, context));
  }
});

test("empty binding plans retain no abort listener and still observe cancellation", async () => {
  const backend = createObjectBackend();
  const controller = new AbortController();
  const prepared = await backend.prepareBinding([], { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  backend.validateBinding(prepared.handle, { signal: controller.signal });
  controller.abort();
  assert.throws(() => backend.validateBinding(prepared.handle, { signal: new AbortController().signal }));
});

test("completed bindings still observe later cancellation of their preparation signal", async () => {
  const backend = createObjectBackend();
  const controller = new AbortController();
  const prepared = await backend.prepareBinding([request], { signal: controller.signal });
  const context = { signal: new AbortController().signal, binding: prepared.handle };
  await backend.execute(request, context);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  controller.abort();
  assert.throws(() => backend.validateBinding(prepared.handle, context));
});

test("active binding cancellation releases listeners and discards staged mutations", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Original" }] });
  const before = backend.snapshot();
  const controller = new AbortController();
  const edit: OpBackendRequest = { resource: "vault", action: "edit", args: ["vault"], flags: { name: "Changed" } };
  const prepared = await backend.prepareBinding([edit, request], { signal: controller.signal });
  const context = { signal: controller.signal, binding: prepared.handle };
  await backend.execute(edit, context);
  controller.abort();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(backend.execute(request, context));
  assert.deepEqual(backend.snapshot(), before);
});

for (const [kind, createSignal] of [
  ["native", () => new AbortController().signal],
  ["managed", () => createManagedControlController().signal],
] as const) {
  test(`bindings complete and cancel with a frozen ${kind} AbortSignal`, async () => {
    const backend = createObjectBackend();
    const signal = Object.freeze(createSignal());
    const prepared = await backend.prepareBinding([request], { signal });
    assert.deepEqual(await backend.execute(request, { signal, binding: prepared.handle }), []);
    backend.validateBinding(prepared.handle, { signal });
    backend.cancelBinding(prepared.handle);
    const pending = await backend.prepareBinding([request], { signal });
    backend.cancelBinding(pending.handle);
    assert.throws(() => backend.validateBinding(pending.handle, { signal }));
  });

  test(`binding cleanup tolerates a ${kind} AbortSignal frozen after preparation`, async () => {
    const backend = createObjectBackend();
    const signal = createSignal();
    const prepared = await backend.prepareBinding([request], { signal });
    Object.freeze(signal);
    assert.deepEqual(await backend.execute(request, { signal, binding: prepared.handle }), []);
    backend.cancelBinding(prepared.handle);
  });
}
