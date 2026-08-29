import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget, SandboxError } from "../budget.js";
import {
  createSandboxMap,
  createSandboxSet,
  isSandboxClosure,
  isSandboxGenerator,
  type SandboxValue
} from "../values.js";
import { createObjectArrayGlobals } from "./object-array.js";

const limits = {
  maxSteps: 20000,
  maxCallDepth: 48,
  stringLength: 16384,
  arrayLength: 512,
  dataSize: 500000
};

describe("OBJ-003 independent supported-iterable validation", () => {
  it.each([
    { kind: "Map", input: "new Map(pairs)" },
    { kind: "Map entries iterator", input: "new Map(pairs).entries()" },
    { kind: "Set", input: "new Set(pairs)" },
    { kind: "generator", input: "enumerate()" },
    { kind: "array control", input: "pairs" }
  ])("preserves supplied nested references and snapshots $kind membership", async ({ input }) => {
    const source = `
      const shared = { count: 2 };
      const list = [shared];
      const pairs = [["first", shared], ["second", shared], ["list", list]];
      function* enumerate() { for (const pair of pairs) yield pair; }
      const before = [pairs[0][1] === shared, pairs[1][1] === shared, pairs[2][1] === list];
      const input = ${input};
      const output = Object.fromEntries(input);
      const after = [output.first === shared, output.second === shared, output.list === list, output.list[0] === shared];
      shared.count = 5;
      const sourceMutation = [output.first.count, output.second.count, output.list[0].count];
      output.second.count = 8;
      output.list.push({ count: 9 });
      const resultMutation = [shared.count, pairs[0][1].count, list.length];
      pairs[0][0] = "renamed";
      pairs[0][1] = { count: 100 };
      pairs.push(["later", null]);
      output.second = { count: 200 };
      return { before, after, sourceMutation, resultMutation,
        keys: Object.keys(output), retained: output.first === shared,
        inputUnchanged: pairs[1][1] === shared };
    `;
    const expected = {
      before: [true, true, true],
      after: [true, true, true, true],
      sourceMutation: [5, 5, 5],
      resultMutation: [8, 8, 2],
      keys: ["first", "second", "list"],
      retained: true,
      inputUnchanged: true
    };
    expect(new Function(source)()).toEqual(expected);
    const result = await run(source, {
      budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Iterable reference workflow failed");
    expect(result.returnValue).toEqual(expected);
  });

  it("processes a reused generator pair before requesting its next entry", async () => {
    const source = `
      const first = { count: 1 };
      const last = { count: 4 };
      const pair = ["first", first];
      const events = [];
      function* entries() {
        events.push("start");
        yield pair;
        pair[0] = "chosen";
        pair[1] = last;
        events.push("second");
        yield pair;
        pair[0] = "first";
        events.push("duplicate");
        yield pair;
        events.push("done");
        return ["ignored", 99];
      }
      const output = Object.fromEntries(entries());
      output.chosen.count = 8;
      return { keys: Object.keys(output), events,
        lastWins: output.first === last, chosenAlias: output.chosen === last,
        firstCount: first.count, lastCount: last.count,
        ignored: Object.hasOwn(output, "ignored") };
    `;
    const expected = {
      keys: ["first", "chosen"],
      events: ["start", "second", "duplicate", "done"],
      lastWins: true,
      chosenAlias: true,
      firstCount: 1,
      lastCount: 8,
      ignored: false
    };
    expect(new Function(source)()).toEqual(expected);
    const result = await run(source, {
      budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Incremental generator workflow failed");
    expect(result.returnValue).toEqual(expected);
  });

  it("retains integer-key order, last duplicate references and missing-value membership", async () => {
    const source = `
      const first = { count: 1 };
      const last = { count: 2 };
      function* entries() {
        yield [10, "ten"];
        yield ["alpha", first];
        yield [2, "two"];
        yield { 0: "missing" };
        yield ["alpha", last];
        yield ["omega", first];
      }
      const output = Object.fromEntries(entries());
      return [Object.keys(output), output.alpha === last, output.omega === first,
        output.alpha !== output.omega, Object.hasOwn(output, "missing"), output.missing];
    `;
    const expected = [["2", "10", "alpha", "missing", "omega"], true, true, true, true, undefined];
    expect(new Function(source)()).toEqual(expected);
    const result = await run(source, {
      budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Duplicate key workflow failed");
    expect(result.returnValue).toEqual(expected);
  });

  it("resumes an existing generator position and does not return it after normal exhaustion", async () => {
    const source = `
      const events = [];
      function* entries() {
        try {
          events.push("skip"); yield ["skip", 0];
          events.push("keep"); yield ["keep", 1];
          events.push("exhausted");
        } finally { events.push("finally"); }
      }
      const iterator = entries();
      const skipped = iterator.next().value;
      const output = Object.fromEntries(iterator);
      const empty = Object.fromEntries(iterator);
      return [skipped, output, empty, events, iterator.next().done];
    `;
    const expected = [["skip", 0], { keep: 1 }, {}, ["skip", "keep", "exhausted", "finally"], true];
    expect(new Function(source)()).toEqual(expected);
    const result = await run(source, {
      budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Generator position workflow failed");
    expect(result.returnValue).toEqual(expected);
  });

  it.each([
    {
      name: "plain finally",
      cleanup: 'events.push("closed");',
      after: ["start", "invalid", "closed"]
    },
    {
      name: "throwing finally",
      cleanup: 'events.push("closed"); throw new Error("cleanup");',
      after: ["start", "invalid", "closed"]
    },
    {
      name: "yielding finally",
      cleanup: 'events.push("closed"); yield ["cleanup", 9]; events.push("resumed");',
      after: ["start", "invalid", "closed", "resumed"]
    }
  ])("matches native abrupt generator cleanup with $name", async ({ cleanup, after }) => {
    const source = `
      const events = [];
      function* entries() {
        try {
          events.push("start"); yield ["valid", 1];
          events.push("invalid"); yield 7;
          events.push("unreachable"); yield ["later", 2];
        } finally { ${cleanup} }
      }
      const iterator = entries();
      let caught;
      try { Object.fromEntries(iterator); } catch (error) { caught = error.name; }
      const beforeResume = events.slice();
      const resumed = iterator.next();
      return [caught, beforeResume, events, resumed.done];
    `;
    const expected = ["TypeError", ["start", "invalid", "closed"], after, true];
    expect(new Function(source)()).toEqual(expected);
    const result = await run(source, {
      budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Abrupt cleanup workflow failed");
    expect(result.returnValue).toEqual(expected);
  });

  it("reads iterator and entry fields in native order without precollecting or closing exhaustion", async () => {
    function fixture(events: string[]) {
      let position = 0;
      const first = { count: 1 };
      const last = { count: 2 };
      const iterable = {
        get [Symbol.iterator]() {
          events.push("iterator");
          return function () {
            events.push("open");
            return {
              get next() {
                events.push("get-next");
                return function () {
                  const current = position++;
                  events.push(`next:${current}`);
                  return {
                    get done() {
                      events.push(`done:${current}`);
                      return current === 2;
                    },
                    get value() {
                      events.push(`value:${current}`);
                      if (current === 2) throw new Error("Exhausted values must not be read");
                      return {
                        get 0() {
                          events.push(`key:${current}`);
                          return {
                            toString() {
                              events.push(`coerce:${current}`);
                              return "chosen";
                            }
                          };
                        },
                        get 1() {
                          events.push(`entry:${current}`);
                          return current === 0 ? first : last;
                        }
                      };
                    }
                  };
                };
              },
              get return() {
                events.push("get-return");
                throw new Error("Normal exhaustion must not close");
              }
            };
          };
        }
      };
      return { iterable, first, last };
    }
    const expectedEvents = [
      "iterator",
      "open",
      "get-next",
      "next:0",
      "done:0",
      "value:0",
      "key:0",
      "entry:0",
      "coerce:0",
      "next:1",
      "done:1",
      "value:1",
      "key:1",
      "entry:1",
      "coerce:1",
      "next:2",
      "done:2"
    ];
    const nativeEvents: string[] = [];
    const native = fixture(nativeEvents);
    const expected = Reflect.apply(Object.fromEntries, Object, [native.iterable]);
    expect(nativeEvents).toEqual(expectedEvents);
    expect(expected.chosen).toBe(native.last);
    const events: string[] = [];
    const input = fixture(events);
    const transform = createObjectArrayGlobals({ budget: new Budget(limits) }).Object.fromEntries;
    if (!isSandboxClosure(transform)) throw new Error("Missing fromEntries closure");
    const result = await transform.call([input.iterable as unknown as SandboxValue]);
    expect(events).toEqual(expectedEvents);
    expect(result).toEqual(expected);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect((result as { chosen: unknown }).chosen).toBe(input.last);
    expect(input.first.count).toBe(1);
  });

  it.each(["next", "entry-value"])(
    "preserves the original %s failure even if return lookup throws",
    async (failure) => {
      const original = new Error("original");
      const cleanup = new Error("cleanup");
      function fixture(events: string[]) {
        return {
          [Symbol.iterator]() {
            return {
              next() {
                events.push("next");
                if (failure === "next") throw original;
                return {
                  done: false,
                  value: {
                    0: "key",
                    get 1() {
                      events.push("entry-value");
                      throw original;
                    }
                  }
                };
              },
              get return() {
                events.push("return-lookup");
                throw cleanup;
              }
            };
          }
        };
      }
      const expectedEvents =
        failure === "next" ? ["next", "return-lookup"] : ["next", "entry-value", "return-lookup"];
      const nativeEvents: string[] = [];
      expect(() => Reflect.apply(Object.fromEntries, Object, [fixture(nativeEvents)])).toThrow(
        original
      );
      expect(nativeEvents).toEqual(expectedEvents);
      const events: string[] = [];
      const transform = createObjectArrayGlobals({ budget: new Budget(limits) }).Object.fromEntries;
      if (!isSandboxClosure(transform)) throw new Error("Missing fromEntries closure");
      await expect(
        Promise.resolve().then(() => transform.call([fixture(events) as unknown as SandboxValue]))
      ).rejects.toBe(original);
      expect(events).toEqual(expectedEvents);
    }
  );
});

describe("OBJ-003 merged adapter timing", () => {
  const inputs = [
    { name: "array", create: (pairs: Array<[SandboxValue, SandboxValue]>) => pairs },
    {
      name: "Map",
      create: (pairs: Array<[SandboxValue, SandboxValue]>) => createSandboxMap(pairs)
    },
    {
      name: "Set",
      create: (pairs: Array<[SandboxValue, SandboxValue]>) => createSandboxSet(pairs)
    },
    {
      name: "host synchronous iterable",
      create: (pairs: Array<[SandboxValue, SandboxValue]>) =>
        ({
          *[Symbol.iterator]() {
            for (const pair of pairs) yield pair;
          }
        }) as unknown as SandboxValue
    }
  ];

  it.each(inputs)(
    "returns $name results synchronously without copying supplied values",
    async ({ create }) => {
      const shared = { count: 2 };
      const transform = createObjectArrayGlobals({ budget: new Budget(limits) }).Object.fromEntries;
      if (!isSandboxClosure(transform)) throw new Error("Missing fromEntries closure");
      const result = transform.call([
        create([
          ["first", shared],
          ["second", shared]
        ])
      ]);
      if (result instanceof Promise) await result;
      expect(result).not.toBeInstanceOf(Promise);
      expect(Object.getPrototypeOf(result)).toBeNull();
      const output = result as { first: { count: number }; second: { count: number } };
      expect(output.first).toBe(shared);
      expect(output.second).toBe(shared);
      output.first.count = 7;
      expect(shared.count).toBe(7);
    }
  );

  it.each(inputs)(
    "throws $name allocation failures synchronously rather than rejecting later",
    async ({ create }) => {
      const transform = createObjectArrayGlobals({ budget: new Budget({ arrayLength: 1 }) }).Object
        .fromEntries;
      if (!isSandboxClosure(transform)) throw new Error("Missing fromEntries closure");
      let returned: SandboxValue | Promise<SandboxValue>;
      let synchronousError: unknown;
      try {
        returned = transform.call([create([["nested", [1, 2]]])]);
      } catch (error) {
        synchronousError = error;
      }
      if (returned instanceof Promise) await returned.catch(() => undefined);
      expect(returned).toBeUndefined();
      expect(synchronousError).toBeInstanceOf(SandboxError);
      expect(synchronousError).toMatchObject({
        code: "budgetExceeded",
        budget: "arrayLength",
        current: 2,
        limit: 1
      });
    }
  );

  it.each([
    { name: "successful result", arrayLength: 2, rejects: false },
    { name: "allocation rejection", arrayLength: 1, rejects: true }
  ])(
    "keeps sandbox-generator $name on its asynchronous channel",
    async ({ arrayLength, rejects }) => {
      const prepared = await run(
        'function* entries() { yield ["nested", [1, 2]]; } return entries();',
        {
          budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
        }
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok || !isSandboxGenerator(prepared.returnValue))
        throw new Error("Expected sandbox generator");
      const generator = prepared.returnValue;
      const transform = createObjectArrayGlobals({ budget: new Budget({ arrayLength }) }).Object
        .fromEntries;
      if (!isSandboxClosure(transform)) throw new Error("Missing fromEntries closure");
      let returned: SandboxValue | Promise<SandboxValue>;
      let synchronousError: unknown;
      let rejection: unknown;
      let resolved: SandboxValue;
      try {
        returned = transform.call([generator]);
      } catch (error) {
        synchronousError = error;
      }
      if (returned instanceof Promise) {
        try {
          resolved = await returned;
        } catch (error) {
          rejection = error;
        }
      }
      expect(synchronousError).toBeUndefined();
      expect(returned).toBeInstanceOf(Promise);
      expect(generator.state).toBe("done");
      if (rejects) {
        expect(rejection).toBeInstanceOf(SandboxError);
        expect(rejection).toMatchObject({
          code: "budgetExceeded",
          budget: "arrayLength",
          current: 2,
          limit: 1
        });
        expect(resolved).toBeUndefined();
      } else {
        expect(rejection).toBeUndefined();
        expect(resolved).toEqual({ nested: [1, 2] });
        expect(Object.getPrototypeOf(resolved)).toBeNull();
      }
    }
  );
});
