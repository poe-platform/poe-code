import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { importedPromises, importedPromiseSnapshots } from "../interp/promise-state.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import {
  createSandboxPromise,
  getPromiseProperties,
  promiseProperties,
  type SandboxPromise,
  type SandboxValue
} from "../interp/values.js";
import { createReplayEncodingContext, decodeReplayData, encodeReplayData } from "./replay-data.js";

it.each([1, 4, 16].flatMap((size) => [false, true].map((present) => ({ size, present }))))(
  "recovers after repeated late failures with a $size-node retained ring (table=$present)",
  ({ size, present }) => {
    const budget = new Budget();
    const operation = budget.acquireCompileOwner(false);
    const parent = new CompileScope(operation.owner);
    const promise = createSandboxPromise(new Promise(() => undefined));
    const previous = present ? getPromiseProperties(promise) : undefined;
    if (previous !== undefined)
      Object.defineProperty(previous, "original", { value: 7, enumerable: false });
    const descriptors =
      previous === undefined ? undefined : Object.getOwnPropertyDescriptors(previous);
    const context = createReplayEncodingContext();
    const ring: Array<Record<string, SandboxValue>> = Array.from({ length: size }, () => ({}));
    ring.forEach((node, index) => {
      node.next = ring[(index + 1) % size];
      node.alias = node.next;
    });
    const initial = encodeReplayData(ring, { context });
    const memo = { nodes: initial.nodes, values: new Map<number, SandboxValue>() };
    const imports = new Map<string, Map<number, SandboxPromise>>();
    const captured: SandboxPromise[] = [];
    const failure = new Error("late scheduler rejection");
    try {
      const retained = decodeReplayData(initial, { memo }, parent) as typeof ring;
      const priorMemo = new Map(memo.values);
      const first = context.nodes.length;
      const ref = (id: number) => ({ tag: "ref" as const, id });
      const property = (value: unknown) => ({
        value,
        writable: true,
        enumerable: true,
        configurable: true
      });
      // Extend the actual graph: rollback must retain already committed identities.
      const added = [
        {
          kind: "object",
          properties: { owned: property(ref(first + 1)), later: property(ref(first + 3)) },
          extensible: true,
          nullPrototype: false
        },
        { kind: "promise-capability", id: "owned", properties: ref(first + 2) },
        {
          kind: "object",
          properties: { replacement: property(9) },
          extensible: true,
          nullPrototype: false
        },
        {
          kind: "settled-imported-promise",
          status: "fulfilled",
          outcome: ref(first + 4),
          scheduleId: 1
        },
        { kind: "regex", source: "abc", flags: "", lastIndex: 0 }
      ];
      context.nodes.push(...(added as typeof context.nodes));
      const extension = { root: ref(first), nodes: context.nodes };
      const wire = JSON.stringify(extension);
      const live = budget.currentDataSize;
      const tickets = new Set(parent.tickets);
      for (let attempt = 0; attempt < 3; attempt++) {
        expect(() =>
          decodeReplayData(
            extension,
            {
              memo,
              graphId: "extension",
              importedPromiseMemo: imports,
              resolvePromise: () => promise,
              onImportedPromiseRestored: (value) => {
                captured.push(value);
              },
              restoreScheduledPromise: () => {
                // Prove this is a late rollback, after the replacement was installed.
                expect(promiseProperties.get(promise)).not.toBe(previous);
                expect(promiseProperties.get(promise)).toHaveProperty("replacement", 9);
                throw failure;
              }
            },
            parent
          )
        ).toThrow(failure);
        expect(promiseProperties.get(promise)).toBe(previous);
        if (previous !== undefined)
          expect(Object.getOwnPropertyDescriptors(previous)).toEqual(descriptors);
        expect(imports.size).toBe(0);
        expect(memo.values).toEqual(priorMemo);
        for (const [id, value] of priorMemo) expect(memo.values.get(id)).toBe(value);
        expect(parent.tickets).toEqual(tickets);
        expect(budget.currentDataSize).toBe(live);
        expect(JSON.stringify(extension)).toBe(wire);
      }
      expect(captured).toHaveLength(3);
      for (const value of captured) {
        expect(importedPromises.has(value)).toBe(false);
        expect(importedPromiseSnapshots.has(value)).toBe(false);
        expect(promiseProperties.has(value)).toBe(false);
      }
      const recovered = decodeReplayData(
        extension,
        {
          memo,
          resolvePromise: () => promise,
          restoreScheduledPromise: (_id, settled) => settled
        },
        parent
      ) as { owned: SandboxPromise };
      expect(recovered.owned).toBe(promise);
      expect(promiseProperties.get(promise)).toHaveProperty("replacement", 9);
      expect(decodeReplayData(initial, { memo }, parent)).toBe(retained);
      retained.forEach((node, index) => {
        expect(node.next).toBe(retained[(index + 1) % size]);
        expect(node.alias).toBe(node.next);
      });
    } finally {
      parent.dispose();
      operation.release();
    }
  }
);
