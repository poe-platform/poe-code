import assert from "node:assert/strict";
import test from "node:test";
import { getEnvironmentValue, setEnvironmentValue, shellValueByteLength, shellValueBytes, shellValueFromBytes } from "./value.js";

test("environment byte identity belongs to the binding and is invalidated by string writes", () => {
  const env: Record<string, string> = {};
  setEnvironmentValue(env, "A", shellValueFromBytes(Uint8Array.of(255)));
  setEnvironmentValue(env, "B", shellValueFromBytes(Uint8Array.of(254)));
  assert.equal(env.A, env.B);
  assert.deepEqual(shellValueBytes(getEnvironmentValue(env, "A")!), Uint8Array.of(255));
  assert.deepEqual(shellValueBytes(getEnvironmentValue(env, "B")!), Uint8Array.of(254));
  const copy = { ...env };
  assert.equal(getEnvironmentValue(copy, "A"), "�");
  env.A = env.A!;
  assert.equal(getEnvironmentValue(env, "A"), "�");
  delete env.B;
  assert.equal(getEnvironmentValue(env, "B"), undefined);
  setEnvironmentValue(env, "A", shellValueFromBytes(Uint8Array.of(128)));
  setEnvironmentValue(env, "A", "é");
  assert.equal(getEnvironmentValue(env, "A"), "é");
});

test("canonical string byte accounting works without a Node Buffer global", () => {
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined as unknown as typeof Buffer;
    for (const text of ["", "ascii", "é", "漢", "😀", "\ud800", "\udc00", "\ud800a", "\uFEFF"]) {
      assert.equal(shellValueByteLength(text), new TextEncoder().encode(text).byteLength);
    }
  } finally { globalThis.Buffer = saved; }
});
