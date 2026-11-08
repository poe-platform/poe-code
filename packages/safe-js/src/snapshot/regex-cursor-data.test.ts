import { describe, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { createMiscGlobals } from "../interp/globals/misc.js";
import { cloneSandboxValue, createSandboxClosure, createSandboxRegex, deepCopyFromSandbox, measureSandboxData, type SandboxObject } from "../interp/values.js";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore as restoreExecution } from "../restore.js";
import { declareHostOperation } from "../interp/host-bridge.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

function roundTrip(graph: SandboxObject, format: "snapshot" | "replay" | "clone" | "host"): SandboxObject {
  if (format === "clone") return cloneSandboxValue(graph) as SandboxObject;
  if (format === "host") return deepCopyFromSandbox(graph) as SandboxObject;
  if (format === "replay") return decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(graph)))) as SandboxObject;
  const source = "await task()";
  const snapshot = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { graph } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source, budget: new Budget() }).currentScope.lookup("graph");
  if (!binding.found) throw new Error("Missing restored graph");
  return binding.value as SandboxObject;
}

describe.each(["snapshot", "replay", "clone", "host"] as const)("RegExp cursor %s graph", format => {
  it("preserves aliases and cursor cycles without sharing the original", () => {
    const regex = createSandboxRegex("a", "g");
    const cursor = { owner: regex, value: 2 };
    Reflect.set(regex, "lastIndex", cursor);
    const result = roundTrip({ regex, cursor, alias: regex }, format);
    expect(result.regex).not.toBe(regex);
    expect(result.alias).toBe(result.regex);
    expect(result.cursor).not.toBe(cursor);
    expect((result.regex as unknown as { lastIndex: unknown }).lastIndex).toBe(result.cursor);
    expect((result.cursor as SandboxObject).owner).toBe(result.regex);
  });

  it.each([undefined, null, "2", false, Number.NaN, Infinity, -Infinity, -0, 1.5, -1])("preserves cursor %s", cursor => {
    const regex = createSandboxRegex("a", "g");
    Reflect.set(regex, "lastIndex", cursor);
    const result = roundTrip({ regex, alias: regex }, format);
    expect(result.regex).not.toBe(regex);
    expect(result.alias).toBe(result.regex);
    expect(Object.is((result.regex as unknown as { lastIndex: unknown }).lastIndex, cursor)).toBe(true);
  });
});

describe("RegExp cursor boundaries", () => {
  it.each([false, true])("guards standalone clone compilation with unowned scope=%s", async unowned => {
    const budget = new Budget({ maxSteps: 1 });
    const globals = createMiscGlobals({ budget });
    const context = unowned ? { compilation: new CompileScope(), stack: [], thisValue: undefined } : undefined;
    expect(() => globals.structuredClone.call([createSandboxRegex("abc")], context)).toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "steps" }));
    expect(budget.currentDataSize).toBe(0);
    expect(() => budget.reset()).not.toThrow();
  });

  it("accounts for data reachable only through lastIndex", () => {
    const regex = createSandboxRegex("a");
    const cursor = { payload: "x".repeat(4000), owner: regex };
    Reflect.set(regex, "lastIndex", cursor);
    expect(measureSandboxData([regex])).toBeGreaterThan(4000);
  });

  it("does not leak a sandbox closure through a copied cursor", () => {
    const regex = createSandboxRegex("a");
    Reflect.set(regex, "lastIndex", { valueOf: createSandboxClosure({ call: () => 0 }) });
    expect(() => deepCopyFromSandbox(regex)).toThrow(TypeError);
  });

  it("requires explicit replay capabilities for callable cursor data", () => {
    const regex = createSandboxRegex("a");
    const callback = createSandboxClosure({ call: () => 2 });
    regex.lastIndex = { valueOf: callback };
    expect(() => encodeReplayData(regex)).toThrow(/capability/i);
    const encoded = encodeReplayData(regex, { identifyCapability: value => value === callback ? "cursor" : undefined });
    expect(() => decodeReplayData(encoded)).toThrow(/capability/i);
    const decoded = decodeReplayData(JSON.parse(JSON.stringify(encoded)), {
      resolveCapability: id => id === "cursor" ? callback : undefined
    }) as typeof regex;
    expect((decoded.lastIndex as SandboxObject).valueOf).toBe(callback);
  });

  it("rejects dangling replay cursor references", () => {
    expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
      { kind: "regex", source: "a", flags: "g", lastIndex: { tag: "ref", id: 99 } }
    ] })).toThrow();
  });

  it.each(["before", "inside"])("replays a pending effect %s cursor coercion without losing closure or aliases", async position => {
    const source = `const seen=[];const regex=/a/;const cursor={owner:regex,
      valueOf(){seen.push('cursor');${position === "inside" ? "pause();" : ""}return 2}};
      regex.lastIndex=cursor;${position === "before" ? "await pause();" : ""}
      const match=regex.exec('aba');return [match.index,regex.lastIndex===cursor,cursor.owner===regex,seen]`;
    const gate = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const execution = run(source, { bindings: { pause: declareHostOperation(() => {
      reached.resolve();
      return gate.promise;
    }, "re-issue") } });
    let saved: string;
    try {
      await reached.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      saved = await dump(execution, { mode: "replay" });
      const checkpoint = restoreExecution(JSON.parse(saved), { source });
      expect(checkpoint.hostCalls?.filter(call => call.lifecycle === "running")).toHaveLength(1);
    } finally {
      gate.resolve();
    }
    const original = await execution;
    expect(original).toMatchObject({ ok: true, returnValue: [0, true, true, ["cursor"]] });
    let calls = 0;
    const resumed = await run(source, { snapshot: restoreExecution(JSON.parse(saved!), { source }),
      bindings: { pause: declareHostOperation(async () => { calls++; }, "re-issue") } });
    expect(resumed).toMatchObject({ ok: true, returnValue: original.returnValue });
    expect(calls).toBe(1);
  });

  it("gives structuredClone its native fresh-regex and reset-cursor semantics", async () => {
    const source = "const regex=/a/g;const cursor={valueOf(){throw 'coerced'}};regex.lastIndex=cursor;const graph=structuredClone({regex,alias:regex});return [graph.regex!==regex,graph.regex===graph.alias,graph.regex.source,graph.regex.flags,graph.regex.lastIndex,regex.lastIndex===cursor]";
    const expected = new Function(source)();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
