import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { serialize } from "../snapshot/serialize.js";
import { restore as restoreRuntime } from "../snapshot/restore.js";
import { Budget } from "./budget.js";
import { createCoercionContext } from "./interpreter.js";
import { isSandboxClosure, isSandboxPromise, type SandboxValue } from "./values.js";

it.each([
  `async function read(){return Child.resolve(42)} return await read();`,
  `return await {then(resolve){resolve(Child.resolve(42))}};`
])("assimilates Promise subclasses across async boundaries: %s", async body => {
  const result = await run(`class Child extends Promise {}; ${body}`);
  expect(result.returnValue).toBe(42);
});

it("preserves the construction target during awaited thenable assimilation", async () => {
  const result = await run(`const created=[];
    class Child extends Promise { constructor(executor){super(executor);created.push(this)} }
    const answer=await {then(resolve){resolve(Child.resolve(42))}};
    return answer===42 && created.length>1 && created.every(value=>value instanceof Child);`);
  expect(result.returnValue).toBe(true);
});

it.each([
  `async function* read(){yield {then(resolve){resolve(Child.resolve(42))}}}
    return (await read().next()).value;`,
  `async function* read(){return {then(resolve){resolve(Child.resolve(42))}}}
    return (await read().next()).value;`,
  `const input=[{then(resolve){resolve(Child.resolve(42))}}];
    for await(const value of input) return value;`
])("assimilates subclass values in async iteration: %s", async body => {
  expect((await run(`class Child extends Promise {}; ${body}`)).returnValue).toBe(42);
});

it.each(["pending", "completed"])("preserves subclass async returns across %s replay", async mode => {
  const source = `class Child extends Promise {};
    async function read(){await 0;return Child.resolve(42)} return await read();`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: 42 });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: 42 });
  } finally { await completed; }
});

it.each(["start", "done"])("assimilates async generator return arguments in %s state", async state => {
  expect((await run(`class Child extends Promise {}; async function* read(){}
    const iterator=read(); ${state === "done" ? "await iterator.next();" : ""}
    return (await iterator.return({then(resolve){resolve(Child.resolve(42))}})).value;`)).returnValue).toBe(42);
});

it("assimilates subclass returns from a restored async closure graph", async () => {
  const source = `class Child extends Promise {}; async function read(){return Child.resolve(42)}`;
  const evaluated = await run(source);
  const bindings = evaluated.snapshot.bindings as Record<string, SandboxValue>;
  const encoded = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { read: bindings.read } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const budget = new Budget();
  const restored = restoreRuntime(JSON.parse(JSON.stringify(encoded)), { source, budget });
  const binding = restored.currentScope.lookup("read");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored closure");
  const context = createCoercionContext({ budget, scope: restored.currentScope,
    callStack: [], activeLoopIterations: new Map(), restoredLoopIterations: new Map(),
    stats: { currentDataSize: 0, nodeVisits: 0, peakDataSize: 0 } });
  const result = binding.value.call([], context);
  if (!isSandboxPromise(result)) throw new Error("Restored closure did not return a promise");
  expect(await result.promise).toBe(42);
});
