import { describe, expect, it } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";
import { Budget } from "../budget.js";
import { assertCollectionMutable, enterRunningState } from "../running-state.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxPromise,
  type SandboxValue
} from "../values.js";
import { callArrayMethod, type ArrayMethodOptions } from "./array.js";

describe("LANG-01 independent nested readers", () => {
  it.each([
    {
      method: "map",
      expression: "alias.map(outer)",
      expectedResult: [
        [6, 4, 5],
        [5, 3, 4],
        [7, 5, 6]
      ]
    },
    {
      method: "reduce",
      expression:
        "alias.reduce((total, value, index, array) => total.concat(outer(value, index, array)), [])",
      expectedResult: [6, 4, 5, 5, 3, 4, 7, 5, 6]
    },
    {
      method: "toSorted",
      expression:
        "alias.toSorted((left, right) => { outer(left, 0, alias); return left - right; })",
      expectedResult: [1, 2, 3]
    }
  ])(
    "composes three levels through aliases: $expression",
    async ({ method, expression, expectedResult }) => {
      const source = `
      const values = [3, 1, 2];
      const alias = values;
      let nestedReaderCalled = false;
      function outer(value, index, array) {
        return array.filter(next => alias.every(last => {
          const total = values.reduceRight((sum, current) => {
            nestedReaderCalled = true;
            return sum + current;
          }, 0);
          return total >= last + next;
        })).map(next => value + next + index);
      }
      const result = ${expression};
      values.push(4);
      return { result, values, same: alias === values, nestedReaderCalled };
    `;
      const expected = {
        result: expectedResult,
        values: [3, 1, 2, 4],
        same: true,
        nestedReaderCalled: true
      };
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(structuredClone(result.returnValue)).toStrictEqual(expected);
      if (typeof Reflect.get(Array.prototype, method) === "function") {
        const native = Function('"use strict";\n' + source)();
        expect(structuredClone(result.returnValue)).toStrictEqual(native);
      }
      const replay = await run(source, {
        snapshot: restore(JSON.parse(serializeSafeJSSnapshot(result.snapshot)), { source })
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw replay.error;
      expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
    }
  );

  it.each([
    { method: "slice", expression: "alias.slice(1)", read: [1, 2] },
    { method: "concat", expression: "alias.concat([8])", read: [3, 1, 2, 8] },
    { method: "includes", expression: "alias.includes(2)", read: true },
    { method: "indexOf", expression: "alias.indexOf(2)", read: 2 },
    { method: "lastIndexOf", expression: "alias.lastIndexOf(2)", read: 2 },
    { method: "join", expression: 'alias.join(":")', read: "3:1:2" },
    { method: "at", expression: "alias.at(-1)", read: 2 },
    { method: "flat", expression: "alias.flat()", read: [3, 1, 2] },
    { method: "toReversed", expression: "alias.toReversed()", read: [2, 1, 3] },
    { method: "toSpliced", expression: "alias.toSpliced(1, 1, 8)", read: [3, 8, 2] },
    { method: "with", expression: "alias.with(1, 8)", read: [3, 8, 2] },
    {
      method: "toSorted",
      expression: "alias.toSorted((left, right) => left - right)",
      read: [1, 2, 3]
    }
  ])("allows nonmutating read combinations: $expression", async ({ method, expression, read }) => {
    const source = `
      const values = [3, 1, 2];
      const alias = values;
      const result = values.map(value => alias.map(next => {
        return { value, next, read: ${expression} };
      }));
      return { result, values };
    `;
    const expected = {
      result: [
        [
          { value: 3, next: 3, read },
          { value: 3, next: 1, read },
          { value: 3, next: 2, read }
        ],
        [
          { value: 1, next: 3, read },
          { value: 1, next: 1, read },
          { value: 1, next: 2, read }
        ],
        [
          { value: 2, next: 3, read },
          { value: 2, next: 1, read },
          { value: 2, next: 2, read }
        ]
      ],
      values: [3, 1, 2]
    };
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(structuredClone(result.returnValue)).toStrictEqual(expected);
    if (typeof Reflect.get(Array.prototype, method) === "function") {
      const native = Function('"use strict";\n' + source)();
      expect(structuredClone(result.returnValue)).toStrictEqual(native);
    }
  });

  it.each(["[]", "[, 2, , 4]", "[undefined, 2]"])(
    "preserves sparse and empty traversal: %s",
    async (input) => {
      const source = `
        const values = ${input};
        const visits = [];
        const result = values.map((value, index, alias) => {
          return alias.filter((next, position) => {
            visits.push([index, position, next]);
            return alias.some(last => last === next);
          });
        });
        values.push(5);
        return { result, visits, values };
      `;
      const expected = Function('"use strict";\n' + source)();
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(structuredClone(result.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(["find", "findIndex", "findLast", "findLastIndex", "some", "every"])(
    "releases readers after nested early exit in %s",
    async (method) => {
      const source = `
        const values = [1, 2, 3];
        const visits = [];
        const result = values.${method}((value, index, alias) => {
          const nested = alias.findLast(next => {
            visits.push([value, next]);
            return values.some(last => last === next);
          });
          return value === nested;
        });
        values.reverse();
        return { result, visits, values };
      `;
      const expected = Function('"use strict";\n' + source)();
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(structuredClone(result.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(["map", "reduce", "sort", "toSorted"])(
    "releases all levels after a user throw in %s",
    async (method) => {
      const source = `
        const values = [3, 1, 2];
        const trace = [];
        function fail() {
          return values.find(() => values.every(() => { throw new Error("nested"); }));
        }
        try { values.${method}(fail, 0); }
        catch (error) { trace.push(error.message); }
        values.push(4);
        const recovered = values.map(value => values.reduce((sum, next) => sum + next, value));
        return { values, trace, recovered };
      `;
      const expected = {
        values: [3, 1, 2, 4],
        trace: ["nested"],
        recovered: [13, 11, 12, 14]
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

  it.each(["map", "filter", "reduce", "find"] as const)(
    "retains outer running protection after invalid nested %s callback",
    async (method) => {
      const values = [1];
      const options = createOptions();
      const outer = createSandboxClosure({
        call: async () => {
          await expect(callArrayMethod(values, method, [], options)).rejects.toBeInstanceOf(
            TypeError
          );
          expect(() => assertCollectionMutable(values)).not.toThrow();
          expect(() => enterRunningState(values)).toThrowError(
            expect.objectContaining({ code: "reentry" })
          );
          return 7;
        }
      });
      await expect(callArrayMethod(values, "map", [outer], options)).resolves.toEqual([7]);
      await expect(callArrayMethod(values, "push", [2], options)).resolves.toBe(2);
    }
  );

  it.each(["values.push(2)", "values.sort()", "values[0] = 2", "values.length = 0"])(
    "matches native nested-reader mutation: %s",
    async (mutation) => {
      const source = `
        const values = [1];
        const result = values.map(() => {
          values.find(() => values.every(() => true));
          ${mutation};
          return 1;
        });
        return { result, values, keys: Object.keys(values) };
      `;
      const expected = Function('"use strict";\n' + source)();
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(structuredClone(result.returnValue)).toStrictEqual(expected);
    }
  );

  it.each([
    [0, 1, 2],
    [2, 0, 1],
    [1, 2, 0]
  ])("keeps overlapping readers running through settlement order %j", async (...order) => {
    const values = [1];
    const unrelated = [10];
    const options = createOptions();
    const pending = [deferred(), deferred(), deferred()];
    const failure = new Error("middle reader");
    const readers: Promise<SandboxValue>[] = [];
    const outer = createSandboxClosure({
      call: () => {
        for (let index = 0; index < pending.length; index += 1) {
          const callback = createSandboxClosure({
            call: async () => {
              await pending[index].promise;
              if (index === 1) throw failure;
              return index;
            }
          });
          const reader = callArrayMethod(values, "map", [callback], options);
          void reader.catch(() => undefined);
          readers.push(reader);
        }
        return 9;
      }
    });
    try {
      await expect(callArrayMethod(values, "map", [outer], options)).resolves.toEqual([9]);
      await expect(callArrayMethod(unrelated, "push", [11], options)).resolves.toBe(2);
      for (const [position, index] of order.entries()) {
        expect(() => assertCollectionMutable(values)).not.toThrow();
        expect(() => enterRunningState(values)).toThrowError(
          expect.objectContaining({ code: "reentry" })
        );
        pending[index].resolve(undefined);
        if (index === 1) await expect(readers[index]).rejects.toBe(failure);
        else await expect(readers[index]).resolves.toEqual([index]);
        if (position < order.length - 1) {
          await expect(callArrayMethod(values, "push", [3], options)).resolves.toBe(position + 2);
        }
      }
      expect(() => enterRunningState(values)()).not.toThrow();
      await expect(callArrayMethod(values, "push", [2], options)).resolves.toBe(4);
    } finally {
      for (const wait of pending) wait.resolve(undefined);
      await Promise.allSettled(readers);
    }
    expect(values).toEqual([1, 3, 3, 2]);
    expect(unrelated).toEqual([10, 11]);
  });

  it.each([false, true])(
    "replays an active aliased checkpoint with caught throw=%s",
    async (fail) => {
      const source = `
      const values = [1, 2];
      const alias = values;
      const trace = [];
      const result = await Promise.all(alias.map(async value => {
        const before = values.find(next => alias.every(last => last >= next));
        await wait();
        let after;
        try {
          after = alias.map(next => values.reduce((sum, last) => {
            if (${fail} && value === 2 && next === 2) throw new Error("nested");
            return sum + last;
          }, next));
        } catch (error) { trace.push(error.message); after = []; }
        return { value, before, after };
      }));
      values.push(3);
      return { result, trace, values, same: alias === values };
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
      const result = await execution;
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(checkpoint.pendingAwaits?.length ?? 0).toBeGreaterThan(0);
      expect(structuredClone(result.returnValue)).toStrictEqual(expected);
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
      if (!replay.ok) throw replay.error;
      expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
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
