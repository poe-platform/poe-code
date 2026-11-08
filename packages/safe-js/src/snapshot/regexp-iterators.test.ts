import { describe, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { createSandboxRegex, cloneSandboxValue, type SandboxObject } from "../interp/values.js";
import { isSandboxRegExpIterator, restoreSandboxRegExpIterator } from "../interp/regexp-iterator.js";
import { nextRegExpIterator } from "../interp/methods/regexp-iterator.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";

describe.each(["snapshot", "replay", "clone"] as const)("RegExp iterator %s", format => {
  it.each([false, true])("retains aliases and cursor, exhausted=%s", exhausted => {
    const iterator = restoreSandboxRegExpIterator({ matcher: createSandboxRegex("a", "g"), input: "aba", exhausted: false });
    expect(nextRegExpIterator(iterator).done).toBe(false);
    if (exhausted) {
      nextRegExpIterator(iterator);
      nextRegExpIterator(iterator);
    }
    const shared = { label: "iterator metadata" };
    Object.assign(iterator, { note: shared, [Symbol.toStringTag]: shared });
    const graph = { iterator, alias: iterator, shared };
    let copy: SandboxObject;
    if (format === "clone") copy = cloneSandboxValue(graph) as SandboxObject;
    else if (format === "replay") copy = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(graph)))) as SandboxObject;
    else {
      const source = "await task()";
      const snapshot = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { graph } }], callStack: [], pendingPromises: [], moduleBindings: {} });
      const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source, budget: new Budget() }).currentScope.lookup("graph");
      if (!binding.found) throw new Error("Missing graph");
      copy = binding.value as SandboxObject;
    }
    expect(isSandboxRegExpIterator(copy.iterator)).toBe(true);
    if (!isSandboxRegExpIterator(copy.iterator)) throw new Error("Lost iterator brand");
    expect(copy.alias).toBe(copy.iterator);
    expect((copy.iterator as unknown as SandboxObject).note).toBe(copy.shared);
    expect((copy.iterator as unknown as SandboxObject)[Symbol.toStringTag]).toBe(copy.shared);
    const result = nextRegExpIterator(copy.iterator);
    expect(result.done).toBe(exhausted);
    if (!exhausted) expect(result.value).toMatchObject({ 0: "a", index: 2, input: "aba" });
    expect(nextRegExpIterator(copy.iterator)).toEqual({ value: undefined, done: true });
    expect(nextRegExpIterator(iterator).done).toBe(exhausted);
  });
});

it("includes the live matcher in public dump data", () => {
  const iterator = restoreSandboxRegExpIterator({ matcher: createSandboxRegex("a", "g"), input: "aba", exhausted: false });
  nextRegExpIterator(iterator);
  const data = JSON.parse(serializeSafeJSSnapshot({ sourceHash: "iterator", bindings: { iterator } }));
  expect(data.heap?.[data.bindings.iterator.id]).toMatchObject({ kind: "regexp-iterator", exhausted: false, input: "aba", matcher: { kind: "regex", source: "a", flags: "g", lastIndex: 1 } });
});
