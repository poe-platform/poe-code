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
