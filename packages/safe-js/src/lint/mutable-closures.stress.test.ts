import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
import { lint } from "./index.js";

const scripts = [
  {
    name: "independent factory state with sibling readers and writers",
    source: `
      const create = (initial) => {
        let count = initial;
        return { read: () => count, add: (amount) => { count += amount; } };
      };
      const counters = Array.from({ length: width }, (_, index) => create(index));
      for (let round = 0; round < width; round += 1) {
        counters.forEach((counter, index) => counter.add(round + index));
      }
      return counters.map((counter) => counter.read());
    `
  },
  {
    name: "for-of captures and mutations remain per-iteration",
    source: `
      const callbacks = [];
      for (let value of Array.from({ length: width }, (_, index) => index)) {
        callbacks.push(() => { value += width; return value; });
      }
      const first = callbacks.map((callback) => callback());
      const second = callbacks.map((callback) => callback());
      return [first, second];
    `
  },
  {
    name: "closures retain catch bindings and finally mutations",
    source: `
      const callbacks = [];
      let count = 0;
      for (let index = 0; index < width; index += 1) {
        try { throw index; }
        catch (failure) { callbacks.push(() => { failure += 1; return failure + count; }); }
        finally { count += 1; }
      }
      return [callbacks.map((callback) => callback()), callbacks.map((callback) => callback())];
    `
  },
  {
    name: "captured bindings can be rebound to new closures",
    source: `
      let callback = () => 0;
      const read = () => callback();
      const values = [];
      for (let index = 0; index < width; index += 1) {
        callback = () => index;
        values.push(read());
      }
      return [values, read()];
    `
  },
  {
    name: "default closures observe later writes to destructured parameters",
    source: `
      const create = ({ count }, read = () => count) => {
        return { read, add: () => { count += width; } };
      };
      const counters = Array.from({ length: width }, (_, index) => create({ count: index }));
      counters.forEach((counter) => counter.add());
      return counters.map((counter) => counter.read());
    `
  },
  {
    name: "asynchronous branches share state across repeated yields",
    source: `
      let count = 0;
      const add = async (amount) => {
        for (let round = 0; round < 4; round += 1) {
          await Promise.resolve();
          count += amount;
        }
      };
      await Promise.all(Array.from({ length: width }, (_, index) => add(index + 1)));
      return count;
    `
  },
  {
    name: "nested loop captures survive continue and break",
    source: `
      const readers = [];
      for (let outer = 0; outer < width; outer += 1) {
        for (let inner = 0; inner < width; inner += 1) {
          if (inner % 2 === 0) continue;
          readers.push(() => [outer, inner]);
          if (inner > 4) break;
        }
      }
      return readers.map((read) => read());
    `
  },
  {
    name: "recursive mutable bindings and aliases remain live",
    source: `
      let recurse;
      let calls = 0;
      const invoke = (depth) => recurse(depth);
      recurse = (depth) => { calls += 1; return depth === 0 ? calls : invoke(depth - 1); };
      return [invoke(width), invoke(width), calls];
    `
  }
];

describe("mutable closure script stress matrix", () => {
  describe.each(scripts)("$name", ({ source }) => {
    it.each([1, 7, 24])("matches native JavaScript at width %i", async (width) => {
      const script = `const width = ${width};\n${source}`;
      const expected = structuredClone(await runInNewContext(`(async () => { ${script} })()`));
      expect(lint(script).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      await expect(run(script)).resolves.toMatchObject({ ok: true, returnValue: expected });
    });
  });

  it("cannot hide an unbounded loop behind a mutable closure", async () => {
    await expect(
      run("let count = 0; const step = () => { count += 1; }; while (true) { step(); }", {
        budget: new Budget({ maxSteps: 200 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
