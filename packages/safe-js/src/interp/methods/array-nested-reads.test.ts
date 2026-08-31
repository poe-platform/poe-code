import { describe, expect, it } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";
import { Budget } from "../budget.js";
import {
  assertCollectionMutable,
  enterCollectionCallback,
  enterRunningState
} from "../running-state.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxPromise,
  type SandboxValue
} from "../values.js";
import { callArrayMethod, type ArrayMethodOptions } from "./array.js";

const readMethods = [
  "map",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "reduce",
  "reduceRight",
  "forEach",
  "flatMap"
];

function readCall(method: string, receiver: string, callback: string): string {
  if (method === "reduce" || method === "reduceRight") {
    return `${receiver}.${method}((total, value, index, array) => total + ${callback}(value, index, array), 0)`;
  }
  return `${receiver}.${method}(${callback})`;
}

describe.each(readMethods)("nested read-only %s", (outerMethod) => {
  it.each(readMethods)("composes with %s on the callback's aliased source", async (innerMethod) => {
    const source = `
      const values = [3, 1, 2];
      const visits = [];
      function outer(value, index, array) {
        const alias = array;
        const innerVisits = [];
        function inner(next, position, original) {
          innerVisits.push([next, position, original === values]);
          return next + position;
        }
        const nested = ${readCall(innerMethod, "alias", "inner")};
        visits.push({ value, index, same: array === values, nested, innerVisits });
        return value;
      }
      const result = ${readCall(outerMethod, "values", "outer")};
      values.push(4);
      return { result, visits, values };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(structuredClone(result.returnValue)).toStrictEqual(expected);
  });

  it("permits native mutation after a nested early return", async () => {
    const source = `
      const values = [3, 1, 2];
      function outer(value) {
        values.find(next => next === 3);
        values.push(4);
        return value;
      }
      const result = ${readCall(outerMethod, "values", "outer")};
      return { result, values };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(structuredClone(result.returnValue)).toStrictEqual(expected);
  });
});

describe.each(["sort", "toSorted"])("%s comparator read-only composition", (method) => {
  it.each([
    { innerMethod: "map", nested: [3, 1, 2] },
    { innerMethod: "filter", nested: [3, 1, 2] },
    { innerMethod: "find", nested: 3 },
    { innerMethod: "findIndex", nested: 0 },
    { innerMethod: "findLast", nested: 2 },
    { innerMethod: "findLastIndex", nested: 2 },
    { innerMethod: "some", nested: true },
    { innerMethod: "every", nested: true },
    { innerMethod: "reduce", nested: 6 },
    { innerMethod: "reduceRight", nested: 6 },
    { innerMethod: "forEach", nested: undefined },
    { innerMethod: "flatMap", nested: [3, 1, 2] }
  ])(
    "allows $innerMethod without comparing implementation-specific comparator counts",
    async ({ innerMethod, nested }) => {
      const source = `
      const values = [3, 1, 2];
      let nested;
      let inspectCalled = false;
      function inspect(value) { inspectCalled = true; return value; }
      const sorted = values.${method}((left, right) => {
        nested = ${readCall(innerMethod, "values", "inspect")};
        return left - right;
      });
      return { sorted, values, nested, inspectCalled };
    `;
      const expected = {
        sorted: [1, 2, 3],
        values: method === "sort" ? [1, 2, 3] : [3, 1, 2],
        nested,
        inspectCalled: true
      };
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(structuredClone(result.returnValue)).toStrictEqual(expected);
      if (typeof Reflect.get(Array.prototype, method) === "function") {
        const native = Function('"use strict";\n' + source)();
        expect(structuredClone(result.returnValue)).toStrictEqual(native);
      }
    }
  );
});

describe("array callback lifetime", () => {
  it.each(["[]", "[3, , 1]"])("preserves empty/sparse iteration for %s", async (input) => {
    const source = `
      const values = ${input};
      const result = values.map(value => values.map(next => next + value));
      values.push(4);
      return { values, result };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(structuredClone(result.returnValue)).toStrictEqual(expected);
  });

  it("supports detached aliases, three nested reads, and completed replay", async () => {
    const source = `
      const values = [1, 2];
      const alias = values;
      const read = alias.map;
      const holder = { read };
      const result = values.map(left => holder.read.call(alias, middle => alias.map(right => left + middle + right)));
      values.push(3);
      return { result, values, same: alias === values };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(structuredClone(result.returnValue)).toStrictEqual(expected);
    const replay = await run(source, {
      snapshot: JSON.parse(serializeSafeJSSnapshot(result.snapshot))
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
  });

  it("allows bounded recursion through the same callback function", async () => {
    const source = `
      const values = [1, 2];
      let depth = 2;
      function visit(value) {
        if (depth === 0) return value;
        depth--;
        const result = values.map(visit);
        depth++;
        return result;
      }
      const result = values.map(visit);
      values.push(3);
      return { result, values, depth };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(structuredClone(result.returnValue)).toStrictEqual(expected);
  });

  it("releases after nested throws caught inside and outside the outer callback", async () => {
    const source = `
      const values = [1, 2];
      const trace = [];
      values.forEach(value => {
        try {
          values.map(() => { throw new Error("inner"); });
        } catch (error) {
          trace.push(error.message, values.reduce((sum, next) => sum + next, value));
        }
      });
      try {
        values.map(() => values.map(() => { throw new Error("outer"); }));
      } catch (error) {
        trace.push(error.message);
      }
      values.push(3);
      return { trace, values, result: values.map(value => value * 2) };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(structuredClone(result.returnValue)).toStrictEqual(expected);
  });

  it.each([
    "values.push(4)",
    "values.pop()",
    "values.shift()",
    "values.unshift(4)",
    "values.splice(0, 1)",
    "values.fill(4)",
    "values.copyWithin(0, 1)",
    "values.reverse()",
    "values.sort((left, right) => left - right)",
    "values[0] = 4",
    "values.length = 0",
    "delete values[0]"
  ])("preserves native nested callback semantics for %s", async (mutation) => {
    const source = `
      const values = [3, 1, 2];
      let changed = false;
      const result = values.map(() => {
        return values.map(() => {
          if (!changed) { changed = true; ${mutation}; }
          return 1;
        });
      });
      return { result, values, keys: Object.keys(values) };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(structuredClone(result.returnValue)).toStrictEqual(expected);
  });

  it("keeps nested running protection without locking mutation when the outer reader finishes", async () => {
    const values = [1];
    const options = createOptions();
    const entered = deferred();
    const pending = deferred();
    let nested: Promise<SandboxValue> | undefined;
    const inner = createSandboxClosure({
      call: async () => {
        entered.resolve(undefined);
        await pending.promise;
        return 2;
      }
    });
    const outer = createSandboxClosure({
      call: async () => {
        nested = callArrayMethod(values, "map", [inner], options);
        await Promise.race([entered.promise, nested]);
        return 1;
      }
    });
    try {
      await expect(callArrayMethod(values, "map", [outer], options)).resolves.toEqual([1]);
      expect(() => assertCollectionMutable(values)).not.toThrow();
      expect(() => enterRunningState(values)).toThrow(expect.objectContaining({ code: "reentry" }));
    } finally {
      pending.resolve(undefined);
      await nested?.catch(() => undefined);
    }
    expect(() => enterRunningState(values)()).not.toThrow();
    expect(() => assertCollectionMutable(values)).not.toThrow();
    await expect(callArrayMethod(values, "push", [3], options)).resolves.toBe(2);
  });

  it("retains outer running protection after an inner error without preventing mutation", async () => {
    const values = [1];
    const options = createOptions();
    const failure = new Error("inner");
    let innerCompleted = false;
    const inner = createSandboxClosure({
      call: () => {
        throw failure;
      }
    });
    const outer = createSandboxClosure({
      call: async () => {
        await expect(callArrayMethod(values, "map", [inner], options)).rejects.toBe(failure);
        innerCompleted = true;
        expect(() => enterRunningState(values)).toThrow(
          expect.objectContaining({ code: "reentry" })
        );
        await expect(callArrayMethod(values, "push", [2], options)).resolves.toBe(2);
        throw failure;
      }
    });
    await expect(callArrayMethod(values, "map", [outer], options)).rejects.toBe(failure);
    expect(innerCompleted).toBe(true);
    expect(values).toEqual([1, 2]);
    expect(() => enterRunningState(values)()).not.toThrow();
    await expect(callArrayMethod(values, "push", [3], options)).resolves.toBe(3);
  });

  it("does not bypass a separately held collection guard", async () => {
    const values = [1];
    const options = createOptions();
    const callback = createSandboxClosure({ call: ([value]) => value });
    const leave = enterCollectionCallback(values);
    try {
      await expect(callArrayMethod(values, "map", [callback], options)).rejects.toMatchObject({
        code: "reentry"
      });
    } finally {
      leave();
    }
    await expect(callArrayMethod(values, "map", [callback], options)).resolves.toEqual([1]);
  });

  it.each(["map", "reduce"])(
    "restores nested %s reads across an active checkpoint",
    async (method) => {
      const source = `
      const values = [1, 2];
      function inner(value) { return value * 3; }
      const result = await Promise.all(values.map(async value => {
        const before = ${readCall(method, "values", "inner")};
        await wait();
        return { value, before, after: ${readCall(method, "values", "inner")} };
      }));
      values.push(3);
      return { result, values };
    `;
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      const expected = await new AsyncFunction("wait", source)(async () => undefined);
      const pending = deferred();
      const execution = run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            name: "wait",
            call: () => createSandboxPromise(pending.promise)
          })
        }
      });
      void execution.catch(() => undefined);
      let checkpoint;
      try {
        checkpoint = JSON.parse(await dump(execution));
      } finally {
        pending.resolve(undefined);
      }
      const original = await execution;
      expect(original.ok).toBe(true);
      expect(checkpoint.pendingAwaits?.length ?? 0).toBeGreaterThan(0);
      if (original.ok) expect(structuredClone(original.returnValue)).toStrictEqual(expected);
      const replay = await run(source, {
        snapshot: restore(checkpoint, { source }),
        bindings: {
          wait: createSandboxClosure({
            async: true,
            name: "wait",
            call: () => createSandboxPromise(Promise.resolve(undefined))
          })
        }
      });
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
    }
  );
});

function createOptions(): ArrayMethodOptions {
  return {
    budget: new Budget(),
    callClosure: async (closure, args, stack) => {
      const result = await closure.call(args, { stack, thisValue: undefined });
      return isSandboxPromise(result) ? await result.promise : result;
    }
  };
}

function deferred() {
  let resolve!: (value: undefined) => void;
  const promise = new Promise<undefined>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
