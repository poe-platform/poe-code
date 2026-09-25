import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import { intrinsicDataRoots } from "./intrinsic-data-roots.js";
import { DeferredFunction } from "./deferred-function.js";
import { scopeDataRoots } from "./scope-data-roots.js";
import { createSandboxClosure, measureSandboxData, type SandboxValue } from "./values.js";

function fixture(kind: "arguments" | "intrinsic" | "options" | "captures", fails: boolean) {
  const payload = { text: "payload" };
  const root = {};
  let append!: (value: SandboxValue) => void;
  const observer = createSandboxClosure({ call: () => undefined });
  const failure = new Error("collection failed");
  const captured = kind === "captures"
    ? [payload, ...Array.from({ length: 15 }, () => ({ text: "other" }))]
    : undefined;
  registerIndexedClosureCaptures(observer, callback => {
    append = callback;
    // These roots were already visited. Keep the oldest positive cache entry
    // weakly observed across both successful completion and provider failure.
    for (const value of captured ?? []) callback(value);
    if (fails) throw failure;
  });
  if (kind === "arguments")
    scopeDataRoots.set(root, { arguments: {
      read: () => undefined,
      capture: () => ({ units: 0, iterator: Symbol.iterator, references: [payload] })
    } });
  if (kind === "intrinsic") intrinsicDataRoots.set(root, { target: payload, values: [payload] });
  const options = { ignoreClosures: false };
  const reference = new WeakRef(kind === "options" ? options : payload);
  const roots = [...(captured ?? [root]), observer];
  if (fails) expect(() => measureSandboxData(roots, options)).toThrow(failure);
  else measureSandboxData(roots, options);
  return { append, reference };
}

async function collect() {
  for (let pass = 0; pass < 8; pass++) {
    await setImmediate();
    global.gc!();
  }
}

// Run with --pool=forks --execArgv=--expose-gc. The saved callback deliberately
// stays live across collection; it must not retain a completed walk's inputs.
it.skipIf(typeof global.gc !== "function").each([
  { kind: "arguments" as const, fails: false },
  { kind: "arguments" as const, fails: true },
  { kind: "intrinsic" as const, fails: false },
  { kind: "intrinsic" as const, fails: true },
  { kind: "options" as const, fails: false },
  { kind: "options" as const, fails: true },
  { kind: "captures" as const, fails: false },
  { kind: "captures" as const, fails: true }
])("releases $kind after measurement (fails=$fails)", async ({ kind, fails }) => {
  const { append, reference } = fixture(kind, fails);
  const control = {};
  const controlReference = new WeakRef(control);
  await collect();
  expect(controlReference.deref()).toBe(control);
  expect(reference.deref()).toBeUndefined();
  expect(() => append("late input")).not.toThrow();
  expect(measureSandboxData(["fresh"])).toBe(5);
});

function deliverLate(append: (value: SandboxValue) => void) {
  const payload = { text: "late payload" };
  append(payload);
  return new WeakRef(payload);
}

it.skipIf(typeof global.gc !== "function")("does not retain values sent through a completed callback", async () => {
  const { append } = fixture("arguments", false);
  const reference = deliverLate(append);
  await collect();
  expect(reference.deref()).toBeUndefined();
  expect(() => append("still callable")).not.toThrow();
});

function emptyDeferredClosure() {
  // Keep the returned call callback outside the initializer payload's lexical
  // scope, so only the pending collector can retain that payload.
  return createSandboxClosure({ call: () => undefined });
}

function resolvedDeferredFixture() {
  const payload = { text: "initializer capture" };
  const pending = new DeferredFunction(
    emptyDeferredClosure,
    append => append(payload)
  );
  return { closure: pending.resolve(), reference: new WeakRef(payload) };
}

it.skipIf(typeof global.gc !== "function")("releases initializer captures while a materialized function stays live", async () => {
  const { closure, reference } = resolvedDeferredFixture();
  await collect();
  expect(reference.deref()).toBeUndefined();
  expect(measureSandboxData([closure])).toBe(1);
});

function deferredReferences(resolved: boolean) {
  const pending = new DeferredFunction(
    () => createSandboxClosure({ call: () => undefined }),
    () => {}
  );
  const reference = new WeakRef(pending.root);
  const closure = resolved ? new WeakRef(pending.resolve()) : undefined;
  measureSandboxData([pending.root]);
  return { reference, closure };
}

it.skipIf(typeof global.gc !== "function").each([false, true])("releases deferred roots and function carriers (resolved=%s)", async resolved => {
  const { reference, closure } = deferredReferences(resolved);
  await collect();
  expect(reference.deref()).toBeUndefined();
  expect(closure?.deref()).toBeUndefined();
});
