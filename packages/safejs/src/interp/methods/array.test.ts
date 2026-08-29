import { describe, expect, it } from "vitest";

import { Budget, SandboxError } from "../budget.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxValue
} from "../values.js";
import { run } from "../../run.js";
import { callArrayMethod, getArrayMember } from "./array.js";

describe("array methods", () => {
  it("exposes intercepted array members", () => {
    const values = [1, 2, 3];
    Object.assign(values, { custom: "host value" });
    const sparse = new Array(1) as SandboxValue[];
    Object.setPrototypeOf(
      sparse,
      Object.assign(Object.create(Array.prototype), { 0: "host value" })
    );
    const options = createOptions(new Budget());

    expect(getArrayMember(values, 0, options)).toBe(1);
    expect(getArrayMember(values, "0", options)).toBe(1);
    expect(getArrayMember(values, "length", options)).toBe(3);
    expect(isSandboxClosure(getArrayMember(values, "map", options))).toBe(true);
    expect(isSandboxClosure(getArrayMember(values, "findLast", options))).toBe(true);
    expect(isSandboxClosure(getArrayMember(values, "toSorted", options))).toBe(true);
    expect(isSandboxClosure(getArrayMember(values, "with", options))).toBe(true);
    expect(getArrayMember(values, "custom", options)).toBe("host value");
    expect(getArrayMember(values, "01", options)).toBeUndefined();
    expect(getArrayMember(values, -1, options)).toBeUndefined();
    expect(getArrayMember(values, 1.5, options)).toBeUndefined();
    expect(getArrayMember(values, 99, options)).toBeUndefined();
    expect(getArrayMember(sparse, 0, options)).toBeUndefined();
    expect(getArrayMember(values, "missing", options)).toBeUndefined();
  });

  it("supports reverse callback searches with async callbacks", async () => {
    const options = createOptions(new Budget());
    const seen: number[] = [];
    const isEven = createSandboxClosure({
      call: async ([value, index]) => {
        await Promise.resolve();
        seen.push(Number(index));
        return Number(value) % 2 === 0;
      },
      name: "isEven"
    });

    await expect(callArrayMethod([2, 3, 4, 5], "findLast", [isEven], options)).resolves.toBe(4);
    expect(seen).toEqual([3, 2]);

    seen.length = 0;
    await expect(callArrayMethod([2, 3, 4, 5], "findLastIndex", [isEven], options)).resolves.toBe(
      2
    );
    expect(seen).toEqual([3, 2]);
  });

  it("returns the value observed by findLast before callback mutation", async () => {
    const options = createOptions(new Budget());
    const values = [1, 2, 3];
    const mutateMatch = createSandboxClosure({
      call: ([value, index, array]) => {
        if (index === 2) {
          (array as SandboxValue[])[2] = 9;
          return true;
        }

        return value === 2;
      },
      name: "mutateMatch"
    });

    await expect(callArrayMethod(values, "findLast", [mutateMatch], options)).resolves.toBe(3);
    expect(values).toEqual([1, 2, 9]);
  });

  it("supports fill and copyWithin mutations", async () => {
    const options = createOptions(new Budget());
    const filled = [1, 2, 3, 4];
    const copied = [1, 2, 3, 4, 5];

    await expect(callArrayMethod(filled, "fill", [0, 1, 3], options)).resolves.toBe(filled);
    expect(filled).toEqual([1, 0, 0, 4]);

    await expect(callArrayMethod(copied, "copyWithin", [0, 3], options)).resolves.toBe(copied);
    expect(copied).toEqual([4, 5, 3, 4, 5]);
  });

  it("supports copying array methods without mutating the source", async () => {
    const options = createOptions(new Budget());
    const source = [3, 1, 2];
    const ascending = createSandboxClosure({
      call: async ([left, right]) => {
        await Promise.resolve();
        return Number(left) - Number(right);
      },
      name: "ascending"
    });

    await expect(callArrayMethod(source, "toSorted", [ascending], options)).resolves.toEqual([
      1, 2, 3
    ]);
    await expect(callArrayMethod(source, "toReversed", [], options)).resolves.toEqual([2, 1, 3]);
    await expect(callArrayMethod(source, "toSpliced", [1, 1, 8, 9], options)).resolves.toEqual([
      3, 8, 9, 2
    ]);
    await expect(callArrayMethod(source, "with", [-1, 7], options)).resolves.toEqual([3, 1, 7]);
    expect(source).toEqual([3, 1, 2]);
  });

  it("densifies sparse arrays in copying methods", async () => {
    const options = createOptions(new Budget());
    const sparse = new Array(4) as SandboxValue[];
    sparse[1] = 2;
    sparse[3] = 1;

    for (const [method, args] of [
      ["toSorted", []],
      ["toReversed", []],
      ["toSpliced", [1, 1, 9]],
      ["with", [1, 9]]
    ] as const) {
      const result = (await callArrayMethod(sparse, method, args, options)) as SandboxValue[];
      expect(result.every((_, index) => index in result)).toBe(true);
    }

    expect(0 in sparse).toBe(false);
    expect(2 in sparse).toBe(false);
  });

  it("coerces with indexes per Array.prototype.with", async () => {
    const options = createOptions(new Budget());

    await expect(callArrayMethod([1, 2], "with", [undefined, 9], options)).resolves.toEqual([9, 2]);
    await expect(callArrayMethod([1, 2], "with", [Number.NaN, 9], options)).resolves.toEqual([
      9, 2
    ]);
    await expect(callArrayMethod([1, 2], "with", [1.9, 9], options)).resolves.toEqual([1, 9]);
    await expect(callArrayMethod([1, 2], "with", [-1.9, 9], options)).resolves.toEqual([1, 9]);
  });

  it("throws RangeError when with receives an out-of-bounds index", async () => {
    const options = createOptions(new Budget());

    await expect(callArrayMethod([1, 2], "with", [2, 3], options)).rejects.toThrow(RangeError);
    await expect(callArrayMethod([1, 2], "with", [-3, 3], options)).rejects.toThrow(RangeError);
    await expect(callArrayMethod([1, 2], "with", [Infinity, 3], options)).rejects.toThrow(
      RangeError
    );
    await expect(callArrayMethod([1, 2], "with", [-Infinity, 3], options)).rejects.toThrow(
      RangeError
    );
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

  it("covers Array.prototype edge cases", async () => {
    const options = createOptions(new Budget());
    const sum = createSandboxClosure({
      call: ([accumulator, value]) => Number(accumulator) + Number(value),
      name: "sum"
    });
    const joinFromRight = createSandboxClosure({
      call: ([accumulator, value]) => `${String(accumulator)}-${String(value)}`,
      name: "joinFromRight"
    });
    const double = createSandboxClosure({
      call: ([value]) => Number(value) * 2,
      name: "double"
    });
    const greaterThanOne = createSandboxClosure({
      call: ([value]) => Number(value) > 1,
      name: "greaterThanOne"
    });
    const equalsTwo = createSandboxClosure({
      call: ([value]) => value === 2,
      name: "equalsTwo"
    });
    const equalsFive = createSandboxClosure({
      call: ([value]) => value === 5,
      name: "equalsFive"
    });
    const greaterThanFive = createSandboxClosure({
      call: ([value]) => Number(value) > 5,
      name: "greaterThanFive"
    });
    const greaterThanZero = createSandboxClosure({
      call: ([value]) => Number(value) > 0,
      name: "greaterThanZero"
    });

    await expect(callArrayMethod([], "reduce", [sum], options)).rejects.toThrow(TypeError);
    await expect(callArrayMethod([], "reduce", [sum, 0], options)).resolves.toBe(0);
    await expect(callArrayMethod([1, 2, 3], "reduce", [sum], options)).resolves.toBe(6);
    await expect(callArrayMethod([1, 2, 3], "reduceRight", [joinFromRight], options)).resolves.toBe(
      "3-2-1"
    );
    await expect(callArrayMethod([1, 2, 3], "map", [double], options)).resolves.toEqual([2, 4, 6]);
    await expect(callArrayMethod([1, 2, 3], "filter", [greaterThanOne], options)).resolves.toEqual([
      2, 3
    ]);
    await expect(callArrayMethod([1, 2, 3], "find", [equalsTwo], options)).resolves.toBe(2);
    await expect(
      callArrayMethod([1, 2, 3], "find", [equalsFive], options)
    ).resolves.toBeUndefined();
    await expect(callArrayMethod([1, 2, 3], "findIndex", [equalsTwo], options)).resolves.toBe(1);
    await expect(callArrayMethod([1, 2, 3], "findIndex", [equalsFive], options)).resolves.toBe(-1);
    await expect(callArrayMethod([1, 2, 3], "some", [greaterThanFive], options)).resolves.toBe(
      false
    );
    await expect(callArrayMethod([1, 2, 3], "some", [greaterThanOne], options)).resolves.toBe(true);
    await expect(callArrayMethod([1, 2, 3], "every", [greaterThanZero], options)).resolves.toBe(
      true
    );
    await expect(callArrayMethod([1, 2, 3], "every", [greaterThanOne], options)).resolves.toBe(
      false
    );
    await expect(callArrayMethod([1, 2, 3], "forEach", [double], options)).resolves.toBeUndefined();
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

    await expect(callArrayMethod(values, "map", [pushDuringIteration], options)).resolves.toEqual([
      1, 2
    ]);
    expect(seen).toEqual([0, 1]);
    expect(values).toEqual([1, 2, 3]);
  });

  it("supports value-returning and mutating array methods", async () => {
    const budget = new Budget();
    const options = createOptions(budget);

    await expect(callArrayMethod([1, [2], [3, [4]]], "flat", [], options)).resolves.toEqual([
      1,
      2,
      3,
      [4]
    ]);
    await expect(callArrayMethod([1, [2], [3, [4]]], "flat", [2], options)).resolves.toEqual([
      1, 2, 3, 4
    ]);
    await expect(callArrayMethod([1, [2, [3]]], "flat", [2], options)).resolves.toEqual([1, 2, 3]);
    await expect(callArrayMethod([1, [2, [3]]], "flat", [Infinity], options)).resolves.toEqual([
      1, 2, 3
    ]);
    await expect(callArrayMethod([], "flat", [], options)).resolves.toEqual([]);
    await expect(callArrayMethod(["a", "b", "a"], "includes", ["b"], options)).resolves.toBe(true);
    await expect(callArrayMethod(["a", "b", "a"], "indexOf", ["a", 1], options)).resolves.toBe(2);
    await expect(callArrayMethod(["a", "b", "a"], "lastIndexOf", ["a", 1], options)).resolves.toBe(
      0
    );
    await expect(callArrayMethod(["a", "b"], "join", ["-"], options)).resolves.toBe("a-b");
    await expect(callArrayMethod([1, 2, 3], "slice", [1], options)).resolves.toEqual([2, 3]);
    await expect(callArrayMethod([1, 2], "concat", [[3], 4], options)).resolves.toEqual([
      1, 2, 3, 4
    ]);

    await expect(callArrayMethod([1, 2, 3], "includes", [2], options)).resolves.toBe(true);
    await expect(callArrayMethod([1, 2, 3], "includes", [Number.NaN], options)).resolves.toBe(
      false
    );
    await expect(callArrayMethod([1, Number.NaN], "includes", [Number.NaN], options)).resolves.toBe(
      true
    );
    await expect(callArrayMethod([1, Number.NaN], "indexOf", [Number.NaN], options)).resolves.toBe(
      -1
    );
    await expect(callArrayMethod([1, 2, 3], "slice", [-2], options)).resolves.toEqual([2, 3]);
    await expect(callArrayMethod([1, 2, 3], "slice", [1, -1], options)).resolves.toEqual([2]);
    await expect(callArrayMethod([1, 2, 3], "concat", [[4, 5], 6], options)).resolves.toEqual([
      1, 2, 3, 4, 5, 6
    ]);
    await expect(callArrayMethod([1, 2, 3], "join", ["-"], options)).resolves.toBe("1-2-3");
    await expect(callArrayMethod([null, undefined], "join", [","], options)).resolves.toBe(",");

    const spliced = [1, 2, 3, 4];
    await expect(callArrayMethod(spliced, "splice", [1, 2], options)).resolves.toEqual([2, 3]);
    expect(spliced).toEqual([1, 4]);

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

    await expect(callArrayMethod([3, 1, 2], "sort", [], options)).resolves.toEqual([1, 2, 3]);
    await expect(callArrayMethod([10, 2, 1], "sort", [], options)).resolves.toEqual([1, 10, 2]);

    const ascending = createSandboxClosure({
      call: ([left, right]) => Number(left) - Number(right),
      name: "ascending"
    });
    await expect(callArrayMethod([3, 1, 2], "sort", [ascending], options)).resolves.toEqual([
      1, 2, 3
    ]);

    const failSort = createSandboxClosure({
      call: () => {
        throw new Error("sort failed");
      },
      name: "failSort"
    });
    await expect(callArrayMethod([3, 1, 2], "sort", [failSort], options)).rejects.toThrow(
      "sort failed"
    );

    await expect(callArrayMethod([1, 2, 3], "at", [-1], options)).resolves.toBe(3);
    await expect(callArrayMethod([1, 2, 3], "at", [0], options)).resolves.toBe(1);
    await expect(callArrayMethod([1, 2, 3], "at", [10], options)).resolves.toBeUndefined();

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

  it("makes array mutations visible to later forEach callbacks", async () => {
    const options = createOptions(new Budget());
    const values = [1, 2, 3];
    const seenLengths: number[] = [];

    const pushOnFirstVisit = createSandboxClosure({
      call: ([, index, array]) => {
        seenLengths.push((array as SandboxValue[]).length);
        if (index === 0) {
          (array as SandboxValue[]).push(4);
        }

        return undefined;
      },
      name: "pushOnFirstVisit"
    });

    await expect(
      callArrayMethod(values, "forEach", [pushOnFirstVisit], options)
    ).resolves.toBeUndefined();
    expect(seenLengths).toEqual([3, 4, 4]);
    expect(values).toEqual([1, 2, 3, 4]);
  });

  it("calls callbacks with undefined this", async () => {
    const options = createOptions(new Budget());
    let calls = 0;
    const callback = createSandboxClosure({
      call: function (this: unknown) {
        calls += 1;
        expect(this).toBeUndefined();
        return undefined;
      },
      name: "callback"
    });

    await expect(callArrayMethod([1], "forEach", [callback], options)).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it("supports flatMap return shapes and callback arguments", async () => {
    const budget = new Budget();
    const options = createOptions(budget);
    const seen: Array<readonly SandboxValue[]> = [];

    const duplicateWithIndex = createSandboxClosure({
      call: ([value, index]) => {
        seen.push([value, index]);
        return [value, Number(value) + Number(index)];
      },
      name: "duplicateWithIndex"
    });
    const identity = createSandboxClosure({
      call: ([value]) => value,
      name: "identity"
    });
    const fail = createSandboxClosure({
      call: () => {
        throw "boom";
      },
      name: "fail"
    });

    await expect(
      callArrayMethod([10, 20], "flatMap", [duplicateWithIndex], options)
    ).resolves.toEqual([10, 10, 20, 21]);
    expect(seen).toEqual([
      [10, 0],
      [20, 1]
    ]);
    await expect(callArrayMethod([1], "flatMap", [identity], options)).resolves.toEqual([1]);
    await expect(callArrayMethod([], "flatMap", [fail], options)).resolves.toEqual([]);
    await expect(callArrayMethod([1], "flatMap", [fail], options)).rejects.toBe("boom");
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
    await expect(callArrayMethod([[1, 2]], "flat", [], arrayBudget)).rejects.toEqual(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
    await expect(callArrayMethod([2, 1], "toSorted", [], arrayBudget)).rejects.toEqual(
      expect.objectContaining({
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );

    const copied = [[1], [2]];
    await expect(callArrayMethod(copied, "copyWithin", [0, 1], arrayBudget)).rejects.toEqual(
      expect.objectContaining({
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
    expect(copied).toEqual([[2], [2]]);
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

  it("exposes caught empty reduce errors as sandbox TypeErrors", async () => {
    await expect(
      run(`
        const results = [];
        try {
          [].reduce((accumulator, value) => accumulator + value);
        } catch (error) {
          results.push(error.name, error instanceof TypeError, error instanceof Error);
        }

        try {
          [].reduceRight((accumulator, value) => accumulator + value);
        } catch (error) {
          results.push(error.name, error instanceof TypeError, error instanceof Error);
        }

        return results;
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["TypeError", true, true, "TypeError", true, true]
    });
  });
});

function createOptions(budget: Budget) {
  return {
    budget,
    callClosure: async (closure: SandboxClosure, args: readonly SandboxValue[]) => {
      const result = await Reflect.apply(closure.call, undefined, [args]);
      return isSandboxPromise(result) ? await result.promise : result;
    }
  };
}
