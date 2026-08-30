import { describe, expect, it, vi } from "vitest";

import {
  Budget,
  declareHostOperation,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  dump,
  restore,
  run
} from "@poe-code/safe-js";
import { bounded, deferred } from "../../test/fixtures/final-async-proof.js";

const minimalSource = `const values = await host(() => {
  const values = [1];
  values.metadata = 7;
  return values;
});
return [Object.keys(values), Object.hasOwn(values, "metadata"), values.metadata === 7];`;

const graphSetup = `const shared = { value: 7 };
const values = new Array(6);
values[1] = undefined;
values[3] = shared;
values[4] = values;
values.metadata = shared;
values.raw = values;
values.map = 0;
values.forEach = 0;
values["01"] = shared;
values["-1"] = shared;
values["1.5"] = shared;
values["4294967295"] = shared;
shared.values = values;
const graph = {
  values,
  alias: values,
  shared,
  map: new Map([[values, shared], [shared, values]]),
  set: new Set([values, shared])
};`;

const graphObservation = `return {
  length: graph.values.length,
  keys: Object.keys(graph.values),
  leadingHole: !Object.hasOwn(graph.values, "0"),
  explicitUndefined: Object.hasOwn(graph.values, "1") && graph.values[1] === undefined,
  middleHole: !Object.hasOwn(graph.values, "2"),
  trailingHole: !Object.hasOwn(graph.values, "5"),
  indexedAlias: graph.values[3] === graph.shared,
  indexedCycle: graph.values[4] === graph.values,
  metadata: graph.values.metadata === graph.shared,
  raw: graph.values.raw === graph.values,
  mapShadow: graph.values.map === 0,
  forEachShadow: graph.values.forEach === 0,
  leadingZeroName: graph.values["01"] === graph.shared,
  negativeName: graph.values["-1"] === graph.shared,
  fractionalName: graph.values["1.5"] === graph.shared,
  nonIndexName: graph.values["4294967295"] === graph.shared,
  objectAlias: graph.alias === graph.values,
  backlink: graph.shared.values === graph.values,
  mapKey: graph.map.get(graph.values) === graph.shared,
  mapValue: graph.map.get(graph.shared) === graph.values,
  setArray: graph.set.has(graph.values),
  setObject: graph.set.has(graph.shared)
};`;

const expectedGraph = {
  length: 6,
  keys: ["1", "3", "4", "metadata", "raw", "map", "forEach", "01", "-1", "1.5", "4294967295"],
  leadingHole: true,
  explicitUndefined: true,
  middleHole: true,
  trailingHole: true,
  indexedAlias: true,
  indexedCycle: true,
  metadata: true,
  raw: true,
  mapShadow: true,
  forEachShadow: true,
  leadingZeroName: true,
  negativeName: true,
  fractionalName: true,
  nonIndexName: true,
  objectAlias: true,
  backlink: true,
  mapKey: true,
  mapValue: true,
  setArray: true,
  setObject: true
};

const makeGraph = new Function(`${graphSetup} return graph;`) as () => unknown;
const observeGraph = new Function("graph", graphObservation) as (graph: unknown) => unknown;

describe("host array own-data boundaries", () => {
  it("preserves metadata on a guest-created array returned through a pure host", async () => {
    const expected = [["0", "metadata"], true, true];
    const native: unknown = await new Function(
      "host",
      `return (async () => {${minimalSource}})();`
    )(async (callback: () => unknown) => callback());
    expect(native).toStrictEqual(expected);
    const observed: unknown[] = [];
    const host = vi.fn(async (callback: () => unknown) => {
      const value = await callback();
      if (!Array.isArray(value)) throw new Error("Expected callback array");
      observed.push([
        Object.keys(value),
        Object.hasOwn(value, "metadata"),
        Object.getOwnPropertyDescriptor(value, "metadata")?.value === 7
      ]);
      return value;
    });
    const result = await run(minimalSource, {
      bindings: { host: declareHostOperation(host, "read-side-effect") }
    });
    expect(observed).toStrictEqual([expected]);
    expect(host).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful execution");
    expect(deepCopyFromSandbox(result.returnValue)).toStrictEqual(native);
  });

  it.each(["callback result", "callback argument", "host result"])(
    "preserves the full graph through %s and two completed replays",
    async (direction) => {
      const source =
        direction === "callback result"
          ? `const graph = await host(() => { ${graphSetup} return graph; }); ${graphObservation}`
          : direction === "callback argument"
            ? `return await host(graph => { ${graphObservation} });`
            : `const graph = await host(); ${graphObservation}`;
      const invoke = async (...args: unknown[]): Promise<unknown> => {
        if (direction === "host result") return makeGraph();
        const callback = args[0];
        if (typeof callback !== "function") throw new Error("Expected guest callback");
        if (direction === "callback argument") return callback(makeGraph());
        const graph: unknown = await callback();
        expect(observeGraph(graph)).toStrictEqual(expectedGraph);
        return graph;
      };
      const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
        invoke
      );
      expect(native).toStrictEqual(expectedGraph);
      const host = vi.fn(invoke);
      const provider = vi.fn(() => {
        throw new Error("Completed graph must not request a proof");
      });
      const bindings = { host: declareHostOperation(host, "read-side-effect") };
      let serialized: string | undefined;
      for (let round = 0; round < 3; round += 1) {
        const result = await run(source, {
          bindings,
          hostCallResumeProvider: provider,
          budget: new Budget({ maxSteps: 10000, arrayLength: 128, dataSize: 200000 }),
          ...(serialized === undefined
            ? {}
            : { snapshot: restore(JSON.parse(serialized), { source }) })
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("Expected successful graph execution");
        expect(structuredClone(deepCopyFromSandbox(result.returnValue))).toStrictEqual(native);
        serialized = await dump(result);
        host.mockImplementation(async () => {
          throw new Error("Completed graph must not reissue host");
        });
      }
      expect(host).toHaveBeenCalledTimes(1);
      expect(provider).not.toHaveBeenCalled();
    }
  );

  it("preserves acyclic guest argument own data before host invocation and completed replay", async () => {
    const source = `const shared = { value: 7 };
const values = new Array(3);
values[1] = shared;
values.metadata = shared;
values.raw = ["text"];
values["01"] = shared;
return host(values);`;
    const inspect = (value: unknown) => {
      if (!Array.isArray(value)) throw new Error("Expected guest argument array");
      return {
        length: value.length,
        keys: Object.keys(value),
        leadingHole: !Object.hasOwn(value, "0"),
        trailingHole: !Object.hasOwn(value, "2"),
        metadataAlias: Object.getOwnPropertyDescriptor(value, "metadata")?.value === value[1],
        namedAlias: Object.getOwnPropertyDescriptor(value, "01")?.value === value[1],
        raw: Object.getOwnPropertyDescriptor(value, "raw")?.value
      };
    };
    const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
      inspect
    );
    expect(native).toStrictEqual({
      length: 3,
      keys: ["1", "metadata", "raw", "01"],
      leadingHole: true,
      trailingHole: true,
      metadataAlias: true,
      namedAlias: true,
      raw: ["text"]
    });
    const host = vi.fn(inspect);
    const bindings = { host: declareHostOperation(host, "read-side-effect") };
    const initial = await run(source, { bindings });
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error("Expected guest argument observation");
    expect(structuredClone(deepCopyFromSandbox(initial.returnValue))).toStrictEqual(native);
    host.mockImplementation(() => {
      throw new Error("Completed argument observation must not reissue host");
    });
    const replayed = await run(source, {
      bindings,
      snapshot: restore(JSON.parse(await dump(initial)), { source })
    });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) throw new Error("Expected completed argument observation");
    expect(structuredClone(deepCopyFromSandbox(replayed.returnValue))).toStrictEqual(native);
    expect(host).toHaveBeenCalledTimes(1);
  });

  it("keeps generic copying in both directions graph-preserving and detached", () => {
    const original = makeGraph();
    const sandbox = deepCopyToSandbox(original);
    const copied = deepCopyFromSandbox(sandbox);
    expect(observeGraph(copied)).toStrictEqual(expectedGraph);
    expect(copied).not.toBe(original);
    expect(sandbox).not.toBe(original);
  });

  it("preserves source function identity and arity in array own data", async () => {
    const source = `let count = 2;
const values = await host(() => {
  const values = [1];
  const compute = (first, second = 0, ...rest) => count + first + second + rest.length;
  values.compute = compute;
  values.alias = compute;
  return values;
});
count = 7;
return {
  keys: Object.keys(values),
  alias: values.compute === values.alias,
  value: typeof values.compute === "function" ? values.compute(1) : null,
  arity: typeof values.compute === "function" ? values.compute.length : null
};`;
    const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
      async (callback: () => unknown) => callback()
    );
    expect(native).toStrictEqual({
      keys: ["0", "compute", "alias"],
      alias: true,
      value: 8,
      arity: 1
    });
    const host = vi.fn(async (callback: () => unknown) => callback());
    const bindings = { host: declareHostOperation(host, "read-side-effect") };
    const initial = await run(source, { bindings });
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error("Expected source function graph");
    expect(structuredClone(deepCopyFromSandbox(initial.returnValue))).toStrictEqual(native);
    host.mockImplementation(async () => {
      throw new Error("Completed source function graph must not reissue host");
    });
    const replayed = await run(source, {
      bindings,
      snapshot: restore(JSON.parse(await dump(initial)), { source })
    });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) throw new Error("Expected completed source function graph");
    expect(structuredClone(deepCopyFromSandbox(replayed.returnValue))).toStrictEqual(native);
    expect(host).toHaveBeenCalledTimes(1);
  });

  it.each(["0", "metadata", "raw", "map"])(
    "rejects an enumerable %s accessor without invoking it in either direction",
    async (key) => {
      const accessor = vi.fn(() => 7);
      const values = [1];
      Object.defineProperty(values, key, { enumerable: true, get: accessor });
      expect(() => deepCopyToSandbox(values)).toThrow("accessor property");
      expect(() => deepCopyFromSandbox(values)).toThrow("accessor property");
      const result = await run(
        'try { await host(); return "accepted"; } catch (error) { return error.message; }',
        { bindings: { host: () => values } }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected a handled conversion error");
      expect(result.returnValue).toContain("accessor property");
      expect(accessor).not.toHaveBeenCalled();
    }
  );

  it("preserves existing hidden-index copying without exposing hidden named data", async () => {
    const accessor = vi.fn(() => 7);
    const values: unknown[] = [];
    Object.defineProperty(values, "2", { value: undefined, enumerable: false });
    Object.defineProperty(values, "metadata", { get: accessor, enumerable: false });
    const result = await run(
      'const values = host(); return [values.length, Object.keys(values), Object.hasOwn(values, "2"), Object.hasOwn(values, "metadata")];',
      { bindings: { host: () => values } }
    );
    expect(result).toMatchObject({ ok: true, returnValue: [3, ["2"], true, false] });
    expect(accessor).not.toHaveBeenCalled();
  });

  it("keeps generic native-function rejection for named array values", () => {
    const native = vi.fn(() => 7);
    const values = [1];
    Object.defineProperty(values, "metadata", { value: native, enumerable: true });
    expect(() => deepCopyToSandbox(values)).toThrow("function");
    expect(native).not.toHaveBeenCalled();
  });

  it("charges copied named keys without charging synthesized numeric indices as strings", async () => {
    const indexed: number[] = [];
    indexed[10] = 1;
    const indexedResult = await run("return host();", {
      bindings: { host: () => indexed },
      budget: new Budget({ stringLength: 1 })
    });
    expect(indexedResult.ok).toBe(true);
    if (!indexedResult.ok) throw new Error("Expected unchanged numeric-index copying");
    expect(deepCopyFromSandbox(indexedResult.returnValue)).toStrictEqual(indexed);
    const named = [1];
    Object.defineProperty(named, "label", { value: 1, enumerable: true });
    await expect(
      run("return host();", {
        bindings: { host: () => named },
        budget: new Budget({ stringLength: 4 })
      })
    ).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "stringLength",
      current: 5,
      limit: 4
    });
  });

  it("uses source provenance when converting proof array metadata", async () => {
    const source = `const values = await host(async () => {
  await gate();
  const values = [1];
  const compute = (first, second = 0) => first + second + 7;
  values.compute = compute;
  values.alias = compute;
  values.raw = values;
  return values;
});
return [values.compute(1), values.compute.length, values.compute === values.alias, values.raw === values];`;
    const entered = deferred<void>();
    const gate = deferred<void>();
    const execution = run(source, {
      bindings: {
        host: declareHostOperation(
          async (callback: () => unknown) => callback(),
          "read-side-effect"
        ),
        gate: declareHostOperation(() => {
          entered.release();
          return gate.promise;
        }, "re-issue")
      }
    });
    await bounded(entered.promise, "array callback entered");
    let serialized: string;
    try {
      serialized = await bounded(dump(execution, { mode: "replay" }), "array callback capture");
    } finally {
      gate.release();
      await bounded(execution, "array callback completion");
    }
    const native = vi.fn(() => 7);
    const invalid = [1];
    Object.defineProperty(invalid, "metadata", { value: native, enumerable: true });
    const result = await bounded(
      run(source, {
        snapshot: restore(JSON.parse(serialized), { source }),
        bindings: {
          host: declareHostOperation(() => {
            throw new Error("Proof must not reissue host");
          }, "read-side-effect"),
          gate: declareHostOperation(async () => undefined, "re-issue")
        },
        hostCallResumeProvider: async (request, context) => {
          if (context === undefined) throw new Error("Expected callback proof context");
          const value = await context.replayed[0].result;
          expect(() => context.toSandboxValue(invalid)).toThrow("function");
          expect(() => deepCopyToSandbox(value)).toThrow("function");
          return {
            ...request,
            callbackDisposition: "joined",
            outcome: { status: "fulfilled", value: context.toSandboxValue(value) }
          };
        }
      }),
      "array metadata proof conversion"
    );
    expect(result).toMatchObject({ ok: true, returnValue: [8, 1, true, true] });
    expect(native).not.toHaveBeenCalled();
  });
});
