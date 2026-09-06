import { describe, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { cloneSandboxValue, type SandboxObject } from "../interp/values.js";
import { isSandboxRegExpIterator, regexpIteratorState, restoreSandboxRegExpIterator, type RegExpIteratorState } from "../interp/regexp-iterator.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

describe.each(["snapshot", "replay", "clone"] as const)("RegExp captured modes through %s", format => {
  it.each([false, true])("preserves general matcher identity and global=%s", global => {
    const matcher = { lastIndex: 4 };
    const iterator = restoreSandboxRegExpIterator({ matcher, input: "abc", exhausted: false, global, unicode: !global });
    const graph = { iterator, matcher };
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
    const state = regexpIteratorState(copy.iterator);
    expect(state.matcher).toBe(copy.matcher);
    expect(state).toMatchObject({ global, unicode: !global, input: "abc", exhausted: false });
  });
});

it.each([
  { global: true }, { unicode: false }, { global: "g", unicode: true },
  { global: true, unicode: null }
])("rejects malformed captured modes %j", modes => {
  expect(() => restoreSandboxRegExpIterator({ matcher: {}, input: "a", exhausted: false, ...modes } as RegExpIteratorState)).toThrow("modes");
});

it.each(["global", "unicode"])("rejects malformed persisted %s", key => {
  const iterator = restoreSandboxRegExpIterator({ matcher: {}, input: "a", exhausted: false, global: true, unicode: false });
  const replay = JSON.parse(JSON.stringify(encodeReplayData(iterator)));
  const node = replay.nodes.find((entry: { kind: string }) => entry.kind === "regexp-iterator");
  node[key] = "invalid";
  expect(() => decodeReplayData(replay)).toThrow("modes");
  const source = "await task()";
  const snapshot = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { iterator } }], callStack: [], pendingPromises: [], moduleBindings: {} })));
  const entry = Object.values(snapshot.heap).find(value => (value as { kind: string }).kind === "regexp-iterator") as Record<string, unknown>;
  entry[key] = "invalid";
  expect(() => restore(snapshot, { source, budget: new Budget() })).toThrow("modes");
});
