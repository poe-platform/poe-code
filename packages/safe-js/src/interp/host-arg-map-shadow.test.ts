import { describe, expect, it, vi } from "vitest";

import {
  declareHostOperation,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  dump,
  restore,
  run
} from "@poe-code/safe-js";
import { bounded, deferred } from "../../test/fixtures/final-async-proof.js";

const minimalSource = "const values = [1]; values.map = 0; return host(values);";

const graphSource = `const shared = { value: 7 };
const input = new Array(6);
const nested = [shared];
nested.map = 0;
nested.metadata = shared;
input[1] = undefined;
input[3] = shared;
input[4] = nested;
input.metadata = shared;
input.raw = input;
input.map = 0;
input.forEach = 0;
input["01"] = shared;
input["-1"] = shared;
input["4294967295"] = shared;
return host(input);`;

const graphObservation = `return {
  length: values.length,
  keys: Object.keys(values),
  leadingHole: !Object.hasOwn(values, "0"),
  explicitUndefined: Object.hasOwn(values, "1") && values[1] === undefined,
  middleHole: !Object.hasOwn(values, "2"),
  trailingHole: !Object.hasOwn(values, "5"),
  value: values[3].value,
  metadata: values.metadata === values[3],
  raw: values.raw === values,
  mapShadow: values.map === 0,
  forEachShadow: values.forEach === 0,
  leadingZeroName: values["01"] === values[3],
  negativeName: values["-1"] === values[3],
  nonIndexName: values["4294967295"] === values[3],
  nestedAlias: values[4][0] === values[3],
  nestedMetadata: values[4].metadata === values[3],
  nestedMapShadow: values[4].map === 0,
  returnedCycle: values.cycle === values
};`;

const observeGraph = new Function("values", graphObservation) as (values: unknown) => unknown;

describe("host argument array method shadows", () => {
  it("invokes the host once with own map data and returns the native result", async () => {
    const expected = 1;
    const nativeHost = vi.fn(() => expected);
    const native: unknown = await new Function(
      "host",
      `return (async () => {` + minimalSource + `})();`
    )(nativeHost);
    expect(native).toBe(expected);
    expect(nativeHost).toHaveBeenCalledTimes(1);
    const host = vi.fn((values: unknown) => {
      expect(Array.isArray(values)).toBe(true);
      expect(Object.keys(values as object)).toStrictEqual(["0", "map"]);
      expect(Object.getOwnPropertyDescriptor(values, "map")?.value).toBe(0);
      return expected;
    });
    const result = await run(minimalSource, {
      bindings: { host: declareHostOperation(host, "read-side-effect") }
    });
    expect(result).toMatchObject({ ok: true, returnValue: native });
    expect(host).toHaveBeenCalledTimes(1);
  });

  it.each(["null", "undefined", "false", '"shadow"'])(
    "preserves own map data %s without invoking it",
    async (shadow) => {
      const source = `const values = [1]; values.map = ${shadow}; return host(values);`;
      const host = vi.fn((values: unknown) => {
        if (!Array.isArray(values)) throw new Error("Expected array argument");
        return [Object.keys(values), Object.getOwnPropertyDescriptor(values, "map")?.value];
      });
      const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
        host
      );
      expect(host).toHaveBeenCalledTimes(1);
      host.mockClear();
      const result = await run(source, { bindings: { host } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected successful shadowed array call");
      expect(deepCopyFromSandbox(result.returnValue)).toStrictEqual(native);
      expect(host).toHaveBeenCalledTimes(1);
    }
  );

  it("does not invoke a guest source function stored in map while preserving its arity", async () => {
    const source = `let invoked = 0;
const values = [1];
values.map = (first, second = 0) => { invoked++; return first + second; };
const result = host(values);
return [result, invoked, values.map.length];`;
    const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
      () => 1
    );
    expect(native).toStrictEqual([1, 0, 1]);
    const host = vi.fn(() => 1);
    const bindings = { host: declareHostOperation(host, "read-side-effect") };
    const initial = await run(source, { bindings });
    expect(initial).toMatchObject({ ok: true, returnValue: native });
    host.mockImplementation(() => {
      throw new Error("Completed host must not reissue");
    });
    const completed = await run(source, {
      bindings,
      snapshot: restore(JSON.parse(await dump(initial)), { source })
    });
    expect(completed).toMatchObject({ ok: true, returnValue: native });
    expect(host).toHaveBeenCalledTimes(1);
  });

  it("preserves sparse data, aliases and supported named cycles through completed replays", async () => {
    const observations: unknown[] = [];
    const invoke = (values: unknown) => {
      if (!Array.isArray(values)) throw new Error("Expected array graph");
      observations.push(observeGraph(values));
      Object.defineProperty(values, "cycle", { value: values, enumerable: true });
      return values;
    };
    const native: unknown = await new Function("host", `return (async () => {${graphSource}})();`)(
      invoke
    );
    const expected = observeGraph(native);
    expect(expected).toStrictEqual({
      length: 6,
      keys: ["1", "3", "4", "metadata", "raw", "map", "forEach", "01", "-1", "4294967295", "cycle"],
      leadingHole: true,
      explicitUndefined: true,
      middleHole: true,
      trailingHole: true,
      value: 7,
      metadata: true,
      raw: true,
      mapShadow: true,
      forEachShadow: true,
      leadingZeroName: true,
      negativeName: true,
      nonIndexName: true,
      nestedAlias: true,
      nestedMetadata: true,
      nestedMapShadow: true,
      returnedCycle: true
    });
    const nativeArgument = observations[0];
    observations.length = 0;
    const host = vi.fn(invoke);
    const provider = vi.fn(() => {
      throw new Error("Completed replay needs no provider");
    });
    const bindings = { host: declareHostOperation(host, "read-side-effect") };
    let result = await run(graphSource, { bindings });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected initial graph");
    expect(observeGraph(deepCopyFromSandbox(result.returnValue))).toStrictEqual(expected);
    expect(observations).toStrictEqual([nativeArgument]);
    host.mockImplementation(() => {
      throw new Error("Completed graph must not reissue");
    });
    for (let generation = 0; generation < 2; generation++) {
      result = await run(graphSource, {
        bindings,
        snapshot: restore(JSON.parse(await dump(result)), { source: graphSource }),
        hostCallResumeProvider: provider
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected completed graph");
      expect(observeGraph(deepCopyFromSandbox(result.returnValue))).toStrictEqual(expected);
    }
    expect(host).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it("resumes a freshly captured pending shadowed argument with a matching result proof", async () => {
    const pendingSource = "const values = [1]; values.map = 0; return await host(values);";
    const native: unknown = await new Function(
      "host",
      `return (async () => {${pendingSource}})();`
    )(async () => 1);
    expect(native).toBe(1);
    const entered = deferred<void>();
    const gate = deferred<number>();
    const host = vi.fn((values: unknown) => {
      expect(Object.getOwnPropertyDescriptor(values, "map")?.value).toBe(0);
      entered.release();
      return gate.promise;
    });
    const execution = run(pendingSource, {
      bindings: { host: declareHostOperation(host, "read-side-effect") }
    });
    let serialized: string;
    try {
      await bounded(
        Promise.race([
          entered.promise,
          execution.then(() => {
            throw new Error("Expected pending host execution");
          })
        ]),
        "shadowed array host entered"
      );
      serialized = await bounded(dump(execution, { mode: "replay" }), "pending array capture");
    } finally {
      gate.release(1);
      await bounded(execution, "initial array completion");
    }
    const reissue = vi.fn(() => {
      throw new Error("Pending proof must not reissue host");
    });
    const provider = vi.fn((request: import("@poe-code/safe-js").HostCallResumeRequest) => ({
      ...request,
      outcome: { status: "fulfilled" as const, value: 1 }
    }));
    const result = await run(pendingSource, {
      snapshot: restore(JSON.parse(serialized), { source: pendingSource }),
      bindings: { host: declareHostOperation(reissue, "read-side-effect") },
      hostCallResumeProvider: provider
    });
    expect(result).toMatchObject({ ok: true, returnValue: native });
    expect(host).toHaveBeenCalledTimes(1);
    expect(reissue).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("does not broaden generic native function inputs", () => {
    const native = vi.fn(() => 1);
    const values = Object.assign([1], { map: native });
    expect(() => deepCopyToSandbox(values)).toThrow("function");
    expect(native).not.toHaveBeenCalled();
  });
});
