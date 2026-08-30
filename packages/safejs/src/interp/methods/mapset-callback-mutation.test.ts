import { describe, expect, it, vi } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { enterRunningState } from "../running-state.js";
import {
  createSandboxClosure,
  createSandboxMap,
  createSandboxSet,
  type SandboxValue
} from "../values.js";
import { callMapMethod, type MapMethodOptions } from "./map.js";
import { callSetMethod } from "./set.js";

const collections = [
  {
    name: "Map",
    create: 'new Map([["a", 1], ["b", 2], ["c", 3]])',
    append: 'work.set("d", 4)',
    readd: 'work.set("a", 9)',
    update: 'work.set("a", 8); work.set("c", 30)',
    infinite: "work.set(key + 1, key + 1)",
    seed: "new Map([[0, 0]])"
  },
  {
    name: "Set",
    create: 'new Set(["a", "b", "c"])',
    append: 'work.add("d")',
    readd: 'work.add("a")',
    update: 'work.add("a"); work.add("c")',
    infinite: "work.add(key + 1)",
    seed: "new Set([0])"
  }
];

describe.each(collections)("$name callback mutation", (collection) => {
  it.each(["append", "delete", "readd", "clear", "update", "delete-current"])(
    "matches native %s visitation and completed replay",
    async (mutation) => {
      const changes: Record<string, string> = {
        append: `${collection.append}; ${collection.append};`,
        delete: `work.delete("b"); ${collection.append};`,
        readd: `work.delete("a"); ${collection.readd}; work.delete("b");`,
        clear: `work.clear(); ${collection.readd}; ${collection.append};`,
        update: collection.update,
        "delete-current": 'work.delete("a"); work.delete("missing");'
      };
      const source = `
        const work = ${collection.create};
        const alias = work;
        const visits = [];
        const context = { tag: "receiver" };
        let changed = false;
        const returned = work.forEach(function(value, key, receiver) {
          visits.push([key, value, receiver === alias, this === context]);
          if (!changed) { changed = true; ${changes[mutation]} }
        }, context);
        return { visits, entries: [...work], size: work.size, returned };
      `;
      const expected = Function('"use strict";\n' + source)();
      const original = await run(source);
      expect(original).toMatchObject({ ok: true, returnValue: expected });
      const serialized = JSON.parse(await dump(original));
      for (const snapshot of [original.snapshot, restore(serialized, { source })]) {
        const replayed = await run(source, { snapshot });
        expect(replayed).toMatchObject({ ok: true, returnValue: expected });
        if (replayed.ok) expect(structuredClone(replayed.returnValue)).toStrictEqual(expected);
      }
    }
  );

  it("allows native same-receiver nested callbacks with independent cursors", async () => {
    const source = `
      const work = ${collection.create};
      const visits = [];
      let changed = false;
      work.forEach(function(value, key, receiver) {
        visits.push(["outer", key, value]);
        if (!changed) {
          changed = true;
          receiver.forEach(function(innerValue, innerKey, innerReceiver) {
            visits.push(["inner", innerKey, innerValue, innerReceiver === work]);
            if (innerKey === "a") { work.delete("b"); ${collection.append}; }
          });
        }
      });
      return { visits, entries: [...work] };
    `;
    const expected = Function('"use strict";\n' + source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("cleans up nested thrown sentinels and permits subsequent traversal", async () => {
    const source = `
      const work = ${collection.create};
      const sentinel = { stopped: true };
      const visits = [];
      let caught = false;
      try {
        work.forEach(function(value, key) {
          visits.push(["outer", key, value]);
          work.forEach(function(innerValue, innerKey) {
            work.delete("b"); ${collection.append};
            throw sentinel;
          });
        });
      } catch (error) { caught = error === sentinel; }
      ${collection.readd};
      work.forEach(function(value, key) { visits.push(["after", key, value]); });
      return { caught, visits, entries: [...work] };
    `;
    const expected = Function('"use strict";\n' + source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["undefined", "null", "false", "7", '"context"'])(
    "preserves strict thisArg %s and callback returns do not stop traversal",
    async (thisArg) => {
      const source = `
        const work = ${collection.create};
        const visits = [];
        const context = ${thisArg};
        const result = work.forEach(function(value, key, receiver) {
          visits.push([this === context, value, key, receiver === work]);
          return false;
        }, context);
        return { visits, result };
      `;
      const expected = Function('"use strict";\n' + source)();
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("validates callbacks on empty receivers and supports a cleared final cursor", async () => {
    const source = `
      const work = ${collection.create};
      const visits = [];
      work.forEach(function(value, key) { visits.push([key, value]); work.clear(); });
      let invalid = false;
      try { work.forEach(12); } catch (error) { invalid = error instanceof TypeError; }
      work.forEach(function() { visits.push("unexpected"); });
      return { invalid, visits, size: work.size };
    `;
    const expected = Function('"use strict";\n' + source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("preserves SameValueZero keys, object identity and cyclic result graphs", async () => {
    const source = `
      const first = { name: "first" };
      const last = { name: "last" };
      const work = ${collection.name === "Map" ? "new Map([[first, first], [NaN, 1], [-0, 2], [undefined, 3]])" : "new Set([first, NaN, -0, undefined])"};
      first.owner = work;
      const visits = [];
      let changed = false;
      work.forEach(function(value, key, receiver) {
        visits.push([key, value, receiver === first.owner]);
        if (!changed) {
          changed = true;
          work.delete(NaN);
          work.delete(first);
          ${collection.name === "Map" ? "work.set(first, last); work.set(NaN, 9); work.set(+0, 7);" : "work.add(first); work.add(NaN); work.add(+0);"}
        }
      });
      const sameReceiver = first.owner === work;
      first.owner = first;
      return { first, last, entries: [...work], visits, sameReceiver };
    `;
    const expected = Function('"use strict";\n' + source)();
    const original = await run(source);
    expect(original.ok).toBe(true);
    if (original.ok) expect(structuredClone(original.returnValue)).toStrictEqual(expected);
    const replayed = await run(source, {
      snapshot: restore(JSON.parse(await dump(original)), { source })
    });
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(structuredClone(replayed.returnValue)).toStrictEqual(expected);
  });

  it.each(["append", "delete-readd"])("bounds nonterminating %s callbacks", async (mode) => {
    const escaped = vi.fn();
    const source = `
      const work = ${collection.seed};
      try {
        work.forEach(function(value, key) {
          ${mode === "delete-readd" ? "work.clear();" : ""}
          ${collection.infinite};
        });
      } catch (error) { escaped(); }
    `;
    await expect(
      run(source, { bindings: { escaped }, budget: new Budget({ maxSteps: 500 }) })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(escaped).not.toHaveBeenCalled();
  });
});

describe("owned callback traversal resources", () => {
  it.each(["initialization", "append", "nested"])(
    "bounds retained %s state and releases it",
    async (phase) => {
      const budget = new Budget({ maxSteps: 100, dataSize: phase === "nested" ? 3 : 2 });
      const target = createSandboxMap(
        phase === "initialization"
          ? [
              [0, 0],
              [1, 1]
            ]
          : [[0, 0]]
      );
      const options: MapMethodOptions = {
        budget,
        callClosure: async (closure, args) => closure.call(args)
      };
      const callback = createSandboxClosure({
        call: async () => {
          if (phase === "append") {
            await callMapMethod(target, "set", [1, 1], options);
            await callMapMethod(target, "set", [2, 2], options);
          } else if (phase === "nested") {
            await callMapMethod(target, "forEach", [callback], options);
          }
          return undefined;
        }
      });
      await expect(callMapMethod(target, "forEach", [callback], options)).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "dataSize"
      });
      expect(budget.currentDataSize).toBe(0);
      expect([...budget.retainedValues()]).toEqual([]);
      const leave = enterRunningState(target);
      leave();
    }
  );

  it("bounds collection growth and preserves the array mutation lock", async () => {
    await expect(
      run(
        `
      const work = new Map([[0, 0]]);
      work.forEach(function(value, key) { work.set(key + 1, value); });
    `,
        { budget: new Budget({ maxSteps: 1000, arrayLength: 4 }) }
      )
    ).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "arrayLength"
    });
    await expect(
      run(`
      const values = [1];
      const work = new Set([1]);
      values.forEach(function() {
        work.forEach(function() { work.clear(); values.push(2); });
      });
    `)
    ).rejects.toMatchObject({ code: "reentry" });
  });

  it.each(["Map", "Set"])(
    "charges %s native-closure callbacks and releases state",
    async (kind) => {
      const budget = new Budget({ maxSteps: 40, dataSize: 100, arrayLength: 4 });
      const target = kind === "Map" ? createSandboxMap([[0, 0]]) : createSandboxSet([0]);
      const invoke =
        target.kind === "map"
          ? callMapMethod.bind(undefined, target)
          : callSetMethod.bind(undefined, target);
      const options: MapMethodOptions = {
        budget,
        callClosure: async (closure, args) => closure.call(args)
      };
      const callback = createSandboxClosure({
        call: async ([value]) => {
          await invoke("clear", [], options);
          if (target.kind === "map") await callMapMethod(target, "set", [value, value], options);
          else await callSetMethod(target, "add", [value], options);
          return undefined;
        }
      });
      await expect(invoke("forEach", [callback], options)).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "steps"
      });
      expect(budget.currentDataSize).toBe(0);
      expect([...budget.retainedValues()]).toEqual([]);
      budget.reset();
      await expect(invoke("clear", [], options)).resolves.toBeUndefined();
      await expect(invoke("forEach", [callback], options)).resolves.toBeUndefined();
    }
  );

  it.each(["Map", "Set"])(
    "preserves %s explicit same-receiver running exclusion and cleanup",
    async (kind) => {
      const target = kind === "Map" ? createSandboxMap([["a", 1]]) : createSandboxSet([1]);
      const invoke =
        target.kind === "map"
          ? callMapMethod.bind(undefined, target)
          : callSetMethod.bind(undefined, target);
      const calls: SandboxValue[] = [];
      const options: MapMethodOptions = {
        budget: new Budget(),
        callClosure: async (closure, args) => closure.call(args)
      };
      const callback = createSandboxClosure({
        call: async ([value]) => {
          expect(() => enterRunningState(target)).toThrow(
            expect.objectContaining({ code: "reentry" })
          );
          await expect(invoke("forEach", [12], options)).rejects.toBeInstanceOf(TypeError);
          expect(() => enterRunningState(target)).toThrow(
            expect.objectContaining({ code: "reentry" })
          );
          calls.push(value);
          return undefined;
        }
      });
      const leave = enterRunningState(target);
      await expect(invoke("forEach", [callback], options)).rejects.toMatchObject({
        code: "reentry"
      });
      leave();
      await invoke("forEach", [callback], options);
      expect(calls).toEqual([1]);
    }
  );

  it.each(["Map", "Set"])("retains no consumed insertion history for %s churn", async (kind) => {
    const target = kind === "Map" ? createSandboxMap([[0, 0]]) : createSandboxSet([0]);
    const invoke =
      target.kind === "map"
        ? callMapMethod.bind(undefined, target)
        : callSetMethod.bind(undefined, target);
    const budget = new Budget({ maxSteps: 500, dataSize: 2, arrayLength: 1 });
    const options: MapMethodOptions = {
      budget,
      callClosure: async (closure, args) => closure.call(args)
    };
    let calls = 0;
    const callback = createSandboxClosure({
      call: async () => {
        calls += 1;
        if (calls < 50) {
          await invoke("clear", [], options);
          if (target.kind === "map") await callMapMethod(target, "set", [0, 0], options);
          else await callSetMethod(target, "add", [0], options);
        }
        return undefined;
      }
    });
    await expect(invoke("forEach", [callback], options)).resolves.toBeUndefined();
    expect(calls).toBe(50);
    expect(budget.peakDataSize).toBe(2);
    expect(budget.currentDataSize).toBe(0);
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
