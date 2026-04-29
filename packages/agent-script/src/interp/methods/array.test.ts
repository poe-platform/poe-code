import { describe, expect, it } from "vitest";

import { Budget, SandboxError } from "../budget.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxValue
} from "../values.js";
import { callArrayMethod, getArrayMember } from "./array.js";

describe("array methods", () => {
  it("exposes intercepted array members", () => {
    const values = [1, 2, 3];
    const options = createOptions(new Budget());

    expect(getArrayMember(values, "length", options)).toBe(3);
    expect(isSandboxClosure(getArrayMember(values, "map", options))).toBe(true);
    expect(getArrayMember(values, "missing", options)).toBeUndefined();
  });

  it("supports callback-driven array methods", async () => {
    const budget = new Budget();
    const options = createOptions(budget);
    const values = [1, 2, 3];
    const seen: Array<readonly SandboxValue[]> = [];

    const double = createSandboxClosure({
      call: ([value, index, array]) => {
        seen.push([value, index, array]);
        return Number(value) * 2;
      },
      name: "double"
    });
    const isEven = createSandboxClosure({
      call: ([value]) => Number(value) % 2 === 0,
      name: "isEven"
    });
    const pickTwo = createSandboxClosure({
      call: ([value]) => Number(value) === 2,
      name: "pickTwo"
    });
    const sum = createSandboxClosure({
      call: ([accumulator, value]) => Number(accumulator) + Number(value),
      name: "sum"
    });
    const collect = createSandboxClosure({
      call: ([value, index, array]) => [value, Number(index) + 10, array],
      name: "collect"
    });
    const visit = createSandboxClosure({
      call: ([value]) => {
        seen.push([value]);
        return undefined;
      },
      name: "visit"
    });

    await expect(callArrayMethod(values, "map", [double], options)).resolves.toEqual([2, 4, 6]);
    await expect(callArrayMethod(values, "filter", [isEven], options)).resolves.toEqual([2]);
    await expect(callArrayMethod(values, "find", [pickTwo], options)).resolves.toBe(2);
    await expect(callArrayMethod(values, "findIndex", [pickTwo], options)).resolves.toBe(1);
    await expect(callArrayMethod(values, "some", [pickTwo], options)).resolves.toBe(true);
    await expect(callArrayMethod(values, "every", [double], options)).resolves.toBe(true);
    await expect(callArrayMethod(values, "reduce", [sum], options)).resolves.toBe(6);
    await expect(callArrayMethod(values, "reduceRight", [sum, 10], options)).resolves.toBe(16);
    await expect(callArrayMethod(values, "flatMap", [collect], options)).resolves.toEqual([
      1,
      10,
      values,
      2,
      11,
      values,
      3,
      12,
      values
    ]);

    await expect(callArrayMethod(values, "forEach", [visit], options)).resolves.toBe(undefined);
    expect(seen[0]).toEqual([1, 0, values]);
    expect(seen.at(-1)).toEqual([3]);
  });

  it("matches sparse-array callback semantics", async () => {
    const budget = new Budget();
    const options = createOptions(budget);
    const sparse = new Array(3) as SandboxValue[];
    sparse[0] = 1;
    sparse[2] = 3;
    const findVisits: Array<readonly SandboxValue[]> = [];
    const mapVisits: Array<readonly SandboxValue[]> = [];

    const findHole = createSandboxClosure({
      call: ([value, index]) => {
        findVisits.push([value, index]);
        return value === undefined;
      },
      name: "findHole"
    });
    const mapValue = createSandboxClosure({
      call: ([value, index]) => {
        mapVisits.push([value, index]);
        return `${String(value)}:${String(index)}`;
      },
      name: "mapValue"
    });

    await expect(callArrayMethod(sparse, "find", [findHole], options)).resolves.toBe(undefined);
    await expect(callArrayMethod(sparse, "findIndex", [findHole], options)).resolves.toBe(1);

    const mapped = (await callArrayMethod(sparse, "map", [mapValue], options)) as SandboxValue[];
    expect(mapped).toHaveLength(3);
    expect(0 in mapped).toBe(true);
    expect(1 in mapped).toBe(false);
    expect(2 in mapped).toBe(true);
    expect(mapped[0]).toBe("1:0");
    expect(mapped[2]).toBe("3:2");

    expect(findVisits).toEqual([
      [1, 0],
      [undefined, 1],
      [1, 0],
      [undefined, 1]
    ]);
    expect(mapVisits).toEqual([
      [1, 0],
      [3, 2]
    ]);
  });

  it("snapshots the original length for callback-driven iteration methods", async () => {
    const budget = new Budget();
    const options = createOptions(budget);
    const values = [1, 2];
    const seen: number[] = [];

    const pushDuringIteration = createSandboxClosure({
      call: ([value, index, array]) => {
        seen.push(Number(index));
        if (index === 0) {
          (array as SandboxValue[]).push(3);
        }

        return value;
      },
      name: "pushDuringIteration"
    });

    await expect(callArrayMethod(values, "map", [pushDuringIteration], options)).resolves.toEqual([1, 2]);
    expect(seen).toEqual([0, 1]);
    expect(values).toEqual([1, 2, 3]);
  });

  it("supports value-returning and mutating array methods", async () => {
    const budget = new Budget();
    const options = createOptions(budget);

    await expect(callArrayMethod([1, [2], [3, [4]]], "flat", [2], options)).resolves.toEqual([1, 2, 3, 4]);
    await expect(callArrayMethod(["a", "b", "a"], "includes", ["b"], options)).resolves.toBe(true);
    await expect(callArrayMethod(["a", "b", "a"], "indexOf", ["a", 1], options)).resolves.toBe(2);
    await expect(callArrayMethod(["a", "b", "a"], "lastIndexOf", ["a", 1], options)).resolves.toBe(0);
    await expect(callArrayMethod(["a", "b"], "join", ["-"], options)).resolves.toBe("a-b");
    await expect(callArrayMethod([1, 2, 3], "slice", [1], options)).resolves.toEqual([2, 3]);
    await expect(callArrayMethod([1, 2], "concat", [[3], 4], options)).resolves.toEqual([1, 2, 3, 4]);

    const descending = createSandboxClosure({
      call: ([left, right]) => Number(right) - Number(left),
      name: "descending"
    });
    const sorted = [1, 10, 2];
    await expect(callArrayMethod(sorted, "sort", [descending], options)).resolves.toBe(sorted);
    expect(sorted).toEqual([10, 2, 1]);

    const reversed = [1, 2, 3];
    await expect(callArrayMethod(reversed, "reverse", [], options)).resolves.toBe(reversed);
    expect(reversed).toEqual([3, 2, 1]);

    const pushed = [1];
    await expect(callArrayMethod(pushed, "push", [2, 3], options)).resolves.toBe(3);
    expect(pushed).toEqual([1, 2, 3]);

    const unshifted = [2, 3];
    await expect(callArrayMethod(unshifted, "unshift", [0, 1], options)).resolves.toBe(4);
    expect(unshifted).toEqual([0, 1, 2, 3]);

    const popped = [1, 2, 3];
    await expect(callArrayMethod(popped, "pop", [], options)).resolves.toBe(3);
    expect(popped).toEqual([1, 2]);

    const shifted = [1, 2, 3];
    await expect(callArrayMethod(shifted, "shift", [], options)).resolves.toBe(1);
    expect(shifted).toEqual([2, 3]);
  });

  it("matches sparse-array behavior for flatMap and sort", async () => {
    const budget = new Budget();
    const options = createOptions(budget);
    const values = [1];

    const createSparse = createSandboxClosure({
      call: () => {
        const mapped = new Array(2) as SandboxValue[];
        mapped[1] = 2;
        return mapped;
      },
      name: "createSparse"
    });

    await expect(callArrayMethod(values, "flatMap", [createSparse], options)).resolves.toEqual([2]);

    const sparse = new Array(5) as SandboxValue[];
    sparse[1] = 2;
    sparse[2] = 1;
    sparse[4] = undefined;
    const compareCalls: Array<readonly SandboxValue[]> = [];
    const ascending = createSandboxClosure({
      call: ([left, right]) => {
        compareCalls.push([left, right]);
        return Number(left) - Number(right);
      },
      name: "ascending"
    });

    await expect(callArrayMethod(sparse, "sort", [ascending], options)).resolves.toBe(sparse);
    expect(sparse).toHaveLength(5);
    expect(0 in sparse).toBe(true);
    expect(1 in sparse).toBe(true);
    expect(2 in sparse).toBe(true);
    expect(3 in sparse).toBe(false);
    expect(4 in sparse).toBe(false);
    expect(sparse[0]).toBe(1);
    expect(sparse[1]).toBe(2);
    expect(sparse[2]).toBe(undefined);
    expect(compareCalls).toEqual([[2, 1]]);
  });

  it("applies budgets to produced values", async () => {
    const stringBudget = createOptions(
      new Budget({
        stringLength: 2
      })
    );
    const arrayBudget = createOptions(
      new Budget({
        arrayLength: 1
      })
    );

    await expect(callArrayMethod(["aa", "bb"], "join", ["-"], stringBudget)).rejects.toEqual(
      expect.objectContaining({
        budget: "stringLength",
        current: 5,
        limit: 2
      } satisfies Partial<SandboxError>)
    );
    await expect(callArrayMethod([1, 2], "slice", [0], arrayBudget)).rejects.toEqual(
      expect.objectContaining({
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
  });

  it("throws for reduce and reduceRight without an initial value on empty arrays", async () => {
    const options = createOptions(new Budget());
    const sum = createSandboxClosure({
      call: ([accumulator, value]) => Number(accumulator) + Number(value),
      name: "sum"
    });

    await expect(callArrayMethod([], "reduce", [sum], options)).rejects.toThrow(
      "Reduce of empty array with no initial value."
    );
    await expect(callArrayMethod([], "reduceRight", [sum], options)).rejects.toThrow(
      "Reduce of empty array with no initial value."
    );
  });
});

function createOptions(budget: Budget) {
  return {
    budget,
    callClosure: async (closure: SandboxClosure, args: readonly SandboxValue[]) => {
      const result = await closure.call(args);
      return isSandboxPromise(result) ? await result.promise : result;
    }
  };
}
