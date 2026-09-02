import { describe, expect, it } from "vitest";

import { type ParseResult } from "../parse.js";
import { parseModule } from "../parse/parser.js";
import { run } from "../run.js";
import { restore } from "../snapshot/restore.js";
import { serialize } from "../snapshot/serialize.js";
import { Budget, SandboxError } from "./budget.js";
import { Scope } from "./scope.js";
import { isSandboxPromise } from "./values.js";

describe("language feature interactions", () => {
  it("keeps let, var, and const closure captures distinct through generators and await", async () => {
    const result = await run(`
      function* makeReaders() {
        const readers = [];
        for (let index = 0; index < 3; index = index + 1) {
          const fixed = index * 10;
          var shared = index;
          readers.push([() => index, () => fixed, () => shared]);
          yield index;
        }
        return readers;
      }

      const iterator = makeReaders();
      iterator.next();
      iterator.next();
      iterator.next();
      const readers = iterator.next().value;
      await Promise.resolve();
      return readers.map((row) => row.map((read) => read()));
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [
        [0, 0, 2],
        [1, 10, 2],
        [2, 20, 2]
      ]
    });
  });

  it("supports mutual declaration recursion and restored named-expression recursion", async () => {
    const mutual = await run(`
      function even(value) { return value === 0 ? true : odd(value - 1); }
      function odd(value) { return value === 0 ? false : even(value - 1); }
      return [even(20), odd(19)];
    `);
    expect(mutual).toMatchObject({ ok: true, returnValue: [true, true] });

    const source = [
      "const factorial = async function recur(value) {",
      "  await 0;",
      "  return value < 2 ? 1 : value * await recur(value - 1);",
      "};",
      "await task();"
    ].join("\n");
    const module = parseModule(source);
    const snapshot = serialize({
      source,
      currentAstNodeId: getNodeId(module, "AwaitExpression", 1),
      scopeChain: [
        {
          id: "module",
          bindings: {
            factorial: {
              kind: "fn",
              astNodeId: getNodeId(module, "FunctionExpression"),
              capturedScopeId: "module"
            }
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const restored = restore(snapshot, { source, budget: new Budget() });
    const factorial = restored.currentScope.lookup("factorial");

    expect(factorial.found).toBe(true);
    if (!factorial.found) return;
    const recursiveResult = factorial.value.call?.([6]);
    expect(isSandboxPromise(recursiveResult)).toBe(true);
    if (!isSandboxPromise(recursiveResult)) return;
    await expect(recursiveResult.promise).resolves.toBe(720);
  });

  it("preserves constructed method receivers and lexical arrow this", async () => {
    const source = `
      const methods = {
        read() {
          const arrow = () => this.value;
          return arrow();
        }
      };
      function Counter(start) {
        this.value = start;
        this.read = methods.read;
      }
      const counter = new Counter(7);
      await Promise.resolve();
      return counter.read();
    `;
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: 7 });

    if (!first.ok) return;
    await expect(run(source, { snapshot: first.snapshot })).rejects.toThrow(/prototype links/);
  });

  it("round-trips shared collection identity, cycles, and insertion order", async () => {
    const result = await run(`
      const shared = { id: "shared" };
      const first = new Map([[shared, "first"], ["second", 2]]);
      const second = new Set([shared, "tail"]);
      first.set("self", first);
      await Promise.resolve();
      return [
        first.keys()[0] === second.values()[0],
        first.get("self") === first,
        Array.from(first.keys()).map((key) => key.id || key),
        Array.from(second.values()).map((value) => value.id || value)
      ];
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [true, true, ["shared", "second", "self"], ["shared", "tail"]]
    });
  });

  it("structured-clones nested Map, Set, and array values without aliasing the source", async () => {
    const result = await run(`
      const key = { id: 1 };
      const source = new Map([[key, new Set([[1, 2], [3, 4]])]]);
      const clone = structuredClone(source);
      const clonedKey = clone.keys()[0];
      const clonedSet = clone.values()[0];
      return [
        clone !== source,
        clonedKey !== key,
        clonedSet.values().map(([left, right]) => left + right)
      ];
    `);

    expect(result).toMatchObject({ ok: true, returnValue: [true, true, [3, 7]] });
  });

  it("matches numeric edge cases for the new Math and Object builtins", async () => {
    const result = await run(`
      return [
        Number.isNaN(Math.acos(2)),
        Object.is(Math.atan2(0, -1), Math.PI),
        Object.is(Math.atan2(-0, -1), -Math.PI),
        Math.imul(0xffffffff, 5),
        Object.is(NaN, NaN),
        Object.is(0, -0),
        Object.is(-0 / -0, NaN)
      ];
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [true, true, true, -5, true, false, true]
    });
  });

  it("runs Promise finally reactions in order and propagates thrown failures", async () => {
    const result = await run(`
      const events = [];
      const recovered = await Promise.reject("bad")
        .catch((reason) => { events.push("catch:" + reason); return "ok"; })
        .finally(async () => { await Promise.resolve(); events.push("finally"); })
        .then((value) => { events.push("then:" + value); return value; });
      let thrown;
      try {
        await Promise.resolve("value").finally(() => { throw "final-error"; });
      } catch (error) {
        thrown = error;
      }
      return [recovered, thrown, events];
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: ["ok", "final-error", ["catch:bad", "finally", "then:ok"]]
    });
  });

  it("combines destructuring defaults with generator and Map iteration", async () => {
    const result = await run(`
      function* entries(map, prefix = "item", suffix = prefix + "!") {
        for (const [key, value = key + suffix] of map) {
          yield [prefix, key, value];
        }
      }
      const map = new Map([["a", undefined], ["b", 2]]);
      const output = [];
      for (const [prefix, key, value] of entries(map)) {
        let assigned;
        let nested;
        [assigned = prefix, { nested = key }] = [undefined, { nested: value }];
        output.push([assigned, key, nested]);
      }
      return output;
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [
        ["item", "a", "aitem!"],
        ["item", "b", 2]
      ]
    });
  });

  it("halts deep recursion and tight loops under small budgets", async () => {
    await expect(
      run("function recurse() { return recurse(); } return recurse();", {
        budget: new Budget({ maxCallDepth: 8 })
      })
    ).rejects.toMatchObject({
      name: SandboxError.name,
      budget: "callDepth"
    });

    await expect(
      run("let value = 0; while (true) { value = value + 1; }", {
        budget: new Budget({ maxSteps: 30 })
      })
    ).rejects.toMatchObject({
      name: SandboxError.name,
      budget: "steps"
    });
  });

  it("flattens deep scope chains into a stable snapshot", () => {
    let scope = new Scope({ root: "root" });
    for (let depth = 0; depth < 250; depth += 1) {
      scope = scope.child({ [`level${depth}`]: depth });
    }

    expect(scope.snapshot()).toEqual({
      bindings: expect.objectContaining({
        root: "root",
        level0: 0,
        level249: 249
      })
    });
  });
});

function getNodeId(module: ParseResult, type: string, occurrence = 0): number {
  const ids: number[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if ((value as { type?: unknown }).type === type) {
      const nodeId = (value as { nodeId?: unknown }).nodeId;
      if (typeof nodeId === "number") ids.push(nodeId);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(module);
  const nodeId = ids[occurrence];
  if (nodeId === undefined) throw new Error(`Missing ${type} occurrence ${occurrence}.`);
  return nodeId;
}
