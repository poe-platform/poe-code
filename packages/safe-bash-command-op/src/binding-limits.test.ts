import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import type { OpBackendRequest } from "./types.js";

const request: OpBackendRequest = { resource: "vault", action: "list", args: [], flags: {} };

for (const maxRequests of [undefined, Infinity]) {
  test(`binding preparation accepts more than 1024 planned requests with maxRequests=${maxRequests}`, async () => {
    const backend = createObjectBackend(maxRequests === undefined ? {} : { maxRequests });
    const context = { signal: new AbortController().signal };
    const requests = Array.from({ length: 1025 }, () => request);
    const prepared = await backend.prepareBinding(requests, context);
    assert.equal(prepared.metadata.length, requests.length);
    assert.equal(prepared.targets.length, requests.length);
    assert.deepEqual(await backend.execute(request, { ...context, binding: prepared.handle }), []);
    backend.cancelBinding(prepared.handle);
  });
}

test("binding request limits reject oversized plans and accept the exact boundary", async () => {
  const backend = createObjectBackend({ maxRequests: 2 });
  const context = { signal: new AbortController().signal };
  await assert.rejects(backend.prepareBinding([request, request, request], context), { message: "Binding plan exceeds maximum request count of 2" });
  const prepared = await backend.prepareBinding([request, request], context);
  assert.equal(prepared.metadata.length, 2);
  assert.deepEqual(await backend.execute(request, { ...context, binding: prepared.handle }), []);
  assert.deepEqual(await backend.execute(request, { ...context, binding: prepared.handle }), []);
  backend.cancelBinding(prepared.handle);
  const empty = await backend.prepareBinding([], context);
  backend.cancelBinding(empty.handle);
});

test("binding request limits validate configuration before use", () => {
  assert.doesNotThrow(() => createObjectBackend({ maxRequests: 1 }));
  for (const maxRequests of [0, -1, NaN, 1.5, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createObjectBackend({ maxRequests }), { name: "RangeError", message: "Invalid op limit: maxRequests" });
  }
});

test("backend snapshots preserve configured binding request limits", async () => {
  const backend = createObjectBackend({ maxRequests: 1 });
  const restored = createObjectBackend(backend.snapshot());
  await assert.rejects(restored.prepareBinding([request, request], { signal: new AbortController().signal }), { message: "Binding plan exceeds maximum request count of 1" });
});

for (const expiresAt of [undefined, Infinity]) {
  test(`binding deadlines are unlimited when expiresAt is ${expiresAt}`, async () => {
    let now = 100;
    const backend = createObjectBackend({ clock: { now: () => now } });
    const context = { signal: new AbortController().signal };
    const prepared = await backend.prepareBinding([request], { ...context, ...(expiresAt === undefined ? {} : { expiresAt }) });
    now += 86_400_000;
    backend.validateBinding(prepared.handle, context);
    assert.deepEqual(await backend.execute(request, { ...context, binding: prepared.handle }), []);
    backend.cancelBinding(prepared.handle);
  });
}

test("explicit finite binding deadlines still expire at the configured time", async () => {
  let now = 100;
  const backend = createObjectBackend({ clock: { now: () => now } });
  const context = { signal: new AbortController().signal };
  const prepared = await backend.prepareBinding([request], { ...context, expiresAt: 101 });
  backend.validateBinding(prepared.handle, context);
  now = 101;
  await assert.rejects(backend.execute(request, { ...context, binding: prepared.handle }), { message: "Binding is invalid or no longer current" });
});

test("binding preparation rejects invalid deadlines and nonfinite clocks", async () => {
  const context = { signal: new AbortController().signal };
  const backend = createObjectBackend({ clock: { now: () => 100 } });
  for (const expiresAt of [NaN, -Infinity, 99, 100]) {
    await assert.rejects(backend.prepareBinding([request], { ...context, expiresAt }), { message: "Invalid binding deadline" });
  }
  for (const now of [NaN, -Infinity, Infinity]) {
    await assert.rejects(createObjectBackend({ clock: { now: () => now } }).prepareBinding([request], context), { message: "Invalid binding deadline" });
  }
});
