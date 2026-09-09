import { expect, it } from "vitest";
import { expectLegacyDumpGraph } from "./legacy-dump-graph.js";

const legacy = { bindings: { Number: { kind: "fn", name: "Number" }, pair: [{ kind: "ref", id: 1 }, { kind: "ref", id: 1 }] },
  heap: { 1: { kind: "object", entries: { count: 7 } } } };
const current = () => ({ bindings: { Number: { kind: "ref", id: 1 }, pair: [{ kind: "ref", id: 2 }, { kind: "ref", id: 2 }] },
  heap: { 1: { kind: "intrinsic", id: '["Number"]' }, 2: { kind: "object", entries: { count: 7 } }, 3: { kind: "object", entries: { count: 7 } } } });

it("accepts renumbered references with identical aliases and values", () => {
  expectLegacyDumpGraph(current(), legacy);
});
it.each(["value", "alias", "intrinsic"])("detects changed legacy %s observations", corruption => {
  const snapshot = current();
  if (corruption === "value") snapshot.heap[2].entries.count = 8;
  else if (corruption === "alias") snapshot.bindings.pair[1].id = 3;
  else snapshot.heap[1].id = '["Boolean"]';
  expect(() => expectLegacyDumpGraph(snapshot, legacy)).toThrow();
});

const taggedNamespace = () => ({
  bindings: { JSON: { kind: "ref", id: 1 } },
  heap: {
    1: { kind: "intrinsic", id: '["JSON"]', state: { properties: { properties: [
      [{kind:"ref",id:2},{kind:"data",value:"JSON"}]
    ] } } },
    2: { kind: "symbol", wellKnown: "toStringTag" }
  }
});
const expectedNamespace = {bindings:{JSON:{[Symbol.toStringTag]:"JSON"}},heap:{}};

const descriptorArray = () => {
  const base = current();
  return {
    bindings: { ...base.bindings, pair: { kind: "ref", id: 4 } },
    heap: { ...base.heap,
      4: { kind: "guest-array", state: {
        prototype: { kind: "ref", id: 5 },
        properties: { extensible: true, properties: [
          ["0", { kind: "data", value: { kind: "ref", id: 2 }, writable: true, enumerable: true, configurable: true }],
          ["1", { kind: "data", value: { kind: "ref", id: 2 }, writable: true, enumerable: true, configurable: true }],
          ["length", { kind: "data", value: 2, writable: true, enumerable: false, configurable: false }]
        ] as Array<[string, { kind: string; value: unknown; writable: boolean; enumerable: boolean; configurable: boolean }]> }
      } },
      5: { kind: "intrinsic", id: '["Array","prototype"]' }
    }
  };
};

it("compares descriptor-backed arrays with legacy inline arrays", () => {
  expectLegacyDumpGraph(descriptorArray(), legacy);
});

it("rejects newly aliased legacy inline arrays", () => {
  const snapshot = descriptorArray();
  const before = { ...legacy, bindings: { ...legacy.bindings, other: [...legacy.bindings.pair] } };
  const after = { ...snapshot, bindings: { ...snapshot.bindings, other: snapshot.bindings.pair } };
  expectLegacyDumpGraph({ ...after,
    bindings: { ...after.bindings, other: { kind: "ref", id: 6 } },
    heap: { ...after.heap, 6: snapshot.heap[4] }
  }, before);
  expect(() => expectLegacyDumpGraph(after, before)).toThrow();
});

it.each(["value", "alias", "prototype", "length", "duplicate", "descriptor"])(
  "rejects corrupted descriptor-backed array %s", corruption => {
    const snapshot = descriptorArray();
    const properties = snapshot.heap[4].state.properties.properties;
    if (corruption === "value") snapshot.heap[2].entries.count = 8;
    if (corruption === "alias") properties[1][1].value = { kind: "ref", id: 3 };
    if (corruption === "prototype") snapshot.heap[5].id = '["String","prototype"]';
    if (corruption === "length") properties[2][1].value = 3;
    if (corruption === "duplicate") properties.push(properties[0]);
    if (corruption === "descriptor") properties[0][1].writable = false;
    expect(() => expectLegacyDumpGraph(snapshot, legacy)).toThrow();
  }
);

it("compares explicitly declared symbol additions",()=>{
  expectLegacyDumpGraph(taggedNamespace(),expectedNamespace);
});

it.each(["value","symbol","unexpected","duplicate"])("rejects corrupted symbol additions: %s",corruption=>{
  const snapshot=taggedNamespace();
  if(corruption==="value") snapshot.heap[1].state.properties.properties[0][1].value="Changed";
  if(corruption==="symbol") snapshot.heap[2].wellKnown="iterator";
  if(corruption==="duplicate") snapshot.heap[1].state.properties.properties.push(snapshot.heap[1].state.properties.properties[0]);
  const expected=corruption==="unexpected"?{bindings:{JSON:{}},heap:{}}:expectedNamespace;
  expect(()=>expectLegacyDumpGraph(snapshot,expected)).toThrow();
});
