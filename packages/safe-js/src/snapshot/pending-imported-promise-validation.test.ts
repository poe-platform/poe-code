import { expect, it, vi } from "vitest";
import { decodeReplayData } from "./replay-data.js";
import { isSandboxPromise, type SandboxPromise, type SandboxValue } from "../interp/values.js";

it("rolls back pending identities without calling a provider when a later graph entry is invalid", () => {
  const provider = vi.fn(async () => 7);
  const memo = new Map<string, Map<number, SandboxPromise>>();
  const property = (id: number) => ({ value: { tag: "ref", id }, writable: true, enumerable: true, configurable: true });
  expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
    { kind: "object", properties: { first: property(1), invalid: property(9) }, extensible: true, nullPrototype: false },
    { kind: "pending-imported-promise" }
  ] }, { graphId: "call", importedPromiseMemo: memo, resumePendingImportedPromise: provider })).toThrow();
  expect(provider).not.toHaveBeenCalled();
  expect(memo.size).toBe(0);
});

it.each([{ status: "pending" }, { status: "fulfilled" }, { outcome: 7 }])(
  "rejects contradictory pending metadata %j before reconciliation", fields => {
    const provider = vi.fn(async () => 7);
    expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
      { kind: "pending-imported-promise", ...fields }
    ] }, { graphId: "call", resumePendingImportedPromise: provider })).toThrow(/reconciliation/);
    expect(provider).not.toHaveBeenCalled();
  }
);

it("reconciles aliased pending nodes only once after a valid graph is reconstructed", async () => {
  const provider = vi.fn(async () => 7);
  const property = { value: { tag: "ref", id: 1 }, writable: true, enumerable: true, configurable: true };
  const value = decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
    { kind: "object", properties: { left: property, right: property }, extensible: true, nullPrototype: false },
    { kind: "pending-imported-promise" }
  ] }, { graphId: "call", resumePendingImportedPromise: provider }) as Record<string, SandboxValue>;
  expect(value.left).toBe(value.right);
  if (!isSandboxPromise(value.left)) throw new Error("Expected imported Promise");
  await expect(value.left.promise).resolves.toBe(7);
  expect(provider).toHaveBeenCalledExactlyOnceWith("call", 1);
});
