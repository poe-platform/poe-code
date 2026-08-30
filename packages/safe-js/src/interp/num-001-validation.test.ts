import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { dump } from "../dump.js";
import { parseModule } from "../parse/parser.js";
import { restore as restoreRun } from "../restore.js";
import { run } from "../run.js";
import { restore as restoreScope } from "../snapshot/restore.js";
import { serialize } from "../snapshot/serialize.js";
import { getFunctionMember } from "./methods/function.js";
import { isSandboxClosure } from "./values.js";

describe("NUM-001 independent validation", () => {
  it.each([
    ["", 0],
    ["first,", 1],
    ["first, second, third, fourth", 4],
    ["first = 1, second, third", 0],
    ["first, second = 2, third, fourth = 4", 1],
    ["first, second, third = 3, fourth", 2],
    ["...tail", 0],
    ["first, second, ...tail", 2],
    ["first, second = 2, ...tail", 1],
    ["{ nested: { value = 7 }, ...other }, [first, ...tail], last", 3],
    ["[first = 1, , ...tail], { second = 2 }", 2],
    ["{ first = 1 } = {}, second", 0],
    ["[first = 1], { second = 2 } = {}, third", 1],
    ["first, [second] = [], ...tail", 1]
  ])("derives and binds all supported source forms: (%s)", async (parameters, length) => {
    const source = `
      function declared(${parameters}) {}
      async function asyncDeclared(${parameters}) {}
      function* generatorDeclared(${parameters}) {}
      const functions = [
        declared,
        function(${parameters}) {},
        function named(${parameters}) {},
        (${parameters}) => 0,
        asyncDeclared,
        async function(${parameters}) {},
        async function namedAsync(${parameters}) {},
        async (${parameters}) => 0,
        generatorDeclared,
        function*(${parameters}) {},
        ({ method(${parameters}) {} }).method,
        ({ async load(${parameters}) {} }).load,
        ({ ["computed"](${parameters}) {} }).computed,
        ({ "literal"(${parameters}) {} }).literal,
        ({ 4(${parameters}) {} })[4]
      ];
      return functions.map(target => {
        const once = target.bind(null, 10);
        return [
          target.length, target["length"], target.bind().length,
          target.bind({ receiver: true }).length, once.length,
          once.bind(null, 20).length,
          target.bind(null, 1, 2, 3, 4, 5).length
        ];
      });
    `;
    const expected = Array.from({ length: 15 }, () => [
      length,
      length,
      length,
      length,
      Math.max(0, length - 1),
      Math.max(0, length - 2),
      0
    ]);
    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      expected
    );
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("never evaluates computed destructuring keys or defaults while deriving or binding", async () => {
    const source = `
      let keys = 0;
      let defaults = 0;
      function target({ [++keys]: value = ++defaults }, second, third = ++defaults) {
        return [value, second, third, arguments.length];
      }
      const bound = target.bind(null, {});
      const before = [target.length, bound.length, keys, defaults];
      const result = bound(8);
      return { before, result, after: [target.length, bound.length, keys, defaults] };
    `;
    const expected = { before: [2, 1, 0, 0], result: [1, 8, 2, 2], after: [2, 1, 1, 2] };
    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      expected
    );
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("preserves source arity through await, fulfilled promises, and bound invocation", async () => {
    const source = `
      async function factory(first, ...tail) {
        await Promise.resolve(0);
        return function recovered(left, { right = 9 }, last = 4, ...rest) {
          return [left, right, last, rest.length];
        };
      }
      const target = await factory();
      const direct = await target;
      const resolved = await Promise.resolve(target);
      const chained = await Promise.resolve(target).then(value => value);
      const all = await Promise.all([target]);
      const bound = chained.bind(null, 3);
      const rebound = bound.bind(null, {});
      return {
        lengths: [factory.length, target.length, direct.length, resolved.length,
          chained.length, all[0].length, bound.length, rebound.length],
        same: [target === direct, target === resolved, target === chained, target === all[0]],
        result: bound({}), rebound: rebound()
      };
    `;
    const expected = {
      lengths: [1, 2, 2, 2, 2, 2, 1, 0],
      same: [true, true, true, true],
      result: [3, 9, 4, 0],
      rebound: [3, 9, 4, 0]
    };
    await expect(
      runInNewContext(`(async function() { ${source} })()`, {}, { timeout: 1_000 })
    ).resolves.toEqual(expected);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    ["function(first, second, third = 3) {}", 2],
    ["function named({ first = 1 }, [second], ...rest) {}", 2],
    ["async function(first = 1, second) {}", 0],
    ["async function named(first, second, ...rest) {}", 2],
    ["function*(first, ...rest) {}", 1],
    ["function* named({ first = 1 }, second = 2) {}", 1],
    ["([first = 1], { second = 2 }, third) => first", 3],
    ["async (first, second = 2, ...rest) => first", 1]
  ])(
    "rebuilds and rebinds serialized source metadata without execution: %s",
    async (expression, length) => {
      expect(runInNewContext(`(${expression}).length`, {}, { timeout: 1_000 })).toBe(length);
      const source = `const target = ${expression}; await 0;`;
      const module = parseModule(source);
      const declaration = module.body[0];
      const statement = module.body[1];
      if (declaration?.type !== "VariableDeclaration" || statement?.type !== "ExpressionStatement")
        throw new Error("Expected declaration and await statement");
      const closureNode = declaration.declarations[0]?.init;
      if (closureNode?.nodeId === undefined || statement.expression.nodeId === undefined)
        throw new Error("Expected source node IDs");
      const descriptor = {
        kind: "fn" as const,
        astNodeId: closureNode.nodeId,
        capturedScopeId: "module"
      };
      const snapshot = serialize({
        source,
        currentAstNodeId: statement.expression.nodeId,
        scopeChain: [{ id: "module", bindings: { target: descriptor } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      });
      expect(snapshot.scopeChain[0]?.bindings.target).toEqual(descriptor);
      const restored = restoreScope(JSON.parse(JSON.stringify(snapshot)), { source });
      const binding = restored.currentScope.lookup("target");
      if (!binding.found || !isSandboxClosure(binding.value))
        throw new Error("Expected restored source closure");
      const options = { callClosure: vi.fn() };
      expect(getFunctionMember(binding.value, "length", options)).toBe(length);
      const bind = getFunctionMember(binding.value, "bind", options);
      if (!isSandboxClosure(bind)) throw new Error("Expected bind method");
      const bound = await bind.call([null, 1]);
      if (!isSandboxClosure(bound)) throw new Error("Expected bound source closure");
      expect(getFunctionMember(bound, "length", options)).toBe(Math.max(0, length - 1));
      const bindAgain = getFunctionMember(bound, "bind", options);
      if (!isSandboxClosure(bindAgain)) throw new Error("Expected second bind method");
      const rebound = await bindAgain.call([null, 2, 3, 4]);
      if (!isSandboxClosure(rebound)) throw new Error("Expected rebound source closure");
      expect(getFunctionMember(rebound, "length", options)).toBe(0);
      expect(options.callClosure).not.toHaveBeenCalled();
    }
  );

  it("retains metadata across an in-memory completed-run dump and resume", async () => {
    const source = `
      function target({ value = 4 }, next, last = 6) { return value + next + last; }
      const before = target.length;
      await Promise.resolve(0);
      return [before, target.length, target.bind(null, {}).length, target({}, 5)];
    `;
    const expected = [2, 2, 1, 15];
    await expect(
      runInNewContext(`(async function() { ${source} })()`, {}, { timeout: 1_000 })
    ).resolves.toEqual(expected);
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: expected });
    const snapshot = restoreRun(JSON.parse(await dump(first)), { source });
    await expect(run(source, { snapshot })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });
});
