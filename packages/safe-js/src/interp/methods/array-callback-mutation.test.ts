import { describe, expect, it, vi } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { enterRunningState } from "../running-state.js";
import { createSandboxClosure, measureSandboxData, type SandboxValue } from "../values.js";
import { callArrayMethod, type ArrayMethodName, type ArrayMethodOptions } from "./array.js";

const callbackMethods = [
  "map",
  "filter",
  "forEach",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "flatMap",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex"
] as const;

function callbackCall(method: string): string {
  if (method === "reduce" || method === "reduceRight") {
    return `values.${method}((total, entry, index, receiver) => total + visit(entry, index, receiver), 0)`;
  }
  return `values.${method}(visit, context)`;
}

async function expectNative(source: string): Promise<void> {
  const expected: unknown = Function('"use strict";\n' + source)();
  const result = await run(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected successful array callback execution");
  expect(structuredClone(result.returnValue)).toStrictEqual(expected);
}

describe.each(callbackMethods)("%s callback mutation", (method) => {
  it.each([
    { name: "append", mutation: "receiver.push(8, 9);" },
    { name: "delete", mutation: "delete receiver[2]; delete receiver[0];" },
    { name: "splice", mutation: "receiver.splice(1, 1, 7, 8);" },
    { name: "truncate", mutation: "receiver.length = 1;" },
    { name: "extend", mutation: "receiver.length = 6; receiver[1] = 7; receiver[5] = 8;" }
  ])("preserves native length and hole rules after $name", async ({ mutation }) => {
    const returned =
      method === "some" || method.startsWith("find")
        ? "false"
        : method === "every" || method === "filter"
          ? "true"
          : method === "flatMap"
            ? "[entry, , index]"
            : "entry";
    await expectNative(`
      const values = [1, , 3, 4];
      const alias = values;
      const context = { label: "receiver" };
      const visits = [];
      let first = true;
      function visit(entry, index, receiver) {
        visits.push([entry, index, receiver === alias, Object.hasOwn(receiver, index)]);
        if (first) {
          first = false;
          ${mutation}
        }
        return ${returned};
      }
      const result = ${callbackCall(method)};
      return { result, visits, values, keys: Object.keys(values), same: values === alias };
    `);
  });
});

describe("array callback native value capture", () => {
  it("reduces the dispatch witness without visiting appended or deleted entries", async () => {
    const result = await run(`
      const values = [1, 2, 3];
      const visits = [];
      const total = values.reduce((sum, entry, index, receiver) => {
        visits.push(entry);
        if (index === 0) {
          receiver.push(4);
          delete receiver[1];
          receiver[2] = 9;
        }
        return sum + entry;
      }, 0);
      return { total, visits, values, keys: Object.keys(values) };
    `);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected successful reduction");
    const expectedValues = [1, 2, 9, 4];
    delete expectedValues[1];
    expect(structuredClone(result.returnValue)).toStrictEqual({
      total: 10,
      visits: [1, 9],
      values: expectedValues,
      keys: ["0", "2", "3"]
    });
  });

  it.each(["filter", "find", "findLast"])(
    "%s returns the pre-callback entry after deletion or replacement",
    async (method) => {
      await expectNative(`
        const original = { score: 2 };
        const values = [original];
        const result = values.${method}((entry, index, receiver) => {
          entry.score = 7;
          receiver[index] = { score: 9 };
          delete receiver[index];
          return true;
        });
        const captured = ${method === "filter" ? "result[0]" : "result"};
        return { result, same: captured === original, values, keys: Object.keys(values) };
      `);
    }
  );

  it.each(["some", "every", "find", "findIndex", "findLast", "findLastIndex"])(
    "%s short-circuits after the matching callback mutates the receiver",
    async (method) => {
      await expectNative(`
        const values = [1, , 3];
        const visits = [];
        const result = values.${method}((entry, index, receiver) => {
          visits.push([entry, index]);
          receiver.length = 0;
          receiver.push(9);
          return ${method === "every" ? "false" : "true"};
        });
        return { result, visits, values };
      `);
    }
  );

  it.each(["reduce", "reduceRight"])(
    "%s selects the initial present accumulator before callback mutation",
    async (method) => {
      await expectNative(`
        const values = [, 2, , 4, 5, ];
        const visits = [];
        const total = values.${method}((sum, entry, index, receiver) => {
          visits.push([sum, entry, index]);
          receiver.push(9);
          delete receiver[1];
          receiver[3] = 7;
          return sum + entry;
        });
        return { total, visits, values };
      `);
    }
  );

  it.each(["reduce", "reduceRight"])(
    "%s ignores negative metadata when there are no present indices",
    async (method) => {
      await expectNative(`
        const values = new Array(3);
        values[-1] = 9;
        let calls = 0;
        function visit(total, entry) { calls += 1; return entry; }
        const initial = values.${method}(visit, undefined);
        let failure;
        try { values.${method}(visit); } catch (error) { failure = error.name; }
        return { initial, calls, failure, values };
      `);
    }
  );

  it.each(callbackMethods.filter((method) => method !== "reduce" && method !== "reduceRight"))(
    "%s preserves thisArg while mutating an aliased receiver",
    async (method) => {
      await expectNative(`
        const values = [1, 2];
        const context = { count: 0 };
        const visits = [];
        function visit(entry, index, receiver) {
          visits.push(this === context);
          this.count += 1;
          receiver.push(entry + 5);
          return entry;
        }
        const result = ${callbackCall(method)};
        return { result, visits, context, values };
      `);
    }
  );

  it("preserves method shadowing, own metadata, aliases, and independent nested ranges", async () => {
    await expectNative(`
      const values = [1, 2];
      const alias = values;
      const savedMap = values.map;
      const visits = [];
      values.note = { count: 0 };
      const mapped = savedMap.call(alias, (entry, index, receiver) => {
        if (index === 0) {
          receiver.map = function () { return this.note.count; };
          receiver.push(3);
          receiver.forEach((nested, position, original) => {
            visits.push([nested, position, original === alias]);
            original.note.count += 1;
            if (position === 0) original.push(4);
          });
        }
        return entry * 2;
      });
      const shadowed = values.map();
      delete values.map;
      return { mapped, visits, shadowed, values, keys: Object.keys(values), same: alias === values };
    `);
  });

  it.each(["map", "reduce", "sort"])(
    "%s preserves thrown identity and preceding mutations",
    async (method) => {
      await expectNative(`
      const values = [3, 1, 2];
      const sentinel = { message: "stopped" };
      let caught = false;
      let calls = 0;
      try {
        values.${method}(() => {
          calls += 1;
          values.push(7);
          delete values[1];
          throw sentinel;
        }, 0);
      } catch (failure) { caught = failure === sentinel; }
      values.push(8);
      return { caught, calls, values, keys: Object.keys(values) };
    `);
    }
  );

  it.each(["receiver[0] = 9", "delete receiver[0]", "receiver.push(9)"])(
    "retains native frozen-array abrupt completion for %s",
    async (mutation) => {
      await expectNative(`
        const values = Object.freeze([1, 2]);
        const visits = [];
        let failure;
        try {
          values.map((entry, index, receiver) => {
            visits.push([entry, index]);
            ${mutation};
            return entry;
          });
        } catch (error) { failure = error.name; }
        return { failure, visits, values };
      `);
    }
  );

  it("mutates only the sandbox-owned copy of an injected array", async () => {
    const input = [1, 2, 3];
    const result = await run(
      `
      const alias = input;
      const mapped = input.map((entry, index, receiver) => {
        if (index === 0) { receiver.push(4); delete alias[1]; }
        return entry;
      });
      return { mapped, input, same: alias === input };
    `,
      { bindings: { input } }
    );
    expect(input).toStrictEqual([1, 2, 3]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful sandbox mutation");
    const expectedMapped = [1, 2, 3];
    const expectedInput = [1, 2, 3, 4];
    delete expectedMapped[1];
    delete expectedInput[1];
    expect(structuredClone(result.returnValue)).toStrictEqual({
      mapped: expectedMapped,
      input: expectedInput,
      same: true
    });
  });
});

describe("bounded sort comparator mutation", () => {
  it.each([
    "values.push(9); values[0] = 8; delete values[2];",
    "values.length = 1;",
    "values.length = 6; values[5] = 7; values[3] = 8;"
  ])("sort snapshots items and writes/deletes only the initial range: %s", async (mutation) => {
    await expectNative(`
      const values = [3, , 1, undefined];
      let changed = false;
      const sorted = values.sort((left, right) => {
        if (!changed) { changed = true; ${mutation} }
        return left - right;
      });
      return { values, keys: Object.keys(values), same: sorted === values, changed };
    `);
  });

  it("toSorted keeps its dense copied items while the comparator changes the source", async () => {
    await expectNative(`
      const values = [3, , 1, undefined];
      let changed = false;
      const sorted = values.toSorted((left, right) => {
        if (!changed) { changed = true; values.length = 1; values.push(9); }
        return left - right;
      });
      return { values, sorted, keys: Object.keys(sorted), same: sorted === values, changed };
    `);
  });

  it("checks consistent stability and a finite mutating tie example without comparison traces", async () => {
    await expectNative(`
      const values = [{ key: 2, id: "first" }, { key: 1, id: "second" }, { key: 2, id: "third" }];
      values.sort((left, right) => left.key - right.key);
      return values;
    `);
    await expectNative(`
      const values = [{ key: 2, id: "first" }, { key: 1, id: "second" }, { key: 2, id: "third" }];
      let changed = false;
      values.sort((left, right) => {
        if (!changed) { changed = true; values.push({ key: 0, id: "tail" }); }
        return left.key - right.key;
      });
      return values;
    `);
  });
});

describe("array callback budgets and explicit running guards", () => {
  it.each(["map", "reduce", "sort"])(
    "bounds public native callback invocations in %s",
    async (method) => {
      const source = `return [3, 2, 1].${method}(visit, 0);`;
      const measured = new Budget();
      const steps: number[] = [];
      const baseline = await run(source, {
        budget: measured,
        bindings: {
          visit: () => {
            steps.push(measured.stepsUsed);
            return 1;
          }
        }
      });
      expect(baseline.ok).toBe(true);
      expect(steps.length).toBeGreaterThan(1);
      const visit = vi.fn(() => 1);
      await expect(
        run(source, {
          budget: new Budget({ maxSteps: steps[0] }),
          bindings: { visit }
        })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
      expect(visit).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["map", "filter", "flatMap", "reduce", "reduceRight"] as const)(
    "%s keeps intermediate results in data-budget roots until completion",
    async (method) => {
      const budget = new Budget();
      const retained = { label: "first" };
      const input: SandboxValue[] = method === "filter" ? [retained, 2] : [1, 2];
      let calls = 0;
      const callback = createSandboxClosure({
        call: () => {
          calls += 1;
          if (calls === 2) {
            expect(measureSandboxData(budget.retainedValues())).toBeGreaterThanOrEqual(
              measureSandboxData([retained])
            );
          }
          if (calls === 1) delete input[method === "reduceRight" ? 1 : 0];
          return method === "filter" ? true : method === "flatMap" ? [retained] : retained;
        }
      });
      const options: ArrayMethodOptions = {
        budget,
        callClosure: async (closure, args) => closure.call(args)
      };
      await callArrayMethod(input, method, [callback, 0], options);
      expect(calls).toBe(2);
      expect([...budget.retainedValues()]).toStrictEqual([]);
    }
  );

  it.each(["map", "filter", "flatMap", "reduce", "reduceRight", "sort"] as const)(
    "%s releases retained roots after a thrown callback",
    async (method) => {
      const budget = new Budget();
      const failure = new Error("stopped");
      const callback = createSandboxClosure({
        call: () => {
          throw failure;
        }
      });
      const options: ArrayMethodOptions = {
        budget,
        callClosure: async (closure, args) => closure.call(args)
      };
      await expect(callArrayMethod([2, 1], method, [callback, 0], options)).rejects.toBe(failure);
      expect([...budget.retainedValues()]).toStrictEqual([]);
    }
  );

  it("charges captured sort items after the comparator removes their source references", async () => {
    const budget = new Budget({ dataSize: 25 });
    const values = [{ rank: 3 }, { rank: 1 }, { rank: 2 }];
    const callback = createSandboxClosure({
      call: () => {
        values.length = 0;
        budget.reconcileDataUsage(
          measureSandboxData([values, [1, 2, 3], ...budget.retainedValues()])
        );
        return 1;
      }
    });
    const options: ArrayMethodOptions = {
      budget,
      callClosure: async (closure, args) => closure.call(args)
    };
    await expect(callArrayMethod(values, "sort", [callback], options)).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
    expect(values).toStrictEqual([]);
    expect([...budget.retainedValues()]).toStrictEqual([]);
    expect(() => enterRunningState(values)()).not.toThrow();
  });

  it.each(["map", "reduce", "sort"])(
    "preserves the public step budget during %s mutation",
    async (method) => {
      await expect(
        run(
          `
      const values = [3, 1, 2];
      return values.${method}(() => { values.push(4); return 1; }, 0);
    `,
          { budget: new Budget({ maxSteps: 35 }) }
        )
      ).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "steps"
      });
    }
  );

  it("preserves the array-length limit on callback growth", async () => {
    await expect(
      run(
        `
      const values = [1, 2];
      return values.map(entry => { values.push(3, 4); return entry; });
    `,
        { budget: new Budget({ arrayLength: 3 }) }
      )
    ).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "arrayLength"
    });
  });

  it.each(callbackMethods)(
    "charges finite sparse %s traversal to the step budget",
    async (method) => {
      const values = new Array(4) as SandboxValue[];
      const callback = createSandboxClosure({ call: () => false });
      const options: ArrayMethodOptions = {
        budget: new Budget({ maxSteps: 2 }),
        callClosure: async (closure, args) => closure.call(args)
      };
      await expect(callArrayMethod(values, method, [callback, 0], options)).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "steps"
      });
      expect(() => enterRunningState(values)()).not.toThrow();
    }
  );

  it.each<ArrayMethodName>(["map", "sort"])(
    "does not bypass an explicit running guard for %s",
    async (method) => {
      const values = [2, 1];
      const options: ArrayMethodOptions = {
        budget: new Budget(),
        callClosure: async (closure, args) => closure.call(args)
      };
      const callback = createSandboxClosure({ call: () => 1 });
      const leave = enterRunningState(values);
      try {
        await expect(callArrayMethod(values, method, [callback], options)).rejects.toMatchObject({
          code: "reentry"
        });
      } finally {
        leave();
      }
      await expect(callArrayMethod(values, "push", [3], options)).resolves.toBe(3);
    }
  );
});
