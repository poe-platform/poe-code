import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { dump } from "../dump.js";
import { Budget } from "../interp/budget.js";
import { parseModule } from "../parse/parser.js";
import { restore as restoreDump, type SafeJSSnapshot } from "../restore.js";
import { run } from "../run.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { restore } from "./restore.js";
import {
  serialize,
  type RuntimeSnapshotValue,
  type SerializedScopeFrame,
  type SerializedSnapshot
} from "./serialize.js";

const limits = {
  maxSteps: 5_000,
  arrayLength: 32,
  stringLength: 2_048,
  dataSize: 100_000,
  maxCallDepth: 32
};

async function expectCompletedRoundTrip(source: string) {
  const expected: unknown = runInNewContext(`(function() { ${source} })()`, {}, { timeout: 1_000 });
  const current = await run(source, { budget: new Budget(limits) });
  expect(current.ok).toBe(true);
  if (!current.ok) throw current.error;
  expect(current.returnValue).toEqual(expected);
  const snapshot: SafeJSSnapshot = JSON.parse(await dump(current));
  const replay = await run(source, {
    snapshot: restoreDump(snapshot, { source }),
    budget: new Budget(limits)
  });
  expect(replay.ok).toBe(true);
  if (!replay.ok) throw replay.error;
  expect(replay.returnValue).toEqual(expected);
  return snapshot;
}

describe("completed snapshots with shadowed array methods", () => {
  it.each([
    ["dense control", "const values = [1]; return 1;"],
    ["exact own-map finding", "const values = [1]; values.map = 0; return 1;"],
    [
      "captured source function",
      'const values=[2,3]; values.map=function () { return "own"; }; return Object.hasOwn(values,"map");'
    ],
    [
      "captured undefined",
      'const values=[2,3]; values.map=undefined; return Object.hasOwn(values,"map");'
    ],
    ["captured zero", 'const values=[2,3]; values.map=0; return Object.hasOwn(values,"map");'],
    ["captured null", 'const values=[2,3]; values.map=null; return Object.hasOwn(values,"map");']
  ])("preserves native execution and completed replay for %s", async (_name, source) => {
    await expectCompletedRoundTrip(source);
  });

  it("does not invoke a source method while checkpointing sparse named data", async () => {
    const snapshot = await expectCompletedRoundTrip(`
      let calls = 0;
      const metadata = { count: 7 };
      const values = Array(6);
      values[1] = metadata;
      values[4] = undefined;
      values.map = function(first, second = 2) { calls += 1; return first + second; };
      values.metadata = metadata;
      values.raw = metadata;
      values.self = values;
      const alias = values;
      return {
        calls,
        length: values.length,
        keys: Object.keys(values),
        hole: Object.hasOwn(values, 0),
        present: Object.hasOwn(values, 4),
        explicitUndefined: values[4] === undefined,
        methodLength: values.map.length,
        aliases: [alias === values, values.self === values, values.raw === values.metadata]
      };
    `);
    expect(snapshot.bindings).toMatchObject({ calls: 0 });
  });
});

const shadows: Array<[string, RuntimeSnapshotValue]> = [
  ["map", 0],
  ["map", null],
  ["map", undefined],
  ["forEach", 0],
  ["entries", null],
  ["values", undefined],
  ["keys", 0],
  ["slice", 0]
];

describe.each(["interpreter", "dump"])("%s shadowed-array graph roundtrip", (format) => {
  it.each(shadows)("retains own %s = %s with sparse shape and named aliases", (name, value) => {
    const source = "return null;";
    const currentAstNodeId = parseModule(source).body[0]?.nodeId;
    if (currentAstNodeId === undefined) throw new Error("Expected a parsed node ID");
    const metadata = { count: 7 };
    const rows = new Array<RuntimeSnapshotValue>(6);
    rows[1] = metadata;
    rows[4] = undefined;
    Object.assign(rows, { [name]: value, metadata, raw: metadata, self: rows });
    const bindings = { rows, alias: rows, metadata };
    const native = structuredClone(bindings);
    const input = {
      source,
      currentAstNodeId,
      scopeChain: [{ id: "module", bindings }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    };
    let snapshot: SerializedSnapshot;
    if (format === "interpreter") {
      snapshot = JSON.parse(JSON.stringify(serialize(input)));
    } else {
      const empty = serialize({ ...input, scopeChain: [] });
      const envelope: SafeJSSnapshot & {
        bindings: SerializedScopeFrame["bindings"];
        heap?: SerializedSnapshot["heap"];
      } = JSON.parse(serializeSafeJSSnapshot({ sourceHash: empty.sourceHash, bindings }));
      const validated = restoreDump(envelope, { source });
      snapshot = {
        ...empty,
        scopeChain: [{ id: "module", bindings: validated.bindings }],
        heap: validated.heap
      };
    }
    const scope = restore(snapshot, { source }).currentScope;
    const actualBinding = scope.lookup("rows");
    const aliasBinding = scope.lookup("alias");
    const metadataBinding = scope.lookup("metadata");
    if (!actualBinding.found || !aliasBinding.found || !metadataBinding.found)
      throw new Error("Expected restored graph bindings");
    const actual = actualBinding.value;
    if (!Array.isArray(actual)) throw new Error("Expected a restored array");
    expect(actual).not.toBe(rows);
    expect(actual.length).toBe(native.rows.length);
    expect(actual.length).toBe(6);
    expect(Object.keys(actual)).toEqual(Object.keys(native.rows));
    expect(Object.keys(actual)).toEqual(["1", "4", name, "metadata", "raw", "self"]);
    expect(Array.from({ length: 6 }, (_, index) => Object.hasOwn(actual, index))).toEqual([
      false,
      true,
      false,
      false,
      true,
      false
    ]);
    expect(actual[4]).toBeUndefined();
    expect(Object.hasOwn(actual, name)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(actual, name)?.value).toBe(value);
    expect(actual).toBe(aliasBinding.value);
    expect(actual[1]).toBe(metadataBinding.value);
    expect(actual[1]).toEqual(metadata);
    expect(Object.getOwnPropertyDescriptor(actual, "metadata")?.value).toBe(metadataBinding.value);
    expect(Object.getOwnPropertyDescriptor(actual, "raw")?.value).toBe(metadataBinding.value);
    expect(Object.getOwnPropertyDescriptor(actual, "self")?.value).toBe(actual);
  });
});
