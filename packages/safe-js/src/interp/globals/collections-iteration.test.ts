import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { parseModule } from "../../parse/parser.js";
import { Budget } from "../budget.js";
import { interpret, type InterpreterSnapshot } from "../interpreter.js";
import { getSandboxIterator } from "../iteration.js";
import { cloneSandboxValue, createSandboxMap } from "../values.js";
import { createCollectionGlobals } from "./collections.js";
import { createObjectArrayGlobals } from "./object-array.js";

describe("direct collection iteration", () => {
  it("visits Map entries added during iteration", async () => {
    await expect(
      run(`
        const work = new Map([["start", 0]]);
        const visited = [];
        for (const [node, depth] of work) {
          visited.push([node, depth]);
          if (node === "start") work.set("end", 1);
        }
        return visited;
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        ["start", 0],
        ["end", 1]
      ]
    });
  });

  it("reads updated Map values and skips deleted entries", async () => {
    await expect(
      run(`
        const work = new Map([["start", 0], ["updated", 1], ["deleted", 2]]);
        const visited = [];
        for (const [node, depth] of work) {
          visited.push([node, depth]);
          if (node === "start") {
            work.set("updated", 99);
            work.delete("deleted");
          }
        }
        return visited;
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        ["start", 0],
        ["updated", 99]
      ]
    });
  });

  it("visits Set values added during iteration", async () => {
    await expect(
      run(`
        const work = new Set(["start"]);
        const visited = [];
        for (const node of work) {
          visited.push(node);
          if (node === "start") work.add("end");
        }
        return visited;
      `)
    ).resolves.toMatchObject({ ok: true, returnValue: ["start", "end"] });
  });

  it("skips Set values deleted before they are visited", async () => {
    await expect(
      run(`
        const work = new Set(["start", "deleted", "kept"]);
        const visited = [];
        for (const node of work) {
          visited.push(node);
          if (node === "start") work.delete("deleted");
        }
        return visited;
      `)
    ).resolves.toMatchObject({ ok: true, returnValue: ["start", "kept"] });
  });

  it.each([
    {
      collection: "Map",
      setup:
        'const work = new Map([["start", { distance: 0, parent: null }]]); const states = work;',
      traversal: `
        for (const [node, state] of work) {
          processed.push(node);
          for (const next of graph[node]) {
            if (!work.has(next)) work.set(next, { distance: state.distance + 1, parent: node });
          }
        }
      `
    },
    {
      collection: "Set",
      setup:
        'const work = new Set(["start"]); const states = new Map([["start", { distance: 0, parent: null }]]);',
      traversal: `
        for (const node of work) {
          const state = states.get(node);
          processed.push(node);
          for (const next of graph[node]) {
            if (!work.has(next)) {
              work.add(next);
              states.set(next, { distance: state.distance + 1, parent: node });
            }
          }
        }
      `
    }
  ])("completes a growing $collection reachability worklist", async ({ setup, traversal }) => {
    await expect(
      run(`
        const graph = {
          start: ["lexer", "cache"], lexer: ["parser"], cache: ["parser", "index"],
          parser: ["typecheck"], index: ["typecheck"], typecheck: ["emit"],
          emit: ["start"], isolated: []
        };
        ${setup}
        const processed = [];
        ${traversal}
        const distances = Object.fromEntries([...states].map(([node, state]) => [node, state.distance]));
        const path = [];
        let cursor = states.has("emit") ? "emit" : null;
        while (cursor !== null) {
          path.push(cursor);
          cursor = states.get(cursor).parent;
        }
        return { processed, distances, path: path.reverse(), reachable: work.size };
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: {
        processed: ["start", "lexer", "cache", "parser", "index", "typecheck", "emit"],
        distances: { start: 0, lexer: 1, cache: 1, parser: 2, index: 2, typecheck: 3, emit: 4 },
        path: ["start", "lexer", "parser", "typecheck", "emit"],
        reachable: 7
      }
    });
  });

  it.each([
    {
      collection: "Map",
      source: 'new Map([["start", 0], ["deleted", 1]])',
      binding: "[node, depth]",
      append: 'work.set("end", 2)',
      record: "[node, depth]",
      expected: [
        ["start", 0],
        ["end", 2]
      ]
    },
    {
      collection: "Set",
      source: 'new Set(["start", "deleted"])',
      binding: "node",
      append: 'work.add("end")',
      record: "node",
      expected: ["start", "end"]
    }
  ])(
    "observes $collection clear followed by insertion",
    async ({ source, binding, append, record, expected }) => {
      await expect(
        run(`
        const work = ${source};
        const visited = [];
        for (const ${binding} of work) {
          visited.push(${record});
          if (node === "start") {
            work.clear();
            ${append};
          }
        }
        return visited;
      `)
      ).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it.each([
    {
      collection: "Map",
      source: 'new Map([["start", 0], ["kept", 1]])',
      binding: "[node, depth]",
      append: 'work.set("start", 2)',
      record: "[node, depth]",
      expected: [
        ["start", 0],
        ["kept", 1],
        ["start", 2]
      ]
    },
    {
      collection: "Set",
      source: 'new Set(["start", "kept"])',
      binding: "node",
      append: 'work.add("start")',
      record: "node",
      expected: ["start", "kept", "start"]
    }
  ])(
    "revisits a deleted and reinserted $collection entry at the end",
    async ({ source, binding, append, record, expected }) => {
      await expect(
        run(`
        const work = ${source};
        const visited = [];
        let reinserted = false;
        for (const ${binding} of work) {
          visited.push(${record});
          if (!reinserted) {
            reinserted = true;
            work.delete("start");
            ${append};
          }
        }
        return visited;
      `)
      ).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("keeps Map iterators independent and exhausted iterators done", () => {
    const map = createSandboxMap([["start", 0]]);
    const first = getSandboxIterator(map)!;
    const second = getSandboxIterator(map)!;

    map.entries.set("start", 1);
    expect(first.next()).toEqual({ done: false, value: ["start", 1] });
    expect(first.next()).toEqual({ done: true, value: undefined });
    map.entries.set("end", 2);
    expect(first.next()).toEqual({ done: true, value: undefined });
    expect(second.next()).toEqual({ done: false, value: ["start", 1] });
    expect(second.next()).toEqual({ done: false, value: ["end", 2] });
  });

  it("returns fresh Map entry pairs without detaching their object values", async () => {
    await expect(
      run(`
        const state = { done: false };
        const work = new Map([["start", state]]);
        let first;
        for (const entry of work) {
          first = entry;
          entry[0] = "changed";
          entry[1].done = true;
        }
        let second;
        for (const entry of work) second = entry;
        return [first !== second, second[0], second[1] === state, state.done, work.has("changed")];
      `)
    ).resolves.toMatchObject({ ok: true, returnValue: [true, "start", true, true, false] });
  });
});

describe("explicit live collection iteration methods", () => {
  it.each([
    { method: "keys", expected: ["start", "kept", "end"] },
    { method: "values", expected: [0, 99, 3] },
    {
      method: "entries",
      expected: [
        ["start", 0],
        ["kept", 99],
        ["end", 3]
      ]
    }
  ])("keeps Map.$method() live", async ({ method, expected }) => {
    await expect(
      run(`
        const work = new Map([["start", 0], ["deleted", 1], ["kept", 2]]);
        const snapshot = work.${method}();
        work.set("kept", 99);
        work.delete("deleted");
        work.set("end", 3);
        return [Array.isArray(snapshot), [...snapshot], [...work]];
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        false,
        expected,
        [
          ["start", 0],
          ["kept", 99],
          ["end", 3]
        ]
      ]
    });
  });

  it.each([
    { method: "keys", expected: ["start", "kept", "end"] },
    { method: "values", expected: ["start", "kept", "end"] },
    {
      method: "entries",
      expected: [
        ["start", "start"],
        ["kept", "kept"],
        ["end", "end"]
      ]
    }
  ])("keeps Set.$method() live", async ({ method, expected }) => {
    await expect(
      run(`
        const work = new Set(["start", "deleted", "kept"]);
        const snapshot = work.${method}();
        const visited = [];
        for (const entry of snapshot) {
          visited.push(entry);
          work.delete("deleted");
          work.add("end");
        }
        return [Array.isArray(snapshot), visited, [...work], work.size];
      `)
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [false, expected, ["start", "kept", "end"], 3]
    });
  });
});

describe("collection cursor restoration", () => {
  it.each([
    {
      name: "Map object aliases and cyclic data",
      source: `
        const first = { name: "first" };
        const second = { name: "second" };
        const work = new Map([[first, { owner: first }], [second, { owner: second }]]);
        const alias = work;
        first.work = work;
        const visited = [];
        for (const [key, state] of work) {
          visited.push([key.name, state.owner === key, first.work === alias, alias === work]);
          work.delete(key);
        }
        return [visited, work.size];
      `
    },
    {
      name: "Set object aliases and cyclic data",
      source: `
        const first = { name: "first" };
        const second = { name: "second" };
        const work = new Set([first, second]);
        const alias = work;
        first.work = work;
        const visited = [];
        for (const key of work) {
          visited.push([key.name, first.work === alias, alias === work]);
          work.delete(key);
        }
        return [visited, work.size];
      `
    },
    {
      name: "Map outer current entry deleted before an inner checkpoint",
      source: `
        const work = new Map([["a", 1], ["b", 2], ["c", 3]]);
        const visited = [];
        for (const [key, value] of work) {
          work.delete(key);
          for (const once of [0]) visited.push([key, value]);
        }
        return [visited, [...work]];
      `
    },
    {
      name: "Set outer current entry deleted before an inner checkpoint",
      source: `
        const work = new Set(["a", "b", "c"]);
        const visited = [];
        for (const key of work) {
          work.delete(key);
          for (const once of [0]) visited.push(key);
        }
        return [visited, [...work]];
      `
    },
    {
      name: "Map inline iterable",
      source: `
        const visited = [];
        for (const [key, value] of new Map([["a", 1], ["b", 2]])) {
          visited.push([key, value]);
        }
        return visited;
      `
    },
    {
      name: "Set clear and reinsertion before an inner checkpoint",
      source: `
        const work = new Set(["a", "b"]);
        const visited = [];
        let changed = false;
        for (const key of work) {
          if (!changed) {
            changed = true;
            work.clear();
            work.add("a");
            work.add("c");
          }
          for (const once of [0]) visited.push(key);
        }
        return [visited, [...work]];
      `
    }
  ])("preserves $name at every loop checkpoint", async ({ source }) => {
    const module = parseModule(source);
    const program = { type: "BlockStatement" as const, body: module.body, span: module.span };
    const expected = new Function(source)();
    const budget = new Budget({ maxSteps: 20_000 });
    const bindings = {
      ...createCollectionGlobals({ budget }),
      ...createObjectArrayGlobals({ budget })
    };
    const snapshots: InterpreterSnapshot[] = [];
    const original = await interpret(program, {
      budget,
      bindings,
      onYield: (yieldPoint) => {
        if (yieldPoint.kind !== "loop-iteration") return;
        const current = yieldPoint.snapshot();
        snapshots.push({
          ...current,
          bindings: cloneSandboxValue(current.bindings) as InterpreterSnapshot["bindings"],
          loopIterations: structuredClone(current.loopIterations)
        });
      }
    });
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    expect(snapshots.length).toBeGreaterThan(1);
    for (const snapshot of snapshots) {
      const resumed = await interpret(program, { budget, bindings, snapshot });
      expect(resumed).toMatchObject({ ok: true, returnValue: expected });
    }
  });
});
