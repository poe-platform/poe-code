import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import type { OpBackendRequest } from "./types.js";

const request: OpBackendRequest = { resource: "vault", action: "list", args: [], flags: {} };

test("binding preparation accepts more than 1024 planned requests", async () => {
  const backend = createObjectBackend();
  const context = { signal: new AbortController().signal };
  const requests = Array.from({ length: 1025 }, () => request);
  const prepared = await backend.prepareBinding(requests, context);
  assert.equal(prepared.metadata.length, requests.length);
  assert.equal(prepared.targets.length, requests.length);
  assert.deepEqual(await backend.execute(request, { ...context, binding: prepared.handle }), []);
  backend.cancelBinding(prepared.handle);
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
