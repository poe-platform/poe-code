import { expect, it } from "vitest";
import { run } from "../run.js";
import { getSandboxPrototype } from "../interp/object-model.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { runInNewContext } from "node:vm";

it.each([
  ["({})", "Object.prototype"],
  ["/x/", "RegExp.prototype"],
  ["new Date(0)", "Date.prototype"],
  ["new Number(7)", "Number.prototype"],
  ["[]", "Array.prototype"],
  ["new Map([[1,2]]).values()", "Object.getPrototypeOf(new Map().values())"],
  ["new Set([1]).values()", "Object.getPrototypeOf(new Set().values())"],
  ['"x".matchAll(/x/g)', 'Object.getPrototypeOf("".matchAll(/x/g))'],
  ["[1].values()", "Object.getPrototypeOf([].values())"],
  ['"x"[Symbol.iterator]()', 'Object.getPrototypeOf(""[Symbol.iterator]())']
])("preserves pristine %s prototype identity from two realms", async (expression, prototype) => {
  const source = `return [${expression},${prototype}]`;
  const a = await run(source), b = await run(source);
  if (!a.ok || !b.ok) throw new Error("Missing original values");
  let first = a.returnValue, second = b.returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "module", bindings: { first, second, alias: first } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    first = restored.currentScope.lookup("first").value;
    second = restored.currentScope.lookup("second").value;
    if (!Array.isArray(first) || !Array.isArray(second)) throw new Error("Missing restored values");
    expect(first[1] === second[1]).toBe(false);
    expect(restored.currentScope.lookup("alias").value === first).toBe(true);
    for (const graph of [first, second]) {
      if (graph[0] === null || typeof graph[0] !== "object") throw new Error("Missing guest object");
      expect(getSandboxPrototype(graph[0]) === graph[1]).toBe(true);
    }
  }
});

it.each([
  "new Map([[1,2],[3,4]]).values()", "new Set([1,2]).values()",
  '"xx".matchAll(/x/g)', "[1,2].values()", '"xy"[Symbol.iterator]()'
])("preserves %s cursor progression across mixed-realm snapshots", async expression => {
  const source = `return ${expression}`;
  const a = await run(source), b = await run(source);
  if (!a.ok || !b.ok) throw new Error("Missing original iterators");
  let first = a.returnValue, second = b.returnValue;
  const native = [runInNewContext(expression), runInNewContext(expression)];
  for (let round = 0; round < 3; round++) {
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "module", bindings: { first, second } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    first = restored.currentScope.lookup("first").value;
    second = restored.currentScope.lookup("second").value;
    for (const [index, iterator] of [first, second].entries()) {
      const result = await interpret(parseModule("{return iterator.next()}").body[0], {
        budget: restored.budget, bindings: { iterator }
      });
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual(native[index].next());
    }
  }
});
