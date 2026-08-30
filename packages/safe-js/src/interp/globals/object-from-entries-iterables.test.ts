import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import type { SandboxClosure, SandboxValue } from "../values.js";
import { createObjectArrayGlobals } from "./object-array.js";

describe("Object.fromEntries supported iterables", () => {
  it.each([
    {
      name: "Map entries",
      source: 'return Object.fromEntries(new Map([["first", 1], ["second", 2]]));'
    },
    {
      name: "generator entries",
      source: `
        function* entries() {
          yield ["first", 1];
          yield ["second", 2];
        }
        return Object.fromEntries(entries());
      `
    },
    {
      name: "Set entries",
      source: 'return Object.fromEntries(new Set([["first", 1], ["second", 2]]));'
    },
    {
      name: "empty Map",
      source: "return Object.fromEntries(new Map());"
    },
    {
      name: "empty generator",
      source: "function* entries() {} return Object.fromEntries(entries());"
    },
    {
      name: "partially consumed generator",
      source: `
        function* entries() { yield ["first", 1]; yield ["second", 2]; }
        const iterator = entries();
        iterator.next();
        return Object.fromEntries(iterator);
      `
    },
    {
      name: "duplicates, numeric keys, array-like pairs, and missing values",
      source: `
        function* entries() {
          yield ["first", 1];
          yield [2, "two"];
          yield { 0: "second", 1: 2 };
          yield ["first", 3];
          yield ["missing"];
          yield [1, "one"];
        }
        const result = Object.fromEntries(entries());
        return [result, Object.keys(result), Object.hasOwn(result, "missing")];
      `
    }
  ])("matches native $name", async ({ source }) => {
    const expected = new Function(source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    { name: "Map", input: 'new Map([["first", shared], ["second", shared]])' },
    { name: "Set", input: 'new Set([["first", shared], ["second", shared]])' },
    { name: "generator", input: "entries()" },
    { name: "array", input: '[["first", shared], ["second", shared]]' }
  ])("preserves aliased entry values for $name", async ({ input }) => {
    const source = `
      const shared = { count: 1 };
      function* entries() {
        yield ["first", shared];
        yield ["second", shared];
      }
      const result = Object.fromEntries(${input});
      result.first.count = 7;
      return [result.first === shared, result.first === result.second, shared.count];
    `;
    const expected = new Function(source)();
    expect(expected).toEqual([true, true, 7]);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    {
      name: "invalid entry stops consumption and closes the generator",
      body: 'yield ["first", 1]; yield 42; events.push("unreachable");',
      cleanup: 'events.push("closed");'
    },
    {
      name: "cleanup errors do not replace the invalid-entry error",
      body: "yield null;",
      cleanup: 'events.push("closed"); throw new Error("cleanup");'
    },
    {
      name: "source throws propagate after generator cleanup",
      body: 'yield ["first", 1]; throw new Error("source");',
      cleanup: 'events.push("closed");'
    },
    {
      name: "normal exhaustion completes the generator",
      body: 'yield ["first", 1]; events.push("finished");',
      cleanup: 'events.push("closed");'
    }
  ])("matches native abrupt behavior: $name", async ({ body, cleanup }) => {
    const source = `
      const events = [];
      function* entries() {
        try { ${body} } finally { ${cleanup} }
      }
      let result;
      let errorName;
      let errorMessage;
      try { result = Object.fromEntries(entries()); }
      catch (error) {
        errorName = error.name;
        if (errorName !== "TypeError") errorMessage = error.message;
      }
      return [result, errorName, errorMessage, events];
    `;
    const expected = new Function(source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([undefined, null, 12, true, { length: 0 }])("rejects non-iterable %j", (input) => {
    const globals = createObjectArrayGlobals({ budget: new Budget() });
    const fromEntries = globals.Object.fromEntries as SandboxClosure;
    expect(() => Reflect.apply(Object.fromEntries, Object, [input])).toThrow(TypeError);
    expect(() => fromEntries.call([input])).toThrow(TypeError);
  });

  it.each(["next", "done", "value", "entry-key", "entry-value", "key-conversion"])(
    "matches native iterator cleanup after %s throws",
    async (failure) => {
      const error = new Error(failure);
      function createIterable(events: string[]) {
        let pulled = false;
        return {
          [Symbol.iterator]() {
            return {
              next() {
                events.push("next");
                if (failure === "next") throw error;
                if (pulled) return { done: true, value: undefined };
                pulled = true;
                return {
                  get done() {
                    if (failure === "done") throw error;
                    return false;
                  },
                  get value() {
                    if (failure === "value") throw error;
                    return {
                      get 0() {
                        if (failure === "entry-key") throw error;
                        return {
                          toString() {
                            if (failure === "key-conversion") throw error;
                            return "key";
                          }
                        };
                      },
                      get 1() {
                        if (failure === "entry-value") throw error;
                        return 1;
                      }
                    };
                  }
                };
              },
              return() {
                events.push("return");
                throw new Error("cleanup must not replace the original error");
              }
            };
          }
        };
      }
      const nativeEvents: string[] = [];
      expect(() =>
        Reflect.apply(Object.fromEntries, Object, [createIterable(nativeEvents)])
      ).toThrow(error);
      const sandboxEvents: string[] = [];
      const globals = createObjectArrayGlobals({ budget: new Budget() });
      const fromEntries = globals.Object.fromEntries as SandboxClosure;
      await expect(
        Promise.resolve().then(() =>
          fromEntries.call([createIterable(sandboxEvents) as unknown as SandboxValue])
        )
      ).rejects.toBe(error);
      expect(sandboxEvents).toEqual(nativeEvents);
    }
  );
});
