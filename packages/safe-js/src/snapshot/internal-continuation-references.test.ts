import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

const aggregate = "const c=Promise.withResolvers();const p=Promise.all([c.promise]);return ()=>{c.resolve(1);return p}";
const cleanup = "const c=Promise.withResolvers();async function f(){await using resource={[Symbol.asyncDispose](){return c.promise}}}const p=f();return ()=>{c.resolve();return p}";
const cases = [
  { kind: "promise-aggregate", source: aggregate, expected: [1] },
  { kind: "aggregate-entry", source: aggregate, expected: [1] },
  { kind: "async-function-driver", source: "const c=Promise.withResolvers();async function f(){await c.promise;return 1}const p=f();return ()=>{c.resolve();return p}", expected: 1 },
  { kind: "async-generator-driver", source: "const c=Promise.withResolvers();async function* f(){await c.promise;yield 1}const g=f();const p=g.next();return ()=>{c.resolve();return p}", expected: { value: 1, done: false } },
  { kind: "promise-adoption", source: "const c=Promise.withResolvers();const d=Promise.withResolvers();d.resolve(c.promise);return ()=>{c.resolve(1);return d.promise}", expected: 1 },
  { kind: "async-cleanup", source: cleanup, expected: undefined },
  { kind: "resource-scope", source: cleanup, expected: undefined }
];

it.each(cases.flatMap(entry => ["binding", "nested", "shared-reference"].map(location => ({ ...entry, location }))))(
  "rejects internal $kind through $location while preserving legitimate continuation links", async ({ kind, source, expected, location }) => {
    const first = await run(source);
    expect(first.ok).toBe(true);
    if (!isSandboxClosure(first.returnValue)) throw new Error("Missing retained continuation");
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "module", bindings: { read: first.returnValue } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const frame = Object.values(saved.heap ?? {}).find(node => node.kind === "scope-frame" && node.resourceState !== undefined);
    const resourceReference = frame?.kind === "scope-frame" ? frame.resourceState : undefined;
    const targetId = kind === "resource-scope" && resourceReference !== null && typeof resourceReference === "object" && resourceReference.kind === "ref"
      ? resourceReference.id : Object.entries(saved.heap ?? {}).find(([, node]) => node.kind === kind)?.[0];
    expect(targetId).toBeDefined();
    const budget = new Budget();
    const control = restore(JSON.parse(JSON.stringify(saved)), { source, budget }).currentScope.lookup("read").value;
    if (!isSandboxClosure(control)) throw new Error("Missing restored continuation");
    expect(await awaitSandboxValue(await invokeBuiltinClosure(control, [], budget, undefined, undefined), undefined, budget)).toEqual(expected);
    const forged = JSON.parse(JSON.stringify(saved));
    const reference = { kind: "ref", id: Number(targetId) };
    forged.scopeChain[0].bindings.leak = location === "binding" ? reference
      : location === "nested" ? [{ nested: reference }] : [reference, { nested: reference }];
    expect(() => restore(forged, { source })).toThrow("Internal continuation records cannot be guest data");
  }
);
