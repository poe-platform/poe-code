import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { parseModule } from "../parse/parser.js";
import { validateInterpreterSnapshot } from "./validation.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

it("accepts more than 100000 call frames without a call-depth budget and enforces explicit budgets", () => {
  const source = parseModule("return 1");
  const node = source.body[0]!;
  if (node.nodeId === undefined) throw new Error("Missing parsed node identity");
  const ast = new Map([[node.nodeId, node]]);
  const snapshot = {
    sourceHash: "test", currentAstNodeId: node.nodeId,
    scopeChain: [{ id: 1, bindings: {} }],
    callStack: Array.from({ length: 100001 }, () => ({ astNodeId: node.nodeId, scopeId: 1 })),
    pendingPromises: [], moduleBindings: {},
  };
  expect(() => validateInterpreterSnapshot(snapshot, ast, new Budget())).not.toThrow();
  expect(() => validateInterpreterSnapshot(snapshot, ast, new Budget({ maxCallDepth: 10000 }))).toThrow("call-depth limit");
});

it("does not impose an array allocation budget on promise aggregate counts by default", () => {
  const aggregate = {
    kind: "promise-aggregate", method: "race", size: 0x100000000, remaining: 0, iteration: "complete",
    values: { kind: "ref", id: 1 },
    capability: { promise: { kind: "ref", id: 2 }, resolve: { kind: "ref", id: 3 }, reject: { kind: "ref", id: 3 } },
  };
  const heap = { "1": { kind: "guest-array" }, "2": { kind: "guest-promise" }, "3": { kind: "promise-resolver" } };
  expect(() => validateGuestHeapNode(aggregate, heap)).not.toThrow();
  expect(() => validateGuestHeapNode(aggregate, heap, 100)).toThrow("aggregate iteration");
});


it("retains JavaScript array-length validity with an unlimited allocation budget", () => {
  const node = (length: number) => ({ kind: "guest-array", state: { properties: {
    extensible: true, properties: [["length", { kind: "data", value: length, writable: true, enumerable: false, configurable: false }]],
  } } });
  expect(() => validateGuestHeapNode(node(0xffffffff), {})).not.toThrow();
  expect(() => validateGuestHeapNode(node(0x100000000), {})).toThrow("Invalid guest array length");
  expect(() => validateGuestHeapNode(node(100), {}, 50)).toThrow("allocation limit");
});

it("accepts large snapshot strings and aggregate data by default, with explicit caps still enforced", () => {
  const source = parseModule("return 1");
  const node = source.body[0]!;
  if (node.nodeId === undefined) throw new Error("Missing parsed node identity");
  const ast = new Map([[node.nodeId, node]]);
  const text = "x".repeat(1_000_001);
  const snapshot = {
    sourceHash: "test", currentAstNodeId: node.nodeId,
    scopeChain: [{ id: 1, bindings: { text, items: Array(17).fill(text) } }],
    callStack: [], pendingPromises: [], moduleBindings: {}
  };
  expect(() => validateInterpreterSnapshot(snapshot, ast, new Budget())).not.toThrow();
  expect(() => validateInterpreterSnapshot(snapshot, ast, new Budget({ stringLength: 1_000_000 }))).toThrow("string");
  expect(() => validateInterpreterSnapshot(snapshot, ast, new Budget({ dataSize: 16_000_000 }))).toThrow("data limit");
  expect(() => validateInterpreterSnapshot(snapshot, ast, new Budget({ arrayLength: 16 }))).toThrow("array is too large");
});
