import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox } from "./values.js";
import { decodeReplayData, encodeReplayData } from "../snapshot/replay-data.js";
import { digestHostCallArguments } from "./host-call.js";
import { serialize } from "../snapshot/serialize.js";
import { restore as restoreRuntime } from "../snapshot/restore.js";
import { parseModule } from "../parse/parser.js";

describe("Float32Array", () => {
  it("rejects an incomplete backing-byte record rather than filling a missing byte", () => {
    const encoded = encodeReplayData(deepCopyToSandbox(new Float32Array([1])));
    const storage = encoded.nodes.find((node) => node.kind === "float32array");
    if (storage?.kind !== "float32array" || !("bytes" in storage))
      throw new Error("Missing typed storage");
    delete storage.bytes[0];
    expect(() => decodeReplayData(encoded)).toThrowError(
      expect.objectContaining({ name: "SnapshotValidationError", code: "invalidType" })
    );
  });

  it("uses typed assignment rules for Object.assign and enumerates own indices", async () => {
    const source = `
      const values = new Float32Array(2);
      Object.assign(values, { '0': 0.1, '5': 9, metadata: 'typed' });
      const keys = [];
      for (const key in values) keys.push(key);
      let fixed = false;
      try { Object.assign(values, { length: 10 }); } catch (error) { fixed = error.name === 'TypeError'; }
      return { values: Array.from(values), metadata: values.metadata, keys, length: values.length, fixed };
    `;
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(Function(`'use strict';\n${source}`)());
  });

  it("replays a pending checkpoint with typed host outcomes and shared views", async () => {
    let produced = 0;
    let waited = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const produce = declareHostOperation(() => {
      produced += 1;
      const values = new Float32Array([1, 2, 3]);
      return { values, alias: values, tail: values.subarray(1), map: new Map([[values, values]]) };
    }, "read-side-effect");
    const wait = declareHostOperation(async () => {
      waited += 1;
      entered();
      if (waited === 1) await gate;
      return 1;
    }, "re-issue");
    const source = `
      const graph = await produce();
      await wait();
      graph.tail[0] = 0.1;
      return { typed: graph.values instanceof Float32Array, alias: graph.values === graph.alias,
        map: graph.map.get(graph.values) === graph.values, values: graph.values, tail: graph.tail };
    `;
    const execution = run(source, { bindings: { produce, wait } });
    try {
      await paused;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const snapshot = restore(JSON.parse(await dump(execution, { mode: "replay" })), { source });
      release();
      const initial = await execution;
      const resumed = await run(source, { bindings: { produce, wait }, snapshot });
      expect(initial.ok).toBe(true);
      expect(resumed.ok).toBe(true);
      if (!initial.ok) throw initial.error;
      if (!resumed.ok) throw resumed.error;
      expect(resumed.returnValue).toEqual(initial.returnValue);
      const graph = resumed.returnValue as {
        typed: boolean;
        alias: boolean;
        map: boolean;
        values: Float32Array;
        tail: Float32Array;
      };
      expect([graph.typed, graph.alias, graph.map]).toEqual([true, true, true]);
      expect(graph.values[1]).toBe(Math.fround(0.1));
      expect(graph.tail.buffer).toBe(graph.values.buffer);
      expect(produced).toBe(1);
      expect(waited).toBe(2);
    } finally {
      release();
      await execution;
    }
  });

  it("distinguishes typed storage and signed zero in host argument digests", () => {
    const typed = new Float32Array([0]);
    const negative = new Float32Array([-0]);
    expect(digestHostCallArguments([typed])).not.toBe(digestHostCallArguments([{ 0: 0 }]));
    expect(digestHostCallArguments([typed])).not.toBe(digestHostCallArguments([negative]));
    expect(digestHostCallArguments([typed])).toBe(
      digestHostCallArguments([new Float32Array(typed)])
    );
    let calls = 0;
    Object.assign(typed, {
      toJSON: () => {
        calls += 1;
        return 0;
      }
    });
    digestHostCallArguments([typed]);
    expect(calls).toBe(0);
  });

  it("restores low-level typed view graphs without flattening storage or metadata", () => {
    const source = "return 1;";
    const values = Object.assign(new Float32Array([0.1, -0, NaN]), {
      metadata: {} as { owner?: Float32Array }
    });
    values.metadata.owner = values;
    const graph = { values, alias: values, tail: values.subarray(1) };
    const nodeId = parseModule(source).body[0]!.nodeId;
    if (nodeId === undefined) throw new Error("Missing statement node ID");
    const snapshot = serialize({
      source,
      currentAstNodeId: nodeId,
      scopeChain: [{ id: "module", bindings: { graph } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const restored = restoreRuntime(JSON.parse(JSON.stringify(snapshot)), {
      source
    }).currentScope.lookup("graph");
    expect(restored.found).toBe(true);
    if (!restored.found) throw new Error("Missing graph");
    const copy = restored.value as typeof graph;
    expect(copy.values).toBeInstanceOf(Float32Array);
    expect(copy.values).toBe(copy.alias);
    expect(copy.values.metadata.owner).toBe(copy.values);
    expect(copy.tail.buffer).toBe(copy.values.buffer);
    expect(Array.from(new Uint8Array(copy.values.buffer))).toEqual(
      Array.from(new Uint8Array(values.buffer))
    );
  });

  it("exports typed arguments and genuine callable metadata without invoking digest hooks", async () => {
    let calls = 0;
    const host = declareHostOperation(
      async (
        values: Float32Array & { toJSON: (value: number) => Promise<number>; metadata: object },
        alias: unknown
      ) => {
        calls += 1;
        expect(values).toBeInstanceOf(Float32Array);
        expect(values).toBe(alias);
        expect(values.toJSON.length).toBe(1);
        expect(await values.toJSON(3)).toBe(4);
        return values;
      },
      "read-side-effect"
    );
    const source = `
      let invoked = 0;
      function compute(value) { invoked++; return value + 1; }
      const values = new Float32Array([0.1, -0]);
      values.toJSON = compute;
      values.metadata = { label: 'typed' };
      const result = await host(values, values);
      return { invoked, sameFunction: result.toJSON === compute, data: Array.from(result), label: result.metadata.label };
    `;
    const execution = run(source, { bindings: { host } });
    const result = await execution;
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual({
      invoked: 1,
      sameFunction: true,
      data: [Math.fround(0.1), -0],
      label: "typed"
    });
    const snapshot = restore(JSON.parse(await dump(execution, { mode: "capture" })), { source });
    const replay = await run(source, { bindings: { host }, snapshot });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw replay.error;
    expect(replay.returnValue).toEqual(result.returnValue);
    expect(calls).toBe(1);
  });

  it("keeps the bounded constructor and method surface explicit", async () => {
    const result = await run(`
      const values = new Float32Array([1, 2, 3]);
      let bounds = false;
      let arrayLike = false;
      try { values.set([4], 3); } catch (error) { bounds = error.name === 'RangeError'; }
      try { new Float32Array({ length: 2 }); } catch (error) { arrayLike = error.name === 'TypeError'; }
      return { bounds, arrayLike, buffer: typeof values.buffer, from: typeof Float32Array.from,
        factory: typeof Float32Array['of'], arrayBuffer: typeof ArrayBuffer, other: typeof Float64Array,
        constructorLength: Float32Array.length, width: values.BYTES_PER_ELEMENT,
        copy: Array.from(values.slice(-2)), empty: values.subarray(2, 1).length };
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual({
      bounds: true,
      arrayLike: true,
      buffer: "undefined",
      from: "undefined",
      factory: "undefined",
      arrayBuffer: "undefined",
      other: "undefined",
      constructorLength: 3,
      width: 4,
      copy: [2, 3],
      empty: 0
    });
  });
  it("rounds indexed stores without changing assignment results or type", async () => {
    const result = await run(`
      const values = new Float32Array(3);
      const assigned = values[0] = 0.1;
      values[1] = -0;
      values[2] = 16777217;
      return { assigned, values, typed: values instanceof Float32Array,
        array: Array.isArray(values), length: values.length, bytes: values.byteLength,
        width: Float32Array.BYTES_PER_ELEMENT, keys: Object.keys(values) };
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual({
      assigned: 0.1,
      values: new Float32Array([0.1, -0, 16777217]),
      typed: true,
      array: false,
      length: 3,
      bytes: 12,
      width: 4,
      keys: ["0", "1", "2"]
    });
  });

  it.each([
    "new Float32Array()",
    "new Float32Array(2.9)",
    "new Float32Array([0.1, undefined, null, true, '2.5', -0, Infinity, -Infinity, NaN])",
    "new Float32Array(new Float32Array([0.1, 0.2]))"
  ])("constructs %s", async (expression) => {
    const result = await run(`return ${expression};`);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const expected = Function(`return ${expression};`)() as Float32Array;
    expect(result.returnValue).toBeInstanceOf(Float32Array);
    expect(result.returnValue).toEqual(expected);
  });

  it("keeps integer indexing, ordinary named properties, and fixed length distinct", async () => {
    const result = await run(`
      const values = new Float32Array(2);
      values[2] = 9;
      values[-1] = 9;
      values['-0'] = 9;
      values['01'] = 4;
      values.metadata = values;
      let fixed = false;
      try { values.length = 10; } catch (error) { fixed = error.name === 'TypeError'; }
      return { keys: Object.keys(values), missing: values[2], first: values[0],
        length: values.length, fixed, named: values['01'], cycle: values.metadata === values };
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual({
      keys: ["0", "1", "01", "metadata"],
      missing: undefined,
      first: 0,
      length: 2,
      fixed: true,
      named: 4,
      cycle: true
    });
  });

  it("preserves subarray storage aliases and overlapping set while slice copies", async () => {
    const result = await run(`
      const values = new Float32Array([1, 2, 3, 4]);
      const tail = values.subarray(1, 3);
      tail[0] = 0.1;
      const copy = values.slice(1, 3);
      values.set(values.subarray(0, 3), 1);
      return { values, tail, copy, offset: tail.byteOffset };
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const values = new Float32Array([1, 2, 3, 4]);
    const tail = values.subarray(1, 3);
    tail[0] = 0.1;
    const copy = values.slice(1, 3);
    values.set(values.subarray(0, 3), 1);
    expect(result.returnValue).toEqual({ values, tail, copy, offset: 4 });
    const returned = result.returnValue as {
      values: Float32Array;
      tail: Float32Array;
      copy: Float32Array;
    };
    expect(returned.tail.buffer).toBe(returned.values.buffer);
    expect(returned.copy.buffer).not.toBe(returned.values.buffer);
  });

  it("iterates elements using typed storage rather than own shadowed methods", async () => {
    const result = await run(`
      const values = new Float32Array([1, 2]);
      values.map = 0;
      values.values = 0;
      const copied = Array.from(values);
      let total = 0;
      for (const value of values) total += value;
      return { copied, total, shadow: values.map };
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual({ copied: [1, 2], total: 3, shadow: 0 });
  });

  it("uses the actual method receiver and rejects unbound or non-typed receivers", async () => {
    const result = await run(`
      const first = new Float32Array([1, 2]);
      const second = new Float32Array([3, 4]);
      const setter = first.set;
      setter.call(second, [0.1]);
      const slice = first.slice;
      const copied = slice.call(second, 0, 1);
      let unbound = false;
      let ordinary = false;
      try { setter([9]); } catch (error) { unbound = error.name === 'TypeError'; }
      try { setter.call([], [9]); } catch (error) { ordinary = error.name === 'TypeError'; }
      return { first, second, copied, unbound, ordinary };
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual({
      first: new Float32Array([1, 2]),
      second: new Float32Array([0.1, 4]),
      copied: new Float32Array([0.1]),
      unbound: true,
      ordinary: true
    });
  });

  it("does not invoke accessors or conversion callbacks on unsupported inputs", async () => {
    let reads = 0;
    const values = new Float32Array([1]);
    Object.defineProperty(values, "metadata", {
      enumerable: true,
      get: () => {
        reads += 1;
        return 1;
      }
    });
    expect(() => deepCopyToSandbox(values)).toThrow(/accessor/);
    await expect(run("return values[0];", { bindings: { values } })).rejects.toThrow(/accessor/);
    const result = await run(`
      let called = 0;
      const values = new Float32Array(1);
      try { values[0] = { valueOf() { called++; return 1; } }; } catch (error) {}
      return { called, value: values[0] };
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual({ called: 0, value: 0 });
    expect(reads).toBe(0);
  });

  it("preserves exact binary32 storage through input, clone, and replay copies", () => {
    const values = new Float32Array([
      1,
      0.1,
      1 + 2 ** -24,
      2 ** -149,
      2 ** -150,
      -0,
      NaN,
      Infinity,
      -Infinity
    ]);
    const bytes = Array.from(new Uint8Array(values.buffer));
    for (const copy of [
      deepCopyFromSandbox(deepCopyToSandbox(values)),
      deepCopyFromSandbox(cloneSandboxValue(deepCopyToSandbox(values))),
      deepCopyFromSandbox(decodeReplayData(encodeReplayData(deepCopyToSandbox(values))))
    ]) {
      expect(copy).toBeInstanceOf(Float32Array);
      const typed = copy as Float32Array;
      expect(Array.from(new Uint8Array(typed.buffer))).toEqual(bytes);
    }
  });

  it("keeps generic native functions and other native typed-array kinds rejected", () => {
    expect(() => deepCopyToSandbox(new Uint8Array([1]))).toThrow(/Unsupported sandbox value/);
    expect(() => deepCopyToSandbox(new Float64Array([1]))).toThrow(/Unsupported sandbox value/);
    const values = Object.assign(new Float32Array([1]), { callback: () => 1 });
    expect(() => deepCopyToSandbox(values)).toThrow(/Unsupported sandbox value/);
  });

  it("supports initial typed input graphs and structuredClone without sharing caller memory", async () => {
    const values = new Float32Array([1, 2, 3]);
    const result = await run(
      `
      const copy = structuredClone({ values: input.values, alias: input.alias, tail: input.tail });
      copy.tail[0] = 0.1;
      return { copy, same: copy.values === copy.alias, original: input.values[1] };
    `,
      { bindings: { input: { values, alias: values, tail: values.subarray(1) } } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const returned = result.returnValue as {
      copy: { values: Float32Array; alias: Float32Array; tail: Float32Array };
      same: boolean;
      original: number;
    };
    expect(returned.same).toBe(true);
    expect(returned.original).toBe(2);
    expect(returned.copy.values[1]).toBe(Math.fround(0.1));
    expect(returned.copy.tail.buffer).toBe(returned.copy.values.buffer);
    expect(values[1]).toBe(2);
  });

  it.each(["Float32Array(2)", "new Float32Array(-1)", "new Float32Array(Infinity)"])(
    "rejects invalid construction %s",
    async (expression) => {
      const result = await run(`try { ${expression}; } catch (error) { return error.name; }`);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toBe(
        expression.startsWith("Float32Array(") ? "TypeError" : "RangeError"
      );
    }
  );

  it.each([
    { budget: new Budget({ arrayLength: 2 }), source: "new Float32Array(3)", name: "arrayLength" },
    { budget: new Budget({ dataSize: 1024 }), source: "new Float32Array(256)", name: "dataSize" }
  ])("enforces $name before allocation", async ({ budget, source, name }) => {
    await expect(run(`return ${source};`, { budget })).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: name
    });
  });

  it("copies host graphs, aliases, named data, and shared backing stores", () => {
    const values = Object.assign(new Float32Array([0.1, -0, NaN]), {
      metadata: {} as { owner?: Float32Array },
      raw: "raw",
      map: 0
    });
    values.metadata.owner = values;
    const graph = {
      values,
      alias: values,
      tail: values.subarray(1),
      map: new Map([[values, values]])
    };
    for (const copy of [
      deepCopyFromSandbox(deepCopyToSandbox(graph)),
      deepCopyFromSandbox(cloneSandboxValue(deepCopyToSandbox(graph))),
      deepCopyFromSandbox(decodeReplayData(encodeReplayData(deepCopyToSandbox(graph))))
    ]) {
      const returned = copy as typeof graph;
      expect(returned.values).toBeInstanceOf(Float32Array);
      expect(returned.values).not.toBe(values);
      expect(returned.values).toBe(returned.alias);
      expect(returned.values.metadata.owner).toBe(returned.values);
      expect(returned.values.raw).toBe("raw");
      expect(returned.values.map).toBe(0);
      expect(returned.tail.buffer).toBe(returned.values.buffer);
      expect(returned.map.get(returned.values)).toBe(returned.values);
      expect(Object.is(returned.tail[0], -0)).toBe(true);
      expect(Number.isNaN(returned.tail[1])).toBe(true);
    }
  });

  it("retains typed host outcomes and callback graph identity through completed replay", async () => {
    let calls = 0;
    const host = declareHostOperation(async (callback: () => Promise<unknown>) => {
      calls += 1;
      const result = (await callback()) as {
        values: Float32Array;
        tail: Float32Array;
        alias: Float32Array;
      };
      expect(result.values).toBeInstanceOf(Float32Array);
      expect(result.values).toBe(result.alias);
      expect(result.tail.buffer).toBe(result.values.buffer);
      return result;
    }, "read-side-effect");
    const source = `
      const result = await host(() => {
        const values = new Float32Array([1, 2, 3]);
        values.metadata = { owner: values };
        values.raw = values;
        values.map = 0;
        return { values, alias: values, tail: values.subarray(1) };
      });
      result.tail[0] = 0.1;
      return { typed: result.values instanceof Float32Array,
        alias: result.values === result.alias, cycle: result.values.metadata.owner === result.values,
        raw: result.values.raw === result.values, shadow: result.values.map,
        stored: result.values[1], tail: result.tail[0] };
    `;
    let snapshot;
    for (let round = 0; round < 3; round += 1) {
      const execution = run(source, { bindings: { host }, snapshot });
      const result = await execution;
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual({
        typed: true,
        alias: true,
        cycle: true,
        raw: true,
        shadow: 0,
        stored: Math.fround(0.1),
        tail: Math.fround(0.1)
      });
      snapshot = restore(JSON.parse(await dump(execution, { mode: "capture" })), { source });
    }
    expect(calls).toBe(1);
  });
});
