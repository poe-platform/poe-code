import { expect, it } from "vitest";
import { run } from "../run.js";
import { createWeakCollection, setWeakEntry } from "../interp/weak-collection.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

it.each(["map", "set"] as const)("rejects internal aggregate records as %s keys during node validation", async kind => {
  const source = "const c=Promise.withResolvers();const p=Promise.all([c.promise]);return ()=>{c.resolve(1);return p}";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const collection = createWeakCollection(kind);
  const key = Object.create(null);
  setWeakEntry(collection, key, undefined);
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { collection, key, read: result.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const heap = saved.heap!;
  const node = Object.values(heap).find(value => value.kind === "guest-weakcollection");
  if (node?.kind !== "guest-weakcollection") throw new Error("Missing collection node");
  expect(validateGuestHeapNode(node, heap)).toBe(true);
  expect(() => restore(JSON.parse(JSON.stringify(saved)), { source })).not.toThrow();
  for (const targetKind of ["promise-aggregate", "aggregate-entry"]) {
    const target = Object.entries(heap).find(([, value]) => value.kind === targetKind);
    expect(target).toBeDefined();
    const forged = { ...node, entries: [[{ kind: "ref", id: Number(target![0]) }, { kind: "undefined" }]] };
    expect(() => validateGuestHeapNode(forged, heap)).toThrow("Wrong guest heap reference kind.");
  }
});
