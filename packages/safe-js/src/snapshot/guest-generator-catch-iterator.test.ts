import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { interpret } from "../interp/interpreter.js";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxPromise,
} from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";

const bodies = [
  "try{throw new Set([1,2])}catch([a,b]){yield a;return b}",
  "let closed=0;function* input(){try{yield 1;yield 2}finally{closed++}}try{throw input()}catch([a]){yield [a,closed];return closed}",
  "try{throw [1,undefined]}catch([a,b=yield 3]){return [a,b]}",
  "try{throw new Set([1,undefined])}catch([a,b=yield 3]){return [a,b]}",
  "let calls=0;try{calls++;throw {a:1}}catch({a,b=yield 3}){return [a,b,calls]}",
  "try{throw {a:1}}catch({a,[yield 3]:b}){return [a,b]}",
  "let calls=0;try{calls++;throw new Set([undefined,2])}catch([a=yield 3,...rest]){return [a,rest,calls]}",
  "try{throw new Set([1,2])}catch([a]){try{throw [3]}catch([b,c=yield 4]){return [a,b,c]}}",
  "try{throw []}catch([a=yield 1,b=yield 2]){yield [a,b];return [a,b]}",
  "try{throw {}}catch({a=yield 1,b=yield 2}){yield [a,b];return [a,b]}",
  "let read;try{throw [1]}catch([a,b=(read=()=>a,yield 2)]){yield read();return [read(),b]}",
];

it("restores an async function awaiting in its catch parameter", async () => {
  const source =
    "let calls=0;async function f(){try{calls++;throw new Set([1,undefined])}catch([a,b=await wait()]){return [a,b,calls]}}return await f()";
  let release!: (value: number) => void;
  const waiting = new Promise<number>((resolve) => {
    release = resolve;
  });
  const original = run(source, {
    bindings: {
      wait: createSandboxClosure({
        async: true,
        call: () => createSandboxPromise(waiting),
      }),
    },
  });
  let wire: ReturnType<typeof JSON.parse>;
  try {
    wire = JSON.parse(await dump(original));
  } finally {
    release(9);
    await original;
  }
  expect(await original).toMatchObject({ ok: true, returnValue: [1, 9, 1] });
  const resumed = await run(source, {
    snapshot: restoreDump(wire, { source }),
    bindings: {
      wait: createSandboxClosure({
        async: true,
        call: () => createSandboxPromise(Promise.resolve(9)),
      }),
    },
  });
  expect(resumed).toMatchObject({ ok: true, returnValue: [1, 9, 1] });
});
it.each(
  bodies.flatMap((body) => [false, true].map((async) => ({ body, async }))),
)(
  "restores catch binding and body: $body async=$async",
  async ({ body, async }) => {
    const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const budget = new Budget();
    const original = await interpret(ast.body[0], {
      budget,
      bindings: createBuiltinBindings({ budget }),
    });
    if (!original.ok) throw new Error(original.error.message);
    const native = await runInNewContext(`(async()=>${source})()`);
    let iterator = original.returnValue;
    for (const sent of [9, 10, 11, 12]) {
      const wire = serialize({
        source,
        currentAstNodeId: ast.body[0].nodeId!,
        scopeChain: [{ id: "external", bindings: { iterator } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {},
      });
      const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
      const binding = restored.currentScope.lookup("iterator");
      if (!binding.found) throw new Error("Missing iterator");
      iterator = binding.value;
      const next = await interpret(
        parseModule(`{return iterator.next(${sent})}`).body[0],
        {
          budget: restored.budget,
          bindings: { iterator: binding.value },
        },
      );
      if (!next.ok) throw new Error(next.error.message);
      const actual = isSandboxPromise(next.returnValue)
        ? await next.returnValue.promise
        : next.returnValue;
      expect(actual).toEqual(await native.next(sent));
    }
  },
);

it.each([
  "valid",
  "missing-scope",
  "unrelated-scope",
  "missing-source",
  "unrelated-source",
])("validates catch continuation ownership: %s", async (corruption) => {
  const source =
    "function* values(){try{throw [1]}catch([a,b=yield 3]){return [a,b]}}const iterator=values();iterator.next();return 0";
  const pending = run(source);
  await pending;
  const wire = JSON.parse(await dump(pending));
  const generator = wire.heap[wire.bindings.iterator.id];
  const entry = Object.entries(
    generator.expressionStates as Record<string, { kind: string }>,
  ).find(([, value]) => value.kind === "pattern-source");
  if (entry === undefined) throw new Error("Missing catch source");
  const [id, value] = entry;
  expect(generator.blockScopes[id]).toBeDefined();
  if (corruption === "missing-scope") delete generator.blockScopes[id];
  if (corruption === "unrelated-scope") {
    generator.blockScopes["999999"] = generator.blockScopes[id];
    delete generator.blockScopes[id];
  }
  if (corruption === "missing-source") delete generator.expressionStates[id];
  if (corruption === "unrelated-source") {
    generator.expressionStates["999999"] = value;
    delete generator.expressionStates[id];
  }
  if (corruption === "valid")
    expect(() => restoreDump(wire, { source })).not.toThrow();
  else expect(() => restoreDump(wire, { source })).toThrow();
});
