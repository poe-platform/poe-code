import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
import { lint } from "./index.js";

describe("function script stress matrix", () => {
  it.each([
    "function recurse() { return recurse(); } return recurse();",
    "const recurse = function inner() { return inner(); }; return recurse();"
  ])("enforces call-depth budgets: %s", async (source) => {
    await expect(run(source, { budget: new Budget({ maxCallDepth: 8 }) })).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "callDepth"
    });
  });

  describe.each([
    {
      name: "factories, lexical arguments, and sort callbacks",
      source: `
        function create(initial) {
          let count = initial;
          const readArgument = () => arguments[0];
          return {
            add: function (amount) { count += amount; },
            read: function () { return [count, readArgument()]; }
          };
        }
        const counters = Array.from({ length: width }, function (unused, index) { return create(index); });
        for (let round = 0; round < width; round += 1) {
          counters.forEach(function (counter) { counter.add(round); });
        }
        function compare(left, right) { return right[0] - left[0]; }
        return counters.map(function (counter) { return counter.read(); }).sort(compare);
      `
    },
    {
      name: "mutual recursion and repeated exception recovery",
      source: `
        function even(value) { return value === 0 ? true : odd(value - 1); }
        function odd(value) { return value === 0 ? false : even(value - 1); }
        let count = 0;
        function check(value) {
          try { if (odd(value)) throw value; return even(value); }
          catch (failure) { return failure; }
          finally { count += 1; }
        }
        const results = Array.from({ length: width }, function (unused, index) { return check(index); });
        return [results, count];
      `
    },
    {
      name: "asynchronous function arguments remain invocation-local",
      source: `
        async function read(value) {
          const captured = () => arguments[0];
          await Promise.resolve();
          arguments[0] += width;
          await Promise.resolve();
          return [value, captured(), arguments.length];
        }
        return await Promise.all(Array.from({ length: width }, function (unused, index) { return read(index); }));
      `
    },
    {
      name: "generators retain arguments through delegated iteration",
      source: `
        function* sequence(initial) {
          for (let index = 0; index < width; index += 1) {
            yield arguments[0] + index;
          }
        }
        function* combined() { yield* sequence(5); yield* sequence(10); }
        return Array.from(combined());
      `
    }
  ])("$name", ({ source }) => {
    it.each([1, 6, 12])("matches native JavaScript at width %i", async (width) => {
      const script = `const width = ${width};\n${source}`;
      const expected = structuredClone(
        await runInNewContext(`(async () => { "use strict"; ${script} })()`)
      );
      expect(lint(script).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      await expect(run(script)).resolves.toMatchObject({ ok: true, returnValue: expected });
    });
  });
});
