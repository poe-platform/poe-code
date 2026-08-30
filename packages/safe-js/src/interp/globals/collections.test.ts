import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget, SandboxError } from "../budget.js";
import { callArrayMethod } from "../methods/array.js";
import { callMapMethod } from "../methods/map.js";
import { callSetMethod } from "../methods/set.js";
import { createSandboxMap, createSandboxSet, isSandboxMap, isSandboxSet } from "../values.js";
import { createCollectionGlobals } from "./collections.js";

describe("Map and Set globals", () => {
  it("integrates collections with iteration, spread, brands, and object enumeration", async () => {
    const result = await run(`
      const index = new Map([["first", { done: false }], ["second", { done: true }]]);
      const ids = [];
      const states = [];
      for (const [id, todo] of index) {
        ids.push(id);
        states.push(todo.done);
      }

      const set = new Set(["alpha", "beta", "alpha"]);
      const mapForIn = [];
      const setForIn = [];
      for (const key in index) mapForIn.push(key);
      for (const key in set) setForIn.push(key);

      return [
        ids,
        states,
        [...index],
        [...set],
        index instanceof Map,
        set instanceof Set,
        JSON.stringify(index),
        JSON.stringify(set),
        Object.keys(index),
        Object.keys(set),
        mapForIn,
        setForIn
      ];
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [
        ["first", "second"],
        [false, true],
        [
          ["first", { done: false }],
          ["second", { done: true }]
        ],
        ["alpha", "beta"],
        true,
        true,
        "{}",
        "{}",
        [],
        [],
        [],
        []
      ]
    });
  });

  it("composes collection iteration with nested destructuring and every spread path", async () => {
    const result = await run(`
      const index = new Map([
        ["first", { done: false, labels: new Set(["a", "b"]) }],
        ["second", { done: true, labels: new Set(["c"]) }]
      ]);
      const rows = [];
      for (const [id, { done, labels: [firstLabel] }] of index) {
        rows.push([id, done, firstLabel]);
      }

      const collect = (...values) => values;
      return [
        rows,
        collect(...index),
        collect(...new Set([1, 2, 1])),
        { ...index },
        { ...new Set([1, 2]) }
      ];
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [
        [
          ["first", false, "a"],
          ["second", true, "c"]
        ],
        [
          ["first", { done: false, labels: expect.anything() }],
          ["second", { done: true, labels: expect.anything() }]
        ],
        [1, 2],
        {},
        {}
      ]
    });
  });

  it("requires construction with new", async () => {
    await expect(run("Map()")).rejects.toThrow("Constructor Map requires 'new'.");
    await expect(run("Set()")).rejects.toThrow("Constructor Set requires 'new'.");
  });

  it("constructs empty and populated collections without exposing host collections", async () => {
    const result = await run(`
      const map = new Map([["alpha", 1], ["beta", 2]]);
      const copiedMap = new Map(map);
      const set = new Set(["alpha", "beta", "alpha"]);
      const stringSet = new Set("aba");
      const copiedSet = new Set(set);
      return [map, copiedMap, set, stringSet, copiedSet];
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const [map, copiedMap, set, stringSet, copiedSet] = result.returnValue as unknown[];
    expect(isSandboxMap(map)).toBe(true);
    expect(isSandboxMap(copiedMap)).toBe(true);
    expect(map).not.toBe(copiedMap);
    expect(isSandboxSet(set)).toBe(true);
    expect(isSandboxSet(stringSet)).toBe(true);
    expect(isSandboxSet(copiedSet)).toBe(true);
    expect(set).not.toBe(copiedSet);
    expect(map).not.toBeInstanceOf(Map);
    expect(set).not.toBeInstanceOf(Set);
  });

  it("supports the full Map method matrix, chaining, and insertion order", async () => {
    await expect(
      run(`
        const map = new Map();
        const chained = map.set("first", 1).set("second", 2).set("first", 3);
        const visited = [];
        map.forEach((value, key, collection) => {
          visited.push([value, key, collection === map]);
        });
        const deleted = map.delete("second");
        const missing = map.delete("missing");
        const beforeClear = [
          chained === map,
          map.get("first"),
          map.get("missing"),
          map.has("first"),
          map.has("second"),
          deleted,
          missing,
          map.keys(),
          map.values(),
          map.entries(),
          map.size,
          visited
        ];
        map.clear();
        return [beforeClear, map.size, map.entries()];
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        [
          true,
          3,
          undefined,
          true,
          false,
          true,
          false,
          ["first"],
          [3],
          [["first", 3]],
          1,
          [
            [3, "first", true],
            [2, "second", true]
          ]
        ],
        0,
        []
      ]
    });
  });

  it("supports the full Set method matrix, chaining, and insertion order", async () => {
    await expect(
      run(`
        const set = new Set();
        const chained = set.add("first").add("second").add("first");
        const visited = [];
        set.forEach((value, key, collection) => {
          visited.push([value, key, collection === set]);
        });
        const deleted = set.delete("second");
        const missing = set.delete("missing");
        const beforeClear = [
          chained === set,
          set.has("first"),
          set.has("second"),
          deleted,
          missing,
          set.keys(),
          set.values(),
          set.entries(),
          set.size,
          visited
        ];
        set.clear();
        return [beforeClear, set.size, set.entries()];
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        [
          true,
          true,
          false,
          true,
          false,
          ["first"],
          ["first"],
          [["first", "first"]],
          1,
          [
            ["first", "first", true],
            ["second", "second", true]
          ]
        ],
        0,
        []
      ]
    });
  });

  it("uses SameValueZero and object reference identity", async () => {
    await expect(
      run(`
        const objectKey = {};
        const equalLookingKey = {};
        const map = new Map();
        map.set(Number.NaN, "nan");
        map.set(-0, "zero");
        map.set(objectKey, "object");
        const set = new Set([Number.NaN, -0, objectKey]);
        return [
          map.get(Number.NaN),
          map.get(0),
          map.get(equalLookingKey),
          map.get(objectKey),
          map.size,
          set.has(Number.NaN),
          set.has(0),
          set.has(equalLookingKey),
          set.has(objectKey),
          set.size,
          map === map,
          map == map,
          map === new Map(),
          set === set,
          set == set,
          set === new Set(),
          Boolean(map),
          Boolean(set)
        ];
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        "nan",
        "zero",
        undefined,
        "object",
        3,
        true,
        true,
        false,
        true,
        3,
        true,
        true,
        false,
        true,
        true,
        false,
        true,
        true
      ]
    });
  });

  it("allows pending async forEach callbacks to finish at the caller's await", async () => {
    await expect(
      run(`
        const mapValues = [];
        const setValues = [];
        const map = new Map([["a", 1], ["b", 2]]);
        const set = new Set([1, 2]);
        await map.forEach(async (value, key) => {
          await Promise.resolve();
          mapValues.push(key + value);
        });
        await set.forEach(async (value) => {
          await Promise.resolve();
          setValues.push(value * 2);
        });
        return [mapValues, setValues];
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        ["a1", "b2"],
        [2, 4]
      ]
    });
  });

  it("budgets construction, mutations, and eager result arrays", async () => {
    const globals = createCollectionGlobals({ budget: new Budget({ arrayLength: 1 }) });

    expect(() =>
      globals.Map.construct?.([
        [
          [1, 1],
          [2, 2]
        ]
      ])
    ).toThrowError(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );

    await expect(
      run("const set = new Set(); set.add(1); set.add(2);", {
        budget: new Budget({ arrayLength: 1 })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );

    await expect(
      run("const map = new Map(); map.set(1, 1); map.set(2, 2); return map.keys();", {
        budget: new Budget({ arrayLength: 1 })
      })
    ).rejects.toEqual(expect.objectContaining({ code: "budgetExceeded" }));
  });

  it("does not mutate collections when a mutation exceeds the budget", async () => {
    const map = createSandboxMap([[1, 1]]);
    const set = createSandboxSet([1]);
    const options = {
      budget: new Budget({ arrayLength: 1 }),
      callClosure: async () => undefined
    };

    await expect(callMapMethod(map, "set", [2, 2], options)).rejects.toEqual(
      expect.objectContaining({ code: "budgetExceeded" })
    );
    await expect(callSetMethod(set, "add", [2], options)).rejects.toEqual(
      expect.objectContaining({ code: "budgetExceeded" })
    );

    expect([...map.entries]).toEqual([[1, 1]]);
    expect([...set.values]).toEqual([1]);
  });

  it("budgets collection contents nested in produced arrays", async () => {
    await expect(
      callArrayMethod(
        [createSandboxMap([["toolong", createSandboxSet(["also-long"])]])],
        "slice",
        [],
        {
          budget: new Budget({ stringLength: 4 }),
          callClosure: async () => undefined
        }
      )
    ).rejects.toEqual(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "stringLength"
      } satisfies Partial<SandboxError>)
    );
  });
});
