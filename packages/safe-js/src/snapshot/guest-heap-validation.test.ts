import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { validateDumpEnvelope } from "./validation.js";
import { restore } from "../restore.js";

type HeapNode = {
  kind: string; id: string; bindings: Array<[string, number]>; cells: unknown[]; parent: unknown; restoredBindings?: unknown;
  state?: { properties: { properties: Array<[unknown, { get?: unknown }]> } };
};

it.each(["identity", "cell", "parent", "accessor"])("rejects forged guest heap %s records", async corruption => {
  const pending = run("let count=3;Object.defineProperty(Number.prototype,'label',{get(){return count},configurable:true});await 0;return 3");
  try {
    const snapshot = JSON.parse(await dump(pending));
    const nodes = Object.entries(snapshot.heap) as Array<[string, HeapNode]>;
    const intrinsic = nodes.find(([, node]) => node.kind === "intrinsic")![1];
    const [scopeId, scope] = nodes.find(([, node]) => node.kind === "scope-frame" && node.bindings.length > 0)!;
    let message: string;
    if (corruption === "identity") { intrinsic.id = '["process","exit"]'; message = "Unknown intrinsic identity"; }
    else if (corruption === "cell") { scope.bindings[0][1] = scope.cells.length; message = "Unknown guest binding cell"; }
    else if (corruption === "parent") { delete scope.restoredBindings; scope.parent = { kind: "ref", id: Number(scopeId) }; message = "Cyclic guest scope parent graph"; }
    else {
      const descriptor = nodes.flatMap(([, node]) => node.state?.properties.properties ?? []).find(entry => entry[0] === "label")![1];
      descriptor.get = { kind: "ref", id: Number(scopeId) }; message = "Wrong guest heap reference kind";
    }
    expect(() => validateDumpEnvelope(snapshot)).toThrow(message);
  } finally { await pending; }
});

it("continues accepting legacy version-one dump envelopes", () => {
  expect(() => validateDumpEnvelope({ version: 1, sourceHash: "legacy" })).not.toThrow();
});

it("rejects guest function origins absent from the source AST", async () => {
  const source = "Number.prototype.label=()=>3;await 0;return 3";
  const pending = run(source);
  try {
    const snapshot = JSON.parse(await dump(pending));
    const node = (Object.values(snapshot.heap) as Array<Record<string, unknown>>).find(entry => entry.kind === "guest-function")!;
    node.astNodeId = 999999;
    expect(() => restore(snapshot, { source })).toThrow("Unknown guest function AST identity");
  } finally { await pending; }
});

it.each(["binding", "cell", "property", "nested", "shared-reference"])("rejects an internal scope used as guest data through %s", async location => {
  const pending = run("let count=3;Number.prototype.label=()=>count;await 0;return 3");
  try {
    const snapshot = JSON.parse(await dump(pending));
    const nodes = Object.values(snapshot.heap) as Array<Record<string, unknown>>;
    const closure = nodes.find(node => node.kind === "guest-function")!;
    const scopeRef = location === "shared-reference" ? closure.scope : structuredClone(closure.scope);
    if (location === "binding" || location === "shared-reference") snapshot.bindings.leak = scopeRef;
    else if (location === "nested") snapshot.bindings.leak = [{ nested: scopeRef }];
    else if (location === "cell") {
      const scope = snapshot.heap[String((closure.scope as { id: number }).id)];
      const cell = scope.cells.find((value: { initialized: boolean }) => value.initialized);
      cell.value = scopeRef;
    } else {
      const intrinsic = nodes.find(node => node.kind === "intrinsic" && node.state !== undefined)!;
      const state = intrinsic.state as { properties: { properties: unknown[] } };
      state.properties.properties.push(["leak", { kind: "data", value: scopeRef, writable: true, configurable: true, enumerable: true }]);
    }
    expect(() => validateDumpEnvelope(snapshot)).toThrow("Internal scopes cannot be guest data");
  } finally { await pending; }
});
