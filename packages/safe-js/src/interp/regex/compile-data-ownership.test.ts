import { expect, it } from "vitest";
import { Budget } from "../budget.js";
import {
  createSandboxRegex,
  getSandboxRegexPattern,
  measureSandboxData,
  reconcileCompiledValues
} from "../values.js";
import { RegexCompileGuard, regexCompiledData } from "./compile-guard.js";

it.each(["get", "set"] as const)(
  "keeps regex compile records private from later WeakMap.%s hooks",
  (operation) => {
    const regex = createSandboxRegex("a".repeat(1000));
    const pattern = getSandboxRegexPattern(regex);
    const expected = measureSandboxData([regex]);
    const get = WeakMap.prototype.get;
    const set = WeakMap.prototype.set;
    const exposed: WeakMap<object, unknown>[] = [];
    try {
      if (operation === "get") {
        WeakMap.prototype.get = function (key: object) {
          const value = get.call(this, key);
          if (key === pattern) exposed.push(this);
          return value;
        };
        measureSandboxData([regex]);
      } else {
        WeakMap.prototype.set = function (key: object, value: unknown) {
          if (key === pattern) exposed.push(this);
          return set.call(this, key, value);
        };
        new RegexCompileGuard().retain(pattern);
      }
    } finally {
      WeakMap.prototype.get = get;
      WeakMap.prototype.set = set;
    }
    for (const registry of exposed) set.call(registry, pattern, { units: 0, ticket: undefined });
    for (const held of [false, true]) {
      const budget = new Budget({ dataSize: expected - 1 });
      const release = held ? budget.deferReconciliation() : () => {};
      try {
        expect(() => reconcileCompiledValues(budget, [regex])).toThrow(
          expect.objectContaining({ budget: "dataSize" })
        );
      } finally {
        release();
      }
    }
    expect(measureSandboxData([regex])).toBe(expected);
    expect(exposed).toHaveLength(0);
  }
);

it("does not expose mutable retained compilation charges", () => {
  const regex = createSandboxRegex("a".repeat(1000));
  const expected = measureSandboxData([regex]);
  const data = regexCompiledData(getSandboxRegexPattern(regex));
  expect(Reflect.set(data, "units", 0)).toBe(false);
  expect(measureSandboxData([regex])).toBe(expected);
});

it("does not read inherited ticket metadata on an unregistered pattern", () => {
  const pattern = { ...getSandboxRegexPattern(createSandboxRegex("abc")) };
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "ticket");
  let reads = 0;
  let ticket: unknown;
  try {
    Object.defineProperty(Object.prototype, "ticket", {
      configurable: true,
      get() {
        reads++;
        return "foreign-ticket";
      }
    });
    ticket = regexCompiledData(pattern).ticket;
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "ticket", previous);
    else Reflect.deleteProperty(Object.prototype, "ticket");
  }
  expect(ticket).toBeUndefined();
  expect(reads).toBe(0);
});
