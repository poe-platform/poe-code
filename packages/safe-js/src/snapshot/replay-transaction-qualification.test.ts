import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { importedPromiseSnapshots, importedPromises } from "../interp/promise-state.js";
import { createSandboxPromise, getPromiseProperties, promiseProperties, type SandboxPromise, type SandboxValue } from "../interp/values.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";

const ref = (id: number) => ({ tag: "ref", id });
const property = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });

it.each(["fulfilled", "rejected"])("returns compile charges and imported registrations when scheduling throws after %s capture", status => {
  const budget = new Budget();
  const operation = budget.acquireCompileOwner(false);
  const parent = new CompileScope(operation.owner);
  const memo = new Map<string, Map<number, SandboxPromise>>();
  const captured: SandboxPromise[] = [];
  const failure = new Error("schedule refused");
  const before = budget.currentDataSize;
  try {
    expect(() => decodeReplayData({ root: ref(0), nodes: [
      { kind: "settled-imported-promise", status, outcome: ref(1), scheduleId: 1 },
      { kind: "regex", source: "abc", flags: "", lastIndex: 0 }
    ] }, { graphId: "call", importedPromiseMemo: memo,
      onImportedPromiseRestored: promise => { captured.push(promise); },
      restoreScheduledPromise: () => { throw failure; }
    }, parent)).toThrow(failure);
    expect(memo.size).toBe(0);
    expect(captured).toHaveLength(1);
    expect.soft(importedPromiseSnapshots.has(captured[0])).toBe(false);
    expect.soft(importedPromises.has(captured[0])).toBe(false);
    expect.soft(parent.tickets.size).toBe(0);
    expect.soft(budget.currentDataSize).toBe(before);
  } finally { parent.dispose(); operation.release(); }
});

it.each([false, true])("restores the exact existing Promise property table after a later error (present=%s)", present => {
  const promise = createSandboxPromise(new Promise(() => undefined));
  const previous = present ? getPromiseProperties(promise) : undefined;
  if (previous !== undefined) previous.original = 7;
  const before = previous === undefined ? undefined : Object.getOwnPropertyDescriptors(previous);
  const provider = vi.fn(async () => 7);
  expect(() => decodeReplayData({ root: ref(0), nodes: [
    { kind: "object", properties: { first: property(ref(1)), later: property(ref(3)) }, extensible: true, nullPrototype: false },
    { kind: "promise-capability", id: "owned", properties: ref(2) },
    { kind: "object", properties: { replacement: property(9) }, extensible: true, nullPrototype: false },
    { kind: "pending-imported-promise", properties: ref(4) },
    { kind: "object", properties: { bad: property(ref(99)) }, extensible: true, nullPrototype: false }
  ] }, { resolvePromise: id => id === "owned" ? promise : undefined,
    graphId: "call", resumePendingImportedPromise: provider })).toThrow();
  expect(promiseProperties.get(promise)).toBe(previous);
  if (previous !== undefined) expect(Object.getOwnPropertyDescriptors(previous)).toEqual(before);
  expect(provider).not.toHaveBeenCalled();
});

it("preserves generated cyclic graph identities and leaves the source untouched", () => {
  for (let size = 1; size <= 16; size++) {
    const nodes: Array<Record<string, unknown>> = Array.from({ length: size }, (_, index) => ({ index }));
    for (let index = 0; index < size; index++) {
      nodes[index].next = nodes[(index + 1) % size];
      nodes[index].alias = nodes[(index + 1) % size];
    }
    const graph = encodeReplayData(nodes as never);
    const before = JSON.stringify(graph);
    const restored = decodeReplayData(graph) as typeof nodes;
    for (let index = 0; index < size; index++) {
      expect(restored[index].next).toBe(restored[(index + 1) % size]);
      expect(restored[index].alias).toBe(restored[index].next);
    }
    expect(JSON.stringify(graph)).toBe(before);
  }
});

it("does not activate an earlier pending provider after a later scheduling failure", async () => {
  const provider = vi.fn(async () => 7);
  const failure = new Error("later scheduling refused");
  const captured: SandboxPromise[] = [];
  const settlements: unknown[] = [];
  expect(() => decodeReplayData({ root: ref(0), nodes: [
    { kind: "object", properties: { pending: property(ref(1)), settled: property(ref(2)), later: property(ref(3)) }, extensible: true, nullPrototype: false },
    { kind: "pending-imported-promise" },
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 8 },
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 9, scheduleId: 1 }
  ] }, { graphId: "call", resumePendingImportedPromise: provider,
    onImportedPromiseRestored: promise => {
      captured.push(promise);
      void promise.promise.then(value => { settlements.push(value); }, error => { settlements.push(error); });
    }, restoreScheduledPromise: () => { throw failure; }
  })).toThrow(failure);
  // Drain the finite Promise reaction chain, without timers or real waits.
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  expect.soft(provider).not.toHaveBeenCalled();
  expect.soft(settlements).toEqual([]);
  for (const promise of captured) expect(importedPromiseSnapshots.has(promise)).toBe(false);
});

it("rejects duplicate scheduling identities before invoking the scheduler", () => {
  const schedule = vi.fn((_id: number, promise: Promise<SandboxValue>) => promise);
  expect(() => decodeReplayData({ root: ref(0), nodes: [
    { kind: "object", properties: { first: property(ref(1)), second: property(ref(2)) }, extensible: true, nullPrototype: false },
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 7, scheduleId: 1 },
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 8, scheduleId: 1 }
  ] }, { restoreScheduledPromise: schedule })).toThrow("Duplicate imported Promise scheduling identity");
  expect(schedule).not.toHaveBeenCalled();
});
