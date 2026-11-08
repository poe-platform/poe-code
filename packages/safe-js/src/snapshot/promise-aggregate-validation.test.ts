import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each(["index", "remaining"])("rejects an aggregate %s beyond its input count", async field => {
  const source = "const c=Promise.withResolvers();return [Promise.all([c.promise]),c.resolve]";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {value: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  assert(snapshot.heap !== undefined);
  const node = Object.values(snapshot.heap).find(node => node.kind === (field === "index" ? "aggregate-entry" : "promise-aggregate"));
  assert(node !== undefined);
  if (node.kind === "aggregate-entry") node.index = 10;
  else if (node.kind === "promise-aggregate") node.remaining = 10;
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()})).toThrow();
});

it("rejects a producer redirected away from its aggregate handler's result", async () => {
  const source = "const c=Promise.withResolvers();return [Promise.all([c.promise]),c.resolve]";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {value: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  assert(snapshot.heap !== undefined);
  const match = Object.entries(snapshot.heap).find(([,node]) => node.kind === "promise-reaction" && node.aggregate !== undefined);
  assert(match !== undefined);
  const [id, node] = match;
  assert(node.kind === "promise-reaction");
  assert(node.aggregate !== null && typeof node.aggregate === "object" && "kind" in node.aggregate && node.aggregate.kind === "ref" && "id" in node.aggregate && typeof node.aggregate.id === "number");
  assert(node.source !== null && typeof node.source === "object" && "kind" in node.source && node.source.kind === "ref" && "id" in node.source && typeof node.source.id === "number");
  const owner = snapshot.heap[node.aggregate.id];
  const input = snapshot.heap[node.source.id];
  assert(owner?.kind === "pending-promise" && input?.kind === "pending-promise");
  delete owner.producers;
  input.producers = [{kind: "ref", id: Number(id)}];
  node.aggregate = node.source;
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()})).toThrow("Invalid promise aggregate handler ownership");
});
