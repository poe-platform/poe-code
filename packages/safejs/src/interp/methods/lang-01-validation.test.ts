import { describe, expect, it } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";
import { Budget } from "../budget.js";
import { assertCollectionMutable } from "../running-state.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxPromise,
  type SandboxValue
} from "../values.js";
import { callArrayMethod, type ArrayMethodOptions } from "./array.js";

describe("LANG-01 independent nested readers", () => {
  it.each([
    "alias.map(outer)",
    "alias.reduce((total, value, index, array) => total.concat(outer(value, index, array)), [])",
    "alias.toSorted((left, right) => { outer(left, 0, alias); return left - right; })"
  ])("composes three levels through aliases: %s", async (expression) => {
    const source = `
      const values = [3, 1, 2];
      const alias = values;
      function outer(value, index, array) {
        return array.filter(next => alias.every(last => {
          const total = values.reduceRight((sum, current) => sum + current, 0);
          return total >= last + next;
        })).map(next => value + next + index);
      }
      const result = ${expression};
      values.push(4);
      return { result, values, same: alias === values };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(structuredClone(result.returnValue)).toStrictEqual(expected);
    const replay = await run(source, {
      snapshot: restore(JSON.parse(serializeSafeJSSnapshot(result.snapshot)), { source })
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw replay.error;
    expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
  });

  it.each([
    "alias.slice(1)",
    "alias.concat([8])",
    "alias.includes(2)",
    "alias.indexOf(2)",
    "alias.lastIndexOf(2)",
    'alias.join(":")',
    "alias.at(-1)",
    "alias.flat()",
    "alias.toReversed()",
    "alias.toSpliced(1, 1, 8)",
    "alias.with(1, 8)",
    "alias.toSorted((left, right) => left - right)"
  ])("allows nonmutating read combinations: %s", async (expression) => {
    const source = `
      const values = [3, 1, 2];
      const alias = values;
      const result = values.map(value => alias.map(next => {
        return { value, next, read: ${expression} };
      }));
      return { result, values };
    `;
    const expected = Function('"use strict";\n' + source)();
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(structuredClone(result.returnValue)).toStrictEqual(expected);
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
      const expected = Function('"use strict";\n' + source)();
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(structuredClone(result.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(["map", "filter", "reduce", "find"] as const)(
    "retains the outer guard after invalid nested %s callback",
    async (method) => {
      const values = [1];
      const options = createOptions();
      const outer = createSandboxClosure({
        call: async () => {
          await expect(callArrayMethod(values, method, [], options)).rejects.toBeInstanceOf(
            TypeError
          );
          expect(() => assertCollectionMutable(values)).toThrowError(
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
    "preserves the mutation boundary: %s",
    async (mutation) => {
      await expect(
        run(`
        const values = [1];
        return values.map(() => {
          values.find(() => values.every(() => true));
          ${mutation};
          return 1;
        });
      `)
      ).rejects.toMatchObject({ name: "SandboxError", code: "reentry" });
    }
  );

  it.each([
    [0, 1, 2],
    [2, 0, 1],
    [1, 2, 0]
  ])("keeps overlapping readers locked through settlement order %j", async (...order) => {
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
        expect(() => assertCollectionMutable(values)).toThrowError(
          expect.objectContaining({ code: "reentry" })
        );
        pending[index].resolve(undefined);
        if (index === 1) await expect(readers[index]).rejects.toBe(failure);
        else await expect(readers[index]).resolves.toEqual([index]);
        if (position < order.length - 1) {
          await expect(callArrayMethod(values, "push", [3], options)).rejects.toMatchObject({
            code: "reentry"
          });
        }
      }
      await expect(callArrayMethod(values, "push", [2], options)).resolves.toBe(2);
    } finally {
      for (const wait of pending) wait.resolve(undefined);
      await Promise.allSettled(readers);
    }
    expect(values).toEqual([1, 2]);
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
