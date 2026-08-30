import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { run } from "../run.js";
import { Budget } from "./budget.js";

const originalBisector = `export default () => {
  function ascending(left, right) {
    return left == null || right == null ? NaN : left < right ? -1 : left > right ? 1 : left >= right ? 0 : NaN;
  }
  function bisector(accessor) {
    const compareSelf = accessor.length !== 2 ? ascending : () => 0;
    const compare = accessor.length !== 2 ? (record, target) => ascending(accessor(record), target) : accessor;
    const delta = accessor.length !== 2 ? (record, target) => accessor(record) - target : accessor;
    function left(records, target, lower = 0, upper = records.length) {
      if (lower < upper) {
        if (compareSelf(target, target) !== 0) return upper;
        do {
          const middle = (lower + upper) >>> 1;
          if (compare(records[middle], target) < 0) lower = middle + 1;
          else upper = middle;
        } while (lower < upper);
      }
      return lower;
    }
    function right(records, target, lower = 0, upper = records.length) {
      if (lower < upper) {
        if (compareSelf(target, target) !== 0) return upper;
        do {
          const middle = (lower + upper) >>> 1;
          if (compare(records[middle], target) <= 0) lower = middle + 1;
          else upper = middle;
        } while (lower < upper);
      }
      return lower;
    }
    function center(records, target, lower = 0, upper = records.length) {
      const index = left(records, target, lower, upper - 1);
      return index > lower && delta(records[index - 1], target) > -delta(records[index], target) ? index - 1 : index;
    }
    return { left, right, center };
  }
  const records = [3, 1.5, 2, 1.5, 4, 0, 2, 5].map((value, id) => ({ value, id }));
  records.sort((left, right) => left.value - right.value);
  let scale = 1;
  const search = bisector(record => record.value * scale);
  const queries = [-1, 0, 1.5, 1.75, 2, 3.1, 5, 6];
  const ascendingResults = queries.map(target => ({ target, left: search.left(records, target), right: search.right(records, target), center: search.center(records, target) }));
  scale = 2;
  const scaled = [3, 4, 6.2].map(target => [search.left(records, target), search.right(records, target), search.center(records, target)]);
  const descending = records.slice().reverse();
  const reverseSearch = bisector((record, target) => target - record.value);
  return {
    sortedIds: records.map(record => record.id), ascendingResults, scaled,
    descending: [1.5, 2, 4].map(target => [reverseSearch.left(descending, target), reverseSearch.right(descending, target), reverseSearch.center(descending, target)]),
    restricted: [search.left(records, 4, 2, 6), search.right(records, 4, 2, 6)],
    accessorLength: (record => record.value).length,
    comparatorLength: ((record, target) => record.value - target).length
  };
};
`;

const explicitModeControl = `export default () => {
  function ascending(left, right) {
    return left == null || right == null ? NaN : left < right ? -1 : left > right ? 1 : left >= right ? 0 : NaN;
  }
  function bisector(accessor, isComparator = false) {
    const compareSelf = !isComparator ? ascending : () => 0;
    const compare = !isComparator ? (record, target) => ascending(accessor(record), target) : accessor;
    const delta = !isComparator ? (record, target) => accessor(record) - target : accessor;
    function left(records, target, lower = 0, upper = records.length) {
      if (lower < upper) {
        if (compareSelf(target, target) !== 0) return upper;
        do {
          const middle = (lower + upper) >>> 1;
          if (compare(records[middle], target) < 0) lower = middle + 1;
          else upper = middle;
        } while (lower < upper);
      }
      return lower;
    }
    function right(records, target, lower = 0, upper = records.length) {
      if (lower < upper) {
        if (compareSelf(target, target) !== 0) return upper;
        do {
          const middle = (lower + upper) >>> 1;
          if (compare(records[middle], target) <= 0) lower = middle + 1;
          else upper = middle;
        } while (lower < upper);
      }
      return lower;
    }
    function center(records, target, lower = 0, upper = records.length) {
      const index = left(records, target, lower, upper - 1);
      return index > lower && delta(records[index - 1], target) > -delta(records[index], target) ? index - 1 : index;
    }
    return { left, right, center };
  }
  const records = [3, 1.5, 2, 1.5, 4, 0, 2, 5].map((value, id) => ({ value, id }));
  records.sort((left, right) => left.value - right.value);
  let scale = 1;
  const search = bisector(record => record.value * scale);
  const queries = [-1, 0, 1.5, 1.75, 2, 3.1, 5, 6];
  const ascendingResults = queries.map(target => ({ target, left: search.left(records, target), right: search.right(records, target), center: search.center(records, target) }));
  scale = 2;
  const scaled = [3, 4, 6.2].map(target => [search.left(records, target), search.right(records, target), search.center(records, target)]);
  const descending = records.slice().reverse();
  const reverseSearch = bisector((record, target) => target - record.value, true);
  return {
    sortedIds: records.map(record => record.id), ascendingResults, scaled,
    descending: [1.5, 2, 4].map(target => [reverseSearch.left(descending, target), reverseSearch.right(descending, target), reverseSearch.center(descending, target)]),
    restricted: [search.left(records, 4, 2, 6), search.right(records, 4, 2, 6)]
  };
};
`;

const originalReduction = `export default () => {
  function ordinary(first, second) {
    return first + second;
  }
  const arrow = (first, second = 0, ...rest) => first + second + rest.length;
  function* sequence(start) {
    yield start;
  }
  return { ordinary: ordinary.length, arrow: arrow.length, generator: sequence.length, result: ordinary(2, 3) };
};
`;

describe("source function arity (NUM-001)", () => {
  it.each([
    ["", 0],
    ["first", 1],
    ["first, second, third", 3],
    ["first = 1, second", 0],
    ["first, second = 2, third", 1],
    ["first, second, third = 3", 2],
    ["...rest", 0],
    ["first, ...rest", 1],
    ["first, second = 2, ...rest", 1],
    ["{ first, second }, [third, fourth]", 2],
    ["{ first = 1 }, [second = 2], third", 3],
    ["{ first } = {}, second", 0],
    ["[first], { second } = {}, third", 1]
  ])("counts parameters before the first default or rest: (%s)", async (parameters, length) => {
    const source = `
      function declared(${parameters}) {}
      async function asyncDeclared(${parameters}) {}
      function* generatorDeclared(${parameters}) {}
      const functions = [
        declared,
        function(${parameters}) {},
        function named(${parameters}) {},
        (${parameters}) => 1,
        asyncDeclared,
        async function(${parameters}) {},
        async (${parameters}) => 1,
        generatorDeclared,
        function* namedGenerator(${parameters}) {},
        ({ method(${parameters}) {} }).method
      ];
      return functions.map(target => target.length);
    `;
    const expected = Array(10).fill(length);
    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      expected
    );
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not evaluate defaults or change arity after calls", async () => {
    const source = `
      let defaults = 0;
      function target(first, second = ++defaults, ...rest) {
        return [first, second, rest.length, arguments.length];
      }
      const before = [target.length, target["length"], defaults];
      const called = target(3);
      const extra = target(3, 4, 5, 6);
      return { before, called, extra, after: [target.length, defaults] };
    `;
    const expected = {
      before: [1, 1, 0],
      called: [3, 1, 0, 1],
      extra: [3, 4, 2, 4],
      after: [1, 1]
    };
    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      expected
    );
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("preserves call, apply, binding, rebinding, and bound construction", async () => {
    const source = `
      function target(first, second, third = 3) { return [this.value, first, second, third]; }
      const bound = target.bind({ value: 10 }, 1);
      const rebound = bound.bind({ value: 99 }, 2, 4);
      function Pair(first, second) { this.values = [first, second]; }
      const BoundPair = Pair.bind(null, 7);
      const arrow = (first, second) => first + second;
      const boundArrow = arrow.bind(null, 8);
      return {
        lengths: [target.length, target.bind(null).length, bound.length, rebound.length,
          BoundPair.length, boundArrow.length, target.bind(null, 1, 2, 3).length],
        call: target.call({ value: 20 }, 1, 2),
        apply: target.apply({ value: 30 }, [1, 2, 4]),
        bound: bound(2), rebound: rebound(), pair: new BoundPair(8).values, arrow: boundArrow(9)
      };
    `;
    const expected = {
      lengths: [2, 2, 1, 0, 1, 1, 0],
      call: [20, 1, 2, 3],
      apply: [30, 1, 2, 4],
      bound: [10, 1, 2, 3],
      rebound: [10, 1, 2, 4],
      pair: [7, 8],
      arrow: 17
    };
    expect(runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 })).toEqual(
      expected
    );
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("selects the comparator branch in the complete original D3 bisector workload", async () => {
    const expected = runInNewContext(
      originalBisector.replace("export default ", "const entry = ") + "\nentry();",
      {},
      { timeout: 1_000 }
    );
    expect(expected).toEqual({
      sortedIds: [5, 1, 3, 2, 6, 0, 4, 7],
      ascendingResults: [
        { target: -1, left: 0, right: 0, center: 0 },
        { target: 0, left: 0, right: 1, center: 0 },
        { target: 1.5, left: 1, right: 3, center: 1 },
        { target: 1.75, left: 3, right: 3, center: 3 },
        { target: 2, left: 3, right: 5, center: 3 },
        { target: 3.1, left: 6, right: 6, center: 5 },
        { target: 5, left: 7, right: 8, center: 7 },
        { target: 6, left: 8, right: 8, center: 7 }
      ],
      scaled: [
        [1, 3, 1],
        [3, 5, 3],
        [6, 6, 5]
      ],
      descending: [
        [5, 7, 5],
        [3, 5, 3],
        [1, 2, 1]
      ],
      restricted: [3, 5],
      accessorLength: 1,
      comparatorLength: 2
    });
    await expect(
      run(originalBisector, {
        entryPointArgs: [],
        budget: new Budget({ maxSteps: 500_000, maxCallDepth: 128, deadline: Date.now() + 5_000 })
      })
    ).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("keeps the complete explicit-mode control equivalent to the original", async () => {
    const original = runInNewContext(
      originalBisector.replace("export default ", "const entry = ") + "\nentry();",
      {},
      { timeout: 1_000 }
    );
    const expected = runInNewContext(
      explicitModeControl.replace("export default ", "const entry = ") + "\nentry();",
      {},
      { timeout: 1_000 }
    );
    delete original.accessorLength;
    delete original.comparatorLength;
    expect(expected).toEqual(original);
    await expect(
      run(explicitModeControl, {
        entryPointArgs: [],
        budget: new Budget({ maxSteps: 500_000, maxCallDepth: 128, deadline: Date.now() + 5_000 })
      })
    ).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("returns the original ordinary, default/rest arrow, and generator arities", async () => {
    const expected = { ordinary: 2, arrow: 1, generator: 1, result: 5 };
    expect(
      runInNewContext(
        originalReduction.replace("export default ", "const entry = ") + "\nentry();",
        {},
        { timeout: 1_000 }
      )
    ).toEqual(expected);
    await expect(run(originalReduction, { entryPointArgs: [] })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });
});
