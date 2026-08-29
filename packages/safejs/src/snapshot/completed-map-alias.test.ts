import { describe, expect, it, vi } from "vitest";

import { dump } from "../dump.js";
import { Budget } from "../interp/budget.js";
import { declareHostOperation } from "../interp/host-bridge.js";
import { restore, type SafeJSSnapshot } from "../restore.js";
import { run } from "../run.js";

const capturedSource = `let count = 2;
const result = await host(async () => {
  await gate();
  const compute = () => count;
  const shared = { compute, alias: compute };
  shared.self = shared;
  return { shared, alias: shared, map: new Map([[compute, shared]]), set: new Set([compute]) };
});
count = 7;
return {
  value: result.shared.compute(),
  closureAlias: result.shared.compute === result.shared.alias,
  objectAlias: result.shared === result.alias,
  cycle: result.shared.self === result.shared,
  map: result.map.get(result.shared.compute) === result.shared,
  set: result.set.has(result.shared.compute)
};`;

const collectionSource = `let count = 2;
const result = await host(async () => {
  await gate();
  function compute(first, second = 3, ...rest) { return count + first + second + rest.length; }
  const bound = compute.bind(null, 1);
  const shared = { compute, alias: compute, bound };
  shared.self = shared;
  const rows = [, undefined, , shared];
  rows.length = 6;
  rows[4] = rows;
  const map = new Map([[compute, shared], [shared, rows]]);
  const set = new Set([compute, shared]);
  const graph = { map, set, rows, shared, alias: shared };
  map.set(map, graph);
  set.add(set);
  shared.map = map;
  shared.set = set;
  return graph;
});
result.rows.metadata = result.shared;
result.rows.raw = result.shared;
result.rows.map = 0;
count = 7;
return {
  value: result.shared.compute(1),
  boundValue: result.shared.bound(),
  arity: result.shared.compute.length,
  boundArity: result.shared.bound.length,
  closureAlias: result.shared.compute === result.shared.alias,
  objectAlias: result.shared === result.alias,
  cycle: result.shared.self === result.shared,
  map: result.map.get(result.shared.compute) === result.shared,
  mapObjectKey: result.map.get(result.shared) === result.rows,
  mapCycle: result.map.get(result.map) === result,
  mapBacklink: result.shared.map === result.map,
  set: result.set.has(result.shared.compute),
  setObject: result.set.has(result.shared),
  setCycle: result.set.has(result.set),
  setBacklink: result.shared.set === result.set,
  arrayLength: result.rows.length,
  arrayKeys: Object.keys(result.rows),
  hole: !Object.hasOwn(result.rows, 0),
  explicitUndefined: Object.hasOwn(result.rows, 1) && result.rows[1] === undefined,
  trailingHole: !Object.hasOwn(result.rows, 5),
  indexedAlias: result.rows[3] === result.shared,
  arrayCycle: result.rows[4] === result.rows,
  metadata: result.rows.metadata === result.shared,
  raw: result.rows.raw === result.shared,
  shadow: result.rows.map
};`;

describe("completed host outcome graph replay", () => {
  it.each([
    {
      name: "captured Map value alias",
      source: capturedSource,
      expected: {
        value: 7,
        closureAlias: true,
        objectAlias: true,
        cycle: true,
        map: true,
        set: true
      }
    },
    {
      name: "collection cycles, sparse metadata and source arity",
      source: collectionSource,
      expected: {
        value: 11,
        boundValue: 11,
        arity: 1,
        boundArity: 0,
        closureAlias: true,
        objectAlias: true,
        cycle: true,
        map: true,
        mapObjectKey: true,
        mapCycle: true,
        mapBacklink: true,
        set: true,
        setObject: true,
        setCycle: true,
        setBacklink: true,
        arrayLength: 6,
        arrayKeys: ["1", "3", "4", "metadata", "raw", "map"],
        hole: true,
        explicitUndefined: true,
        trailingHole: true,
        indexedAlias: true,
        arrayCycle: true,
        metadata: true,
        raw: true,
        shadow: 0
      }
    }
  ])(
    "matches native before and after two completed restores: $name",
    async ({ source, expected }) => {
      const native: unknown = await new Function(
        "host",
        "gate",
        `return (async () => {${source}})();`
      )(
        async (callback: () => Promise<unknown>) => callback(),
        async () => undefined
      );
      expect(native).toStrictEqual(expected);
      const host = vi.fn(async (callback: () => Promise<unknown>) => callback());
      const gate = vi.fn(async () => undefined);
      const provider = vi.fn(() => {
        throw new Error("Completed execution must not request a resume provider");
      });
      const bindings = {
        host: declareHostOperation(host, "read-side-effect"),
        gate: declareHostOperation(gate, "re-issue")
      };
      let snapshot: SafeJSSnapshot | undefined;
      for (let round = 0; round < 3; round += 1) {
        const result = await run(source, {
          bindings,
          hostCallResumeProvider: provider,
          budget: new Budget({
            maxSteps: 10000,
            arrayLength: 128,
            stringLength: 4096,
            dataSize: 200000,
            maxCallDepth: 64
          }),
          ...(snapshot === undefined ? {} : { snapshot: restore(snapshot, { source }) })
        });
        expect(result).toMatchObject({ ok: true, returnValue: native });
        if (!result.ok) throw new Error("Expected successful guest execution");
        expect(structuredClone(result.returnValue)).toStrictEqual(native);
        snapshot = JSON.parse(await dump(result));
        host.mockImplementation(async () => {
          throw new Error("Completed execution must not reissue host");
        });
        gate.mockImplementation(async () => {
          throw new Error("Completed execution must not reissue gate");
        });
      }
      expect(host).toHaveBeenCalledTimes(1);
      expect(gate).toHaveBeenCalledTimes(1);
      expect(provider).not.toHaveBeenCalled();
    }
  );
});
