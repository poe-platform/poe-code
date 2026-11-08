import { Scope } from "../interp/scope.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { interpret } from "../interp/interpreter.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { isSandboxClosure, measureSandboxData } from "../interp/values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { createEvalSource } from "./dynamic-source.js";
import { compactAstStatistics, compactDynamicNodes } from "./compact-module-ast.js";
import {
  dynamicNodeSources,
  evalFunctionDeclarations,
  functionSources,
  functionStrictness,
  templateSources
} from "./function-source.js";
import { hashParsedAst } from "./hash.js";

it("keeps an unexecuted classic function body lazy", () => {
  const text =
    "function cold(){/*" +
    "x".repeat(512) +
    "*/return [" +
    Array.from({ length: 1000 }, (_, i) => "{value:" + i + "}").join(",") +
    "];} cold;";
  const parsed = createEvalSource(text, {}, undefined, "classic.js", { compactAst: true });
  const cold = parsed.node.body[0];
  if (cold?.type !== "FunctionDeclaration") throw Error("Missing function declaration");
  expect(Object.getOwnPropertyDescriptor(cold.body, "body")?.get).toBeTypeOf("function");
});

const pad = `/*${"x".repeat(512)}*/`;
function compile(body: string, compactAst: boolean, context = {}) {
  const budget = new Budget({
    maxSteps: 1000000,
    stringLength: 1000000,
    dataSize: 1000000
  });
  const lease = budget.acquireCompileOwner();
  try {
    return {
      parsed: createEvalSource(body, context, lease.owner, "classic.js", {
        compactAst
      }),
      steps: budget.stepsUsed,
      data: budget.currentDataSize
    };
  } finally {
    lease.release();
  }
}

it.each([
  `function f(){${pad}return 1};f;`,
  `'use strict';function f(x=()=>{${pad}return 1}){${pad}return x()};f;`,
  `<!-- legacy comment\nvar x=010;function f(){${pad}return '\\123'+x};f;\n--> tail`,
  `function f(){${pad}var x=1;return ()=>++x};f;`,
  `function f(){${pad}return class C {#x=1;read(){return this.#x};static {this.y=2}}};f;`,
  `function tag(s,x){return s};function f(){${pad}return tag\`a\u2028b\${1}c\u2029d\`};f;`,
  `function f(){${pad}return {x,...obj,method(){return this.x}}};f;`,
  `function f(){${pad}let a,b;[a,,b]=values;return [a,b,,...rest]};f;`,
  `function* f(){${pad}yield 1;return 2};f;`,
  `async function f(){${pad}return await 1};f;`,
  `function f(){${pad}return /a[b-c]+/giu};f;`,
  `function f(){${pad}return [1n,-0,Infinity]};f;`
])("preserves classic trees, IDs, source indexes and metadata: %j", (source) => {
  const control = compile(source, false),
    candidate = compile(source, true);
  expect(candidate.steps).toBe(control.steps);
  expect(candidate.data).toBe(control.data);
  expect(candidate.parsed.strict).toBe(control.parsed.strict);
  expect(candidate.parsed.source.nodes.size).toBe(control.parsed.source.nodes.size);
  expect([...candidate.parsed.source.nodes.keys()]).toEqual([
    ...control.parsed.source.nodes.keys()
  ]);
  expect(candidate.parsed.node).toEqual(control.parsed.node);
  expect(hashParsedAst(candidate.parsed.node)).toBe(hashParsedAst(control.parsed.node));
  for (const [id, node] of control.parsed.source.nodes) {
    const other = candidate.parsed.source.nodes.get(id)!;
    expect(other).toEqual(node);
    expect(dynamicNodeSources.get(other)).toBe(candidate.parsed.source);
    expect(candidate.parsed.source.nodes.get(id)).toBe(other);
    expect(functionSources.get(other as Parameters<typeof functionSources.get>[0])).toEqual(
      functionSources.get(node as Parameters<typeof functionSources.get>[0])
    );
    expect(functionStrictness.get(other as Parameters<typeof functionStrictness.get>[0])).toBe(
      functionStrictness.get(node as Parameters<typeof functionStrictness.get>[0])
    );
    expect(templateSources.get(other as Parameters<typeof templateSources.get>[0])).toBe(
      templateSources.get(node as Parameters<typeof templateSources.get>[0])
    );
    expect(
      evalFunctionDeclarations.has(other as Parameters<typeof evalFunctionDeclarations.has>[0])
    ).toBe(
      evalFunctionDeclarations.has(node as Parameters<typeof evalFunctionDeclarations.has>[0])
    );
  }
  expect(measureSandboxData([candidate.parsed.source])).toBe(
    measureSandboxData([control.parsed.source])
  );
});

it("indexes cold bodies without materializing their nodes", () => {
  const source = `function cold(){${pad}return [${Array.from({ length: 1000 }, (_, i) => `{value:${i}}`).join(",")}];} cold;`;
  const { parsed } = compile(source, true);
  expect(parsed.source.nodes.size).toBeGreaterThan(3000);
  const before = compactAstStatistics(parsed.node)!.materializedRecords;
  expect(before).toBeLessThan(30);
  expect([...parsed.source.nodes.keys()].length).toBe(parsed.source.nodes.size);
  expect(compactAstStatistics(parsed.node)!.materializedRecords).toBe(before);
  const key = [...parsed.source.nodes.keys()].find(
    (id) => parsed.source.nodes.get(id)?.type === "NumericLiteral"
  )!;
  const node = parsed.source.nodes.get(key)!;
  expect(dynamicNodeSources.get(node)).toBe(parsed.source);
});

it("preserves source-index mutation and iteration semantics", () => {
  const { parsed } = compile("var x=1;x;", true);
  const index = parsed.source.nodes,
    keys = [...index.keys()],
    first = index.get(keys[0]!)!,
    last = keys.at(-1)!;
  expect(index.get(-1)).toBeUndefined();
  index.set(last, first);
  expect([...index.keys()]).toEqual(keys);
  expect(index.get(last)).toBe(first);
  expect(index.delete(last)).toBe(true);
  expect(index.delete(last)).toBe(false);
  index.set(last, first);
  const entries = [...index];
  const observed: typeof entries = [];
  index.forEach((value, key, map) => {
    expect(map).toBe(index);
    observed.push([key, value]);
  });
  expect(observed).toEqual(entries);
  expect([...index.values()]).toEqual(entries.map(([, value]) => value));
  index.clear();
  expect(index.size).toBe(0);
  expect([...index]).toEqual([]);
});

it("restores closures and template identities from a compact classic source", async () => {
  const { parsed } = compile(
    `let n=0;function tag(s){return s};function site(){${pad}return tag\`hi\`};const first=site();(()=>[++n,site()===first]);`,
    true
  );
  const budget = new Budget({ maxSteps: 1000000, dataSize: 1000000 });
  const scope = new Scope(createBuiltinBindings({ budget }), undefined, undefined, {
    chargeData: false
  }).child({}, { globalEnvironment: true });
  const result = await interpret(
    { type: "BlockStatement", body: parsed.node.body, span: parsed.node.span },
    {
      script: { strict: parsed.strict },
      budget,
      scope,
      useScopeDirectly: true
    }
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const saved = serialize({
    source: "return 0",
    currentAstNodeId: 1,
    scopeChain: [{ id: "classic", bindings: { saved: result.returnValue } }],
    callStack: [],
    pendingPromises: [],
    moduleBindings: {}
  });
  const restored = restore(JSON.parse(JSON.stringify(saved)), {
    source: "return 0"
  });
  const lookup = restored.currentScope.lookup("saved");
  if (!lookup.found) throw new Error("Missing restored binding");
  const closure = lookup.value;
  expect(isSandboxClosure(closure)).toBe(true);
  if (!isSandboxClosure(closure)) throw new Error("Missing closure");
  expect(await invokeBuiltinClosure(closure, [], restored.budget, undefined, undefined)).toEqual([
    1,
    true
  ]);
  expect(await invokeBuiltinClosure(closure, [], restored.budget, undefined, undefined)).toEqual([
    2,
    true
  ]);
});

it("keeps compiler row authority private across forged receivers and native Map hooks", () => {
  const { parsed } = compile("function f(){return 7};f;", true);
  const index = parsed.source.nodes,
    key = [...index.keys()][0]!;
  expect(Reflect.ownKeys(index)).toEqual([]);
  expect(Map.prototype.get.call(index, key)).toBeUndefined();
  expect([...Map.prototype.entries.call(index)]).toEqual([]);
  expect(() => Reflect.construct(index.constructor, [Symbol(), new Map(), () => ({})])).toThrow(
    "authority"
  );
  const forged = Object.create(Object.getPrototypeOf(index)) as Map<number, unknown>;
  expect(() => forged.get(key)).toThrow(TypeError);
});

it("does not pass private row storage to later native Map reads", () => {
  const { parsed } = compile("function f(){return 7};f;", true);
  const index = parsed.source.nodes,
    key = [...index.keys()][0]!;
  const original = Map.prototype.get,
    observed: object[] = [];
  Map.prototype.get = function (key: unknown) {
    const value = Reflect.apply(original, this, [key]);
    if (typeof value === "number") observed.push(this);
    return value;
  };
  let value;
  try {
    value = index.get(key);
  } finally {
    Map.prototype.get = original;
  }
  expect(value).toBeDefined();
  expect(observed).toEqual([]);
});

it("rejects foreign source text and rebinding an index to another owner", () => {
  const { parsed } = compile("function f(){return 7};f;", true);
  expect(() => compactDynamicNodes(parsed.node, { ...parsed.source, body: "0;" })).toThrow(
    "source text"
  );
  expect(() => compactDynamicNodes(parsed.node, { ...parsed.source })).toThrow("source owner");
});
