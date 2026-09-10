import { expect, it } from "vitest";
import { run } from "../run.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { isSandboxClosure, isSandboxPromise } from "../interp/values.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["return ()=>1", "return ()=>2"],
  ["const value=1;return ()=>value", "const extra=0;const value=2;return ()=>value"],
  ["class C { value=1 };return ()=>new C().value", "class C { value=2 };return ()=>new C().value"],
  ["function* f(){yield 0;yield 1};const g=f();g.next();return ()=>g.next().value",
    "function* f(){yield 0;yield 2};const g=f();g.next();return ()=>g.next().value"],
  ["class C { #value=1;read(){return this.#value} };return ()=>new C().read()",
    "const extra=0;class C { #value=2;read(){return this.#value} };return ()=>new C().read()"],
  ["const c=Promise.withResolvers();const p=(async()=>{await c.promise;return 1})();return async()=>{c.resolve();return await p}",
    "const extra=0;const c=Promise.withResolvers();const p=(async()=>{await c.promise;return 2})();return async()=>{c.resolve();return await p}"],
  ["async function* f(){yield 0;yield 1};const g=f();await g.next();return async()=>(await g.next()).value",
    "const extra=0;async function* f(){yield 0;yield 2};const g=f();await g.next();return async()=>(await g.next()).value"],
  ["function* f(){try {yield 0}finally {yield 1}};const g=f();g.next();return ()=>g.next().value",
    "const extra=0;function* f(){try {yield 0}finally {yield 2}};const g=f();g.next();return ()=>g.next().value"]
])("preserves distinct function bodies and captured state from %s", async (source, otherSource) => {
  const a = await run(source), b = await run(otherSource);
  if (!a.ok || !b.ok) throw new Error("Missing original functions");
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { first: a.returnValue, second: b.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  let restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  restored = restore(JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: {
      first: restored.currentScope.lookup("first").value,
      second: restored.currentScope.lookup("second").value
    } }], callStack: [], pendingPromises: [], moduleBindings: {} }))), { source });
  for (const [name, expected] of [["first", 1], ["second", 2]] as const) {
    const closure = restored.currentScope.lookup(name).value;
    if (!isSandboxClosure(closure)) throw new Error("Missing restored function");
    const result = await invokeBuiltinClosure(closure, [], restored.budget, undefined, undefined);
    expect(isSandboxPromise(result) ? await result.promise : result).toBe(expected);
  }
});

it("preserves captured template arrays from different source texts", async () => {
  const source = 'function tag(strings){return strings}const value=tag`first`;return ()=>value[0]';
  const otherSource = 'function tag(strings){return strings}const value=tag`second`;return ()=>value[0]';
  const a = await run(source), b = await run(otherSource);
  if (!a.ok || !b.ok) throw new Error("Missing template closures");
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { first: a.returnValue, second: b.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  for (const name of ["first", "second"]) {
    const closure = restored.currentScope.lookup(name).value;
    if (!isSandboxClosure(closure)) throw new Error("Missing template reader");
    expect(await invokeBuiltinClosure(closure, [], restored.budget, undefined, undefined)).toBe(name);
  }
});

it("rejects parameters and invalid grammar in retained module sources", async () => {
  const source = "return ()=>1";
  const result = await run("return ()=>2");
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { value: result.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const entry = Object.entries(saved.heap!).find(([, node]) => node.kind === "guest-source" && node.functionKind === "module");
  if (entry === undefined) throw new Error("Missing module source");
  const parameters = JSON.parse(JSON.stringify(saved));
  parameters.heap[entry[0]].parameters = "argument";
  expect(() => restore(parameters, { source })).toThrow("Module sources cannot have parameters");
  const syntax = JSON.parse(JSON.stringify(saved));
  syntax.heap[entry[0]].body = "return (";
  expect(() => restore(syntax, { source })).toThrow();
});

it.each(["first", "second"])("reuses each restored template site with other source %s", async label => {
  const source = 'function tag(s){return s}function read(){return tag`first`}const original=read();return ()=>read()===original';
  const other = `function tag(s){return s}function read(){return tag\`${label}\`}const original=read();return ()=>read()===original`;
  const a = await run(source), b = await run(other);
  if (!a.ok || !b.ok) throw new Error("Missing original template readers");
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { first: a.returnValue, second: b.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const templates = Object.entries(saved.heap!).filter(([, node]) => node.kind === "guest-array" && node.templateNodeId !== undefined);
  expect(templates).toHaveLength(2);
  for (const realm of [0, -1, 1.5, "1", null]) {
    const invalid = JSON.parse(JSON.stringify(saved));
    invalid.heap[templates[0][0]].realm = realm;
    expect(() => restore(invalid, { source })).toThrow("Invalid template realm identity");
  }
  if (label === "first") {
    const duplicate = JSON.parse(JSON.stringify(saved));
    duplicate.heap[templates[1][0]].realm = duplicate.heap[templates[0][0]].realm;
    expect(() => restore(duplicate, { source })).toThrow("duplicate template source identity");
  }
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  for (const name of ["first", "second"]) {
    const closure = restored.currentScope.lookup(name).value;
    if (!isSandboxClosure(closure)) throw new Error("Missing template reader");
    expect(await invokeBuiltinClosure(closure, [], restored.budget, undefined, undefined), name).toBe(true);
  }
});
