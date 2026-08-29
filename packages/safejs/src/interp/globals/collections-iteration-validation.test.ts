import { afterEach, describe, expect, it, vi } from "vitest";

import { restore, type SafeJSSnapshot } from "../../restore.js";
import { parseModule } from "../../parse/parser.js";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";
import { Budget } from "../budget.js";
import { interpret, type InterpreterSnapshot } from "../interpreter.js";
import { cloneSandboxValue, createSandboxClosure, createSandboxPromise } from "../values.js";
import { createCollectionGlobals } from "./collections.js";
import { createObjectArrayGlobals } from "./object-array.js";

afterEach(() => vi.restoreAllMocks());

const originalCases = [
  {
    name: "07-map-worklist-reachability.ajs",
    source:
      'export default () => {\n  const graph = {\n    start: ["lexer", "cache"], lexer: ["parser"], cache: ["parser", "index"],\n    parser: ["typecheck"], index: ["typecheck"], typecheck: ["emit"], emit: ["start"], isolated: []\n  };\n  const work = new Map([["start", { distance: 0, parent: null }]]);\n  const processed = [];\n  for (const [node, state] of work) {\n    processed.push(node);\n    for (const next of graph[node]) {\n      if (!work.has(next)) work.set(next, { distance: state.distance + 1, parent: node });\n    }\n  }\n  const distances = Object.fromEntries([...work].map(([node, state]) => [node, state.distance]));\n  const path = [];\n  let cursor = work.has("emit") ? "emit" : null;\n  while (cursor !== null) {\n    path.push(cursor);\n    cursor = work.get(cursor).parent;\n  }\n  return { processed, distances, path: path.reverse(), reachable: work.size };\n};\n'
  },
  {
    name: "08-set-worklist-reachability.ajs",
    source:
      'export default () => {\n  const graph = {\n    start: ["lexer", "cache"], lexer: ["parser"], cache: ["parser", "index"],\n    parser: ["typecheck"], index: ["typecheck"], typecheck: ["emit"], emit: ["start"], isolated: []\n  };\n  const work = new Set(["start"]);\n  const states = new Map([["start", { distance: 0, parent: null }]]);\n  const processed = [];\n  for (const node of work) {\n    const state = states.get(node);\n    processed.push(node);\n    for (const next of graph[node]) {\n      if (!work.has(next)) {\n        work.add(next);\n        states.set(next, { distance: state.distance + 1, parent: node });\n      }\n    }\n  }\n  const distances = Object.fromEntries([...states].map(([node, state]) => [node, state.distance]));\n  const path = [];\n  let cursor = states.has("emit") ? "emit" : null;\n  while (cursor !== null) {\n    path.push(cursor);\n    cursor = states.get(cursor).parent;\n  }\n  return { processed, distances, path: path.reverse(), reachable: work.size };\n};\n'
  },
  {
    name: "10-map-growth-reduction.ajs",
    source:
      'export default () => {\n  const work = new Map([["start", 0]]);\n  const visited = [];\n  for (const [node, depth] of work) {\n    visited.push([node, depth]);\n    if (node === "start") work.set("end", 1);\n  }\n  return visited;\n};\n'
  },
  {
    name: "11-set-growth-reduction.ajs",
    source:
      'export default () => {\n  const work = new Set(["start"]);\n  const visited = [];\n  for (const node of work) {\n    visited.push(node);\n    if (node === "start") work.add("end");\n  }\n  return visited;\n};\n'
  },
  {
    name: "12-map-update-delete-reduction.ajs",
    source:
      'export default () => {\n  const work = new Map([["start", 0], ["updated", 1], ["deleted", 2]]);\n  const visited = [];\n  for (const [node, depth] of work) {\n    visited.push([node, depth]);\n    if (node === "start") {\n      work.set("updated", 99);\n      work.delete("deleted");\n    }\n  }\n  return visited;\n};\n'
  },
  {
    name: "13-set-delete-reduction.ajs",
    source:
      'export default () => {\n  const work = new Set(["start", "deleted", "kept"]);\n  const visited = [];\n  for (const node of work) {\n    visited.push(node);\n    if (node === "start") work.delete("deleted");\n  }\n  return visited;\n};\n'
  },
  {
    name: "14-eager-map-entries-control.ajs",
    source:
      'export default () => {\n  const work = new Map([["start", 0]]);\n  const entries = work.entries();\n  work.set("end", 1);\n  return [...entries];\n};\n'
  },
  {
    name: "15-array-growth-control.ajs",
    source:
      'export default () => {\n  const work = ["start"];\n  const visited = [];\n  for (const node of work) {\n    visited.push(node);\n    if (node === "start") work.push("end");\n  }\n  return visited;\n};\n'
  }
];

async function verifyCheckpoint(source: string, pauseAt = 1, nativeSource = source) {
  const expected = await new Function("pause", `return (async () => { ${nativeSource} })();`)(
    async () => undefined
  );
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  let release!: (value: undefined) => void;
  let checkpointWritten!: (snapshot: SafeJSSnapshot) => void;
  const gate = new Promise<undefined>((resolve) => {
    release = resolve;
  });
  const checkpoint = new Promise<SafeJSSnapshot>((resolve) => {
    checkpointWritten = resolve;
  });
  let calls = 0;
  const execution = run(source, {
    budget: new Budget({ maxSteps: 20_000 }),
    snapshotIntervalMs: 1,
    snapshotBackend: {
      async read() {
        return undefined;
      },
      async remove() {},
      async write(snapshot) {
        if (snapshot.pendingAwaits !== undefined) {
          checkpointWritten(JSON.parse(serializeSafeJSSnapshot(snapshot)));
        }
      }
    },
    bindings: {
      pause: createSandboxClosure({
        async: true,
        call: () => {
          calls += 1;
          if (calls !== pauseAt) {
            return createSandboxPromise(Promise.resolve(undefined));
          }
          clock.mockReturnValue(2);
          return createSandboxPromise(gate);
        }
      })
    }
  });
  const saved = await Promise.race([
    checkpoint,
    execution.then(() => {
      throw new Error("Execution finished without the selected await checkpoint");
    })
  ]);
  release(undefined);
  const original = await execution;
  expect(saved.pendingAwaits).toMatchObject([
    { span: { start: { offset: source.indexOf("await pause") } } }
  ]);
  expect(saved.loopIterations).toBeDefined();
  expect(saved.replay).toBeDefined();
  expect(original).toMatchObject({ ok: true, returnValue: expected });
  const resumed = await run(source, {
    budget: new Budget({ maxSteps: 20_000 }),
    snapshot: restore(saved, { source }),
    bindings: {
      pause: createSandboxClosure({
        async: true,
        call: () => createSandboxPromise(Promise.resolve(undefined))
      })
    }
  });
  expect(resumed).toMatchObject({ ok: true, returnValue: expected });
}

describe("independent COLL-001 live collection checkpoint validation", () => {
  it.each([
    {
      collection: "Map",
      initial: 'new Map([["a", 1], ["b", 2], ["c", 3]])',
      binding: "[key, value]",
      entry: "[key, value]"
    },
    {
      collection: "Set",
      initial: 'new Set(["a", "b", "c"])',
      binding: "key",
      entry: "key"
    }
  ])(
    "resumes $collection after deleting the current entry",
    async ({ initial, binding, entry }) => {
      await verifyCheckpoint(`
      const work = ${initial};
      const visited = [];
      const after = [];
      for (const ${binding} of work) {
        visited.push(${entry});
        work.delete(key);
        await pause();
        after.push(${entry});
      }
      return { visited, after, remaining: [...work] };
    `);
    }
  );
});

describe("independent COLL-001 original audit payloads", () => {
  it.each(originalCases)(
    "matches independent expected values for $name",
    async ({ name, source }) => {
      const nativeSource =
        name === "14-eager-map-entries-control.ajs"
          ? source.replace("work.entries()", "Array.from(work.entries())")
          : source;
      const expected = new Function(`return ${nativeSource.slice("export default ".length)}`)()();
      const result = await run(source, {
        entryPointArgs: [],
        budget: new Budget({ maxSteps: 20_000 })
      });
      if (name.startsWith("07-") || name.startsWith("08-")) {
        expect(expected).toEqual({
          processed: ["start", "lexer", "cache", "parser", "index", "typecheck", "emit"],
          distances: { start: 0, lexer: 1, cache: 1, parser: 2, index: 2, typecheck: 3, emit: 4 },
          path: ["start", "lexer", "parser", "typecheck", "emit"],
          reachable: 7
        });
      }
      expect(result).toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it.each(
    originalCases
      .slice(0, 2)
      .flatMap((testCase) =>
        Array.from({ length: 7 }, (_, index) => ({ ...testCase, pauseAt: index + 1 }))
      )
  )("resumes $name at worklist visit $pauseAt", async ({ source, pauseAt }) => {
    const body = source.slice(source.indexOf("{") + 1, source.lastIndexOf("}"));
    await verifyCheckpoint(
      body.replace("processed.push(node);", "processed.push(node); await pause();"),
      pauseAt
    );
  });
});

const mutationCases = [
  { name: "unchanged", map: "", set: "" },
  {
    name: "growth",
    map: 'if (key === "a") work.set("d", 4);',
    set: 'if (key === "a") work.add("d");'
  },
  {
    name: "delete next",
    map: 'if (key === "a") work.delete("b");',
    set: 'if (key === "a") work.delete("b");'
  },
  { name: "delete current", map: "work.delete(key);", set: "work.delete(key);" },
  {
    name: "delete visited",
    map: 'if (key === "b") work.delete("a");',
    set: 'if (key === "b") work.delete("a");'
  },
  {
    name: "update next",
    map: 'if (key === "a") work.set("b", 99);',
    set: 'if (key === "a") work.add("b");'
  },
  {
    name: "clear insert",
    map: 'if (key === "a") { work.clear(); work.set("d", 4); }',
    set: 'if (key === "a") { work.clear(); work.add("d"); }'
  },
  {
    name: "reinsert current",
    map: 'if (key === "a" && !reinserted) { reinserted = true; work.delete("a"); work.set("a", 9); }',
    set: 'if (key === "a" && !reinserted) { reinserted = true; work.delete("a"); work.add("a"); }'
  }
].flatMap((mutation) => [
  {
    name: `Map ${mutation.name}`,
    initial: 'new Map([["a", 1], ["b", 2], ["c", 3]])',
    binding: "[key, value]",
    entry: "[key, value]",
    mutation: mutation.map
  },
  {
    name: `Set ${mutation.name}`,
    initial: 'new Set(["a", "b", "c"])',
    binding: "key",
    entry: "key",
    mutation: mutation.set
  }
]);

describe("independent COLL-001 serialized public replay matrix", () => {
  it.each(
    mutationCases.flatMap((testCase) =>
      ["before", "after"].flatMap((position) =>
        [1, 2].map((pauseAt) => ({ ...testCase, position, pauseAt }))
      )
    )
  )(
    "$name, pause $position mutation at visit $pauseAt",
    async ({ initial, binding, entry, mutation, position, pauseAt }) => {
      await verifyCheckpoint(
        `
      const work = ${initial};
      const visited = [];
      const after = [];
      let reinserted = false;
      for (const ${binding} of work) {
        visited.push(${entry});
        ${position === "before" ? "await pause();" : ""}
        ${mutation}
        ${position === "after" ? "await pause();" : ""}
        after.push(${entry});
      }
      return { visited, after, remaining: [...work] };
    `,
        pauseAt
      );
    }
  );

  it.each(
    ["Map", "Set"].flatMap((collection) =>
      ["keys", "values", "entries"].map((method) => ({ collection, method }))
    )
  )("preserves eager $collection $method arrays across resume", async ({ collection, method }) => {
    const source = `
        const work = ${collection === "Map" ? 'new Map([["a", 1], ["b", 2], ["c", 3]])' : 'new Set(["a", "b", "c"])'};
        const snapshot = work.${method}();
        const visited = [];
        for (const entry of snapshot) {
          work.delete("b");
          ${collection === "Map" ? 'work.set("d", 4); work.set("c", 99);' : 'work.add("d");'}
          visited.push(entry);
          await pause();
        }
        return { isArray: Array.isArray(snapshot), visited, remaining: [...work] };
      `;
    await verifyCheckpoint(
      source,
      2,
      source.replace(`work.${method}()`, `Array.from(work.${method}())`)
    );
  });
});

describe("independent COLL-001 raw interpreter cursor validation", () => {
  it.each([
    {
      collection: "Map",
      initial: 'new Map([["a", 1], ["b", 2], ["c", 3]])',
      binding: "[key, value]",
      entry: "[key, value]"
    },
    {
      collection: "Set",
      initial: 'new Set(["a", "b", "c"])',
      binding: "key",
      entry: "key"
    }
  ])("resumes $collection second iteration after deletion", async ({ initial, binding, entry }) => {
    const source = `
      const work = ${initial};
      const visited = [];
      for (const ${binding} of work) {
        visited.push(${entry});
        if (key === "a") work.delete("a");
      }
      return visited;
    `;
    const expected = new Function(source)();
    const module = parseModule(source);
    const program = { type: "BlockStatement" as const, body: module.body, span: module.span };
    const budget = new Budget({ maxSteps: 20_000 });
    const globals = {
      ...createObjectArrayGlobals({ budget }),
      ...createCollectionGlobals({ budget })
    };
    let snapshot: InterpreterSnapshot | undefined;
    let breakpoints = 0;
    const original = await interpret(program, {
      budget,
      bindings: globals,
      onYield: (yieldPoint) => {
        if (yieldPoint.kind !== "loop-iteration" || ++breakpoints !== 2) return;
        const current = yieldPoint.snapshot();
        snapshot = {
          ...current,
          bindings: cloneSandboxValue(current.bindings) as InterpreterSnapshot["bindings"],
          loopIterations: structuredClone(current.loopIterations)
        };
      }
    });
    expect(snapshot).toBeDefined();
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    const resumed = await interpret(program, { budget, bindings: globals, snapshot });
    expect(resumed).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(mutationCases)(
    "restores actual $name state at second visit",
    async ({ name, initial, binding, entry, mutation }) => {
      const source = `
      const work = ${initial};
      const visited = [];
      let reinserted = false;
      for (const ${binding} of work) {
        visited.push(${entry});
        ${mutation}
      }
      return { visited, remaining: [...work] };
    `;
      const expected = new Function(source)();
      const module = parseModule(source);
      const program = { type: "BlockStatement" as const, body: module.body, span: module.span };
      const budget = new Budget({ maxSteps: 20_000 });
      const globals = {
        ...createObjectArrayGlobals({ budget }),
        ...createCollectionGlobals({ budget })
      };
      let snapshot: InterpreterSnapshot | undefined;
      let breakpoints = 0;
      const original = await interpret(program, {
        budget,
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind !== "loop-iteration" || ++breakpoints !== 2) return;
          const current = yieldPoint.snapshot();
          snapshot = {
            ...current,
            bindings: cloneSandboxValue(current.bindings) as InterpreterSnapshot["bindings"],
            loopIterations: structuredClone(current.loopIterations)
          };
        }
      });
      expect(snapshot).toBeDefined();
      expect(original).toMatchObject({ ok: true, returnValue: expected });
      const resumed = await interpret(program, { budget, bindings: globals, snapshot });
      expect(resumed.ok).toBe(true);
      expect(resumed.ok ? resumed.returnValue : resumed, name).toEqual(expected);
    }
  );
});
