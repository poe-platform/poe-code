import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import { intrinsicDataRoots } from "./intrinsic-data-roots.js";
import { scopeDataRoots } from "./scope-data-roots.js";
import { createSandboxClosure, measureSandboxData, type SandboxValue } from "./values.js";

function fixture(kind: "arguments" | "intrinsic" | "options", fails: boolean) {
  const payload = { text: "payload" };
  const root = {};
  let append!: (value: SandboxValue) => void;
  const observer = createSandboxClosure({ call: () => undefined });
  const failure = new Error("collection failed");
  registerIndexedClosureCaptures(observer, callback => {
    append = callback;
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
  if (fails) expect(() => measureSandboxData([root, observer], options)).toThrow(failure);
  else measureSandboxData([root, observer], options);
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
  { kind: "options" as const, fails: true }
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
