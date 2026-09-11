import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";

it("writes mutated intrinsics, function origins and captured frames into the actual public dump", async () => {
  const pending = run("let count=3;Number.prototype.label=function(){return ++count};await 0;return (1).label()");
  try {
    const snapshot = JSON.parse(await dump(pending));
    const nodes = Object.values(snapshot.heap) as Array<Record<string, unknown>>;
    expect(nodes.some(node => node.kind === "intrinsic")).toBe(true);
    expect(nodes.some(node => node.kind === "guest-function" && typeof node.astNodeId === "number")).toBe(true);
    expect(nodes.some(node => node.kind === "scope-frame")).toBe(true);
    const refs = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.kind === "ref") expect(Object.hasOwn(snapshot.heap, String(record.id))).toBe(true);
      for (const entry of Object.values(record)) refs(entry);
    };
    refs(snapshot);
    expect(await pending).toMatchObject({ ok: true, returnValue: 4 });
  } finally { await pending; }
});
