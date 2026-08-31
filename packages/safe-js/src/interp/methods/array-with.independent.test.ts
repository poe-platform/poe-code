import { describe, expect, it, vi } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { type SandboxArray, type SandboxValue } from "../values.js";
import { callArrayMethod, type ArrayMethodOptions } from "./array.js";

function options(budget = new Budget()): ArrayMethodOptions {
  return {
    budget,
    callClosure: async () => {
      throw new Error("Unexpected callback");
    }
  };
}

describe("independent bounded Array.prototype.with review", () => {
  it("captures length before a single index conversion that shrinks the source", async () => {
    const source = [10, 20, 30];
    const convert = vi.fn(() => {
      source.length = 1;
      return -1;
    });
    const index = { valueOf: convert } as unknown as SandboxValue;

    await expect(callArrayMethod(source, "with", [index, 99], options())).resolves.toStrictEqual([
      10,
      undefined,
      99
    ]);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(source).toStrictEqual([10]);
  });

  it("uses captured length for range validation when index conversion grows the source", async () => {
    const source = [10, 20, 30];
    const read = vi.fn(() => 10);
    Object.defineProperty(source, "0", { get: read });
    const index = {
      valueOf: () => {
        source.push(40);
        return 3;
      }
    } as unknown as SandboxValue;

    await expect(
      callArrayMethod(source, "with", [index, 99], options(new Budget({ arrayLength: 0 })))
    ).rejects.toThrow(RangeError);
    expect(read).not.toHaveBeenCalled();
    expect(source.length).toBe(4);
  });

  it("propagates index conversion failure even for an empty receiver", async () => {
    const failure = new Error("index conversion failed");
    const convert = vi.fn(() => {
      throw failure;
    });
    const index = { valueOf: convert } as unknown as SandboxValue;
    const budget = new Budget({ arrayLength: 0, maxSteps: 0 });

    await expect(callArrayMethod([], "with", [index, 99], options(budget))).rejects.toBe(failure);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(budget.stepsUsed).toBe(0);
  });

  it("reads ascending indices once, observes deletions, and ignores growth during copying", async () => {
    const source = [1, 2, 3, 4];
    const reads: number[] = [];
    Object.defineProperty(source, "0", {
      get: () => {
        reads.push(0);
        delete source[3];
        source.push(5);
        return 1;
      }
    });
    Object.defineProperty(source, "1", {
      get: () => {
        throw new Error("replacement slot read");
      }
    });
    Object.defineProperty(source, "2", {
      get: () => {
        reads.push(2);
        return 30;
      }
    });

    await expect(callArrayMethod(source, "with", [1, 9], options())).resolves.toStrictEqual([
      1,
      9,
      30,
      undefined
    ]);
    expect(reads).toStrictEqual([0, 2]);
    expect(source.length).toBe(5);
  });

  it("stops on a source read failure without reading later indices", async () => {
    const failure = new Error("source read failed");
    const source = [1, 2, 3];
    const laterRead = vi.fn(() => 3);
    Object.defineProperty(source, "1", {
      get: () => {
        throw failure;
      }
    });
    Object.defineProperty(source, "2", { get: laterRead });
    const budget = new Budget();

    await expect(callArrayMethod(source, "with", [0, 9], options(budget))).rejects.toBe(failure);
    expect(laterRead).not.toHaveBeenCalled();
    expect(source[0]).toBe(1);
    expect(budget.stepsUsed).toBe(2);
  });

  it.each([
    [0, []],
    [1, [0]],
    [2, [0]],
    [3, [0, 2]]
  ] as const)(
    "checks step limit %i before the next source read",
    async (maxSteps, expectedReads) => {
      const source = [10, 20, 30, 40];
      const reads: number[] = [];
      for (let position = 0; position < source.length; position += 1) {
        Object.defineProperty(source, position, {
          get: () => {
            reads.push(position);
            return (position + 1) * 10;
          }
        });
      }
      const budget = new Budget({ maxSteps });

      await expect(callArrayMethod(source, "with", [1, 99], options(budget))).rejects.toMatchObject(
        {
          code: "budgetExceeded",
          budget: "steps",
          current: maxSteps + 1
        }
      );
      expect(reads).toStrictEqual(expectedReads);
    }
  );

  it("interrupts a copy at the existing sampled deadline boundary", async () => {
    const source = [10, 20, 30, 40, 50, 60];
    const reads: number[] = [];
    for (let position = 0; position < source.length; position += 1) {
      Object.defineProperty(source, position, {
        get: () => {
          reads.push(position);
          return position;
        }
      });
    }
    const budget = new Budget({ deadline: 1 });
    for (let visit = 0; visit < 1_020; visit += 1) budget.visitNode();

    await expect(callArrayMethod(source, "with", [2, 99], options(budget))).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "deadline"
    });
    expect(reads).toStrictEqual([0, 1]);
    expect(budget.stepsUsed).toBe(1_024);
  });

  it("preflights a maximal sparse array without beginning traversal", async () => {
    const source = new Array(2 ** 32 - 1) as SandboxArray;
    const budget = new Budget({ arrayLength: 8, maxSteps: 0 });

    await expect(callArrayMethod(source, "with", [-1, 9], options(budget))).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "arrayLength",
      current: 2 ** 32 - 1
    });
    expect(budget.stepsUsed).toBe(0);
    expect(Object.keys(source)).toStrictEqual([]);
  });

  it("evaluates the receiver and all arguments before converting an array index", async () => {
    await expect(
      run(
        `
        const source = [10, 20, 30];
        const index = [1];
        const events = [];
        function receiver() { events.push("receiver"); return source; }
        function argument(label, value) { events.push(label); return value; }
        function extra() { events.push("extra"); index.push(2); return 100; }
        const result = receiver().with(argument("index", index), argument("value", 99), extra());
        return { source, result, events, index };
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: {
        source: [10, 20, 30],
        result: [99, 20, 30],
        events: ["receiver", "index", "value", "extra"],
        index: [1, 2]
      }
    });
  });
});
