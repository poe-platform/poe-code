import { describe, expect, it } from "vitest";

import { Budget } from "./budget.js";
import { createPromiseGlobals } from "./promise.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

describe("generic Promise aggregation", () => {
  it.each(
    ["all", "allSettled", "any", "race"].flatMap((method) =>
      [
        ["fulfill", "fulfill"],
        ["reject", "reject"],
        ["fulfill", "reject"],
        ["reject", "fulfill"]
      ].map((settlements) => ({
        method: method as "all" | "allSettled" | "any" | "race",
        settlements
      }))
    )
  )(
    "$method handles repeated $settlements callbacks like native JavaScript",
    async ({ method, settlements }) => {
      const nativeEvents: unknown[] = [];
      const nativeResult = {};
      function Container(
        executor: (fulfill: (value: unknown) => void, reject: (reason: unknown) => void) => void
      ) {
        executor(
          (value) => nativeEvents.push(["fulfill", value]),
          (reason) =>
            nativeEvents.push(["reject", reason instanceof AggregateError ? reason.errors : reason])
        );
        return nativeResult;
      }
      Container.resolve = (value: number) => ({
        then(fulfill: (value: number) => void, reject: (reason: number) => void) {
          for (const settlement of settlements)
            (settlement === "fulfill" ? fulfill : reject)(value);
        }
      });
      expect(Promise[method].call(Container, [1, 2])).toBe(nativeResult);

      const events: SandboxValue[] = [];
      const result = {};
      const constructor = createSandboxClosure({
        call: () => undefined,
        construct: ([executor]) => {
          if (!isSandboxClosure(executor)) throw new Error("missing executor");
          executor.call([
            createSandboxClosure({
              call: ([value]) => {
                events.push(["fulfill", value]);
                return undefined;
              }
            }),
            createSandboxClosure({
              call: ([reason]) => {
                events.push(["reject", (reason as SandboxObject)?.errors ?? reason]);
                return undefined;
              }
            })
          ]);
          return result;
        },
        properties: {
          resolve: createSandboxClosure({
            call: ([value]) => ({
              then: createSandboxClosure({
                call: async ([fulfill, reject]) => {
                  for (const settlement of settlements) {
                    const callback = settlement === "fulfill" ? fulfill : reject;
                    if (!isSandboxClosure(callback)) throw new Error("missing callback");
                    await callback.call([value]);
                  }
                  return undefined;
                }
              })
            })
          })
        }
      });
      const aggregate = createPromiseGlobals({ budget: new Budget() }).Promise.properties?.[method];
      if (!isSandboxClosure(aggregate)) throw new Error("missing aggregate");
      expect(await aggregate.call([[1, 2]], { stack: [], thisValue: constructor })).toBe(result);
      expect(events).toEqual(nativeEvents);
    }
  );

  it.each(["all", "allSettled", "any", "race"] as const)(
    "%s captures resolve once and closes on resolver failure",
    async (method) => {
      let reads = 0;
      let closed = 0;
      let rejection: SandboxValue;
      const failure = { message: "resolve failed" };
      const result = {};
      const constructor = createSandboxClosure({
        call: () => undefined,
        construct: ([executor]) => {
          if (!isSandboxClosure(executor)) throw new Error("missing executor");
          executor.call([
            createSandboxClosure({ call: () => undefined }),
            createSandboxClosure({
              call: ([reason]) => {
                rejection = reason;
                return undefined;
              }
            })
          ]);
          return result;
        },
        properties: {
          get resolve() {
            reads++;
            return createSandboxClosure({
              call: ([value]) => {
                if (value === 2) throw failure;
                return { then: createSandboxClosure({ call: () => undefined }) };
              }
            });
          }
        }
      });
      const iterable = {
        *[Symbol.iterator]() {
          try {
            yield 1;
            yield 2;
          } finally {
            closed++;
          }
        }
      };
      const aggregate = createPromiseGlobals({ budget: new Budget() }).Promise.properties?.[method];
      if (!isSandboxClosure(aggregate)) throw new Error("missing aggregate");
      expect(await aggregate.call([iterable as never], { stack: [], thisValue: constructor })).toBe(
        result
      );
      expect(rejection).toBe(failure);
      expect(reads).toBe(1);
      expect(closed).toBe(1);
    }
  );

  it.each(["all", "allSettled", "any", "race"] as const)(
    "%s constructs a capability and invokes its resolver during iteration",
    async (method) => {
      const events: SandboxValue[] = [];
      const result: SandboxObject = {};
      const constructor = createSandboxClosure({
        call: () => undefined,
        construct: ([executor]) => {
          events.push("construct");
          if (!isSandboxClosure(executor)) throw new Error("missing executor");
          executor.call([
            createSandboxClosure({
              call: ([value], context) => {
                events.push(["fulfill", context?.thisValue, value]);
                result.value = value;
                return undefined;
              }
            }),
            createSandboxClosure({
              call: ([reason]) => {
                result.reason = reason;
                return undefined;
              }
            })
          ]);
          return result;
        },
        properties: {
          resolve: createSandboxClosure({
            call: ([value], context) => {
              events.push(["resolve", context?.thisValue === constructor, value]);
              return {
                then: createSandboxClosure({
                  call: ([fulfill]) => {
                    if (!isSandboxClosure(fulfill)) throw new Error("missing fulfill");
                    events.push(["then", value]);
                    return fulfill.call([value]);
                  }
                })
              };
            }
          })
        }
      });
      const iterable = {
        *[Symbol.iterator]() {
          events.push("first");
          yield 1;
          events.push("second");
          yield 2;
          events.push("done");
        }
      };
      const globals = createPromiseGlobals({ budget: new Budget() });
      const aggregate = globals.Promise.properties?.[method];
      if (!isSandboxClosure(aggregate)) throw new Error("missing aggregate");
      expect(await aggregate.call([iterable as never], { stack: [], thisValue: constructor })).toBe(
        result
      );
      const prefix: SandboxValue[] = ["construct", "first", ["resolve", true, 1], ["then", 1]];
      const suffix: SandboxValue[] = ["second", ["resolve", true, 2], ["then", 2]];
      if (method === "race" || method === "any") {
        expect(events).toEqual([
          ...prefix,
          ["fulfill", undefined, 1],
          ...suffix,
          ["fulfill", undefined, 2],
          "done"
        ]);
        expect(result.value).toBe(2);
      } else {
        const values =
          method === "all"
            ? [1, 2]
            : [
                { status: "fulfilled", value: 1 },
                { status: "fulfilled", value: 2 }
              ];
        expect(events).toEqual([...prefix, ...suffix, "done", ["fulfill", undefined, values]]);
        expect(result.value).toEqual(values);
      }
    }
  );

  it.each(["all", "allSettled", "any", "race"] as const)(
    "%s rejects a missing static resolver after constructing the capability",
    async (method) => {
      let reason: unknown;
      let iterated = false;
      const result = {};
      const constructor = createSandboxClosure({
        call: () => undefined,
        construct: ([executor]) => {
          if (!isSandboxClosure(executor)) throw new Error("missing executor");
          executor.call([
            createSandboxClosure({ call: () => undefined }),
            createSandboxClosure({
              call: ([error]) => {
                reason = error;
                return undefined;
              }
            })
          ]);
          return result;
        }
      });
      const iterable = {
        *[Symbol.iterator]() {
          iterated = true;
          yield 1;
        }
      };
      const globals = createPromiseGlobals({ budget: new Budget() });
      const aggregate = globals.Promise.properties?.[method];
      if (!isSandboxClosure(aggregate)) throw new Error("missing aggregate");
      expect(await aggregate.call([iterable as never], { stack: [], thisValue: constructor })).toBe(
        result
      );
      expect(reason).toMatchObject({ name: "TypeError" });
      expect(iterated).toBe(false);
    }
  );
});
