import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each([false, true])(
  "keeps proxy descriptor snapshots private from later Array map hooks (held=%s)",
  (held) => {
    const payload = { text: "x".repeat(1000) };
    const owner = new Proxy({ payload }, {});
    const expected = measureSandboxData([owner]);
    const map = Array.prototype.map;
    const budget = new Budget({ dataSize: 500 });
    const release = held ? budget.deferReconciliation() : undefined;
    let exposed = 0;
    let actual = -1;
    let rejected = false;
    Array.prototype.map = function (callback, thisArg) {
      const result = Reflect.apply(map, this, [callback, thisArg]);
      for (let index = 0; index < result.length; index++) {
        const item: unknown = result[index];
        if (
          typeof item === "object" &&
          item !== null &&
          "value" in item &&
          item.value === payload
        ) {
          exposed++;
          return [];
        }
      }
      return result;
    };
    try {
      actual = measureSandboxData([owner]);
      try {
        reconcileCompiledValues(budget, [owner]);
      } catch (error) {
        rejected = (error as { budget?: string }).budget === "dataSize";
      }
    } finally {
      Array.prototype.map = map;
      release?.();
    }
    expect(expected).toBe(1015);
    expect(actual).toBe(expected);
    expect(rejected).toBe(true);
    expect(exposed).toBe(0);
  }
);

it.each([false, true])(
  "keeps proxy descriptor snapshots private from native Array species (held=%s)",
  (held) => {
    const payload = { text: "x".repeat(1000) };
    const owner = new Proxy({ payload }, {});
    const expected = measureSandboxData([owner]);
    const species = Object.getOwnPropertyDescriptor(Array, Symbol.species)!;
    const budget = new Budget({ dataSize: 500 });
    const release = held ? budget.deferReconciliation() : undefined;
    let exposed = 0;
    let actual = -1;
    let rejected = false;
    Object.defineProperty(Array, Symbol.species, {
      configurable: true,
      value: function (length: number) {
        return new Proxy(new Array(length), {
          defineProperty(target, key, descriptor) {
            if (descriptor.value?.value === payload) {
              exposed++;
              return true;
            }
            return Reflect.defineProperty(target, key, descriptor);
          }
        });
      }
    });
    try {
      actual = measureSandboxData([owner]);
      try {
        reconcileCompiledValues(budget, [owner]);
      } catch (error) {
        rejected = (error as { budget?: string }).budget === "dataSize";
      }
    } finally {
      Object.defineProperty(Array, Symbol.species, species);
      release?.();
    }
    expect(expected).toBe(1015);
    expect(actual).toBe(expected);
    expect(rejected).toBe(true);
    expect(exposed).toBe(0);
  }
);
