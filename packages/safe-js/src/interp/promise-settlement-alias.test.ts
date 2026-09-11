import { expect, it } from "vitest";
import { deepCopyToSandbox, getPromiseProperties, isSandboxPromise } from "./values.js";
import { runInNewContext } from "node:vm";

it("retains the imported Promise identity when its fulfillment points back to it", async () => {
  let resolve!: (value: { promise?: Promise<unknown> }) => void;
  const original = new Promise<unknown>(done => { resolve = done; });
  const value = { promise: original } as { promise?: Promise<unknown> };
  const imported = deepCopyToSandbox(original);
  if (!isSandboxPromise(imported)) throw new Error("Missing imported Promise");
  resolve(value);
  const result = await imported.promise;
  // Stop the unfixed implementation's repeated re-import chain before asserting.
  delete value.promise;
  expect((result as { promise: unknown }).promise).toBe(imported);
});

it("preserves a sibling Promise reference in a settlement", async () => {
  const sibling = Promise.resolve(3);
  const original = Promise.resolve({ sibling });
  const imported = deepCopyToSandbox([original, sibling]);
  if (!Array.isArray(imported) || !isSandboxPromise(imported[0]))
    throw new Error("Missing imported Promise graph");
  const result = await imported[0].promise;
  expect((result as { sibling: unknown }).sibling).toBe(imported[1]);
});

it("preserves a previously imported Promise in a rejection reason", async () => {
  const sibling = Promise.resolve(3);
  const original = Promise.reject({ sibling });
  original.catch(() => undefined);
  const imported = deepCopyToSandbox([original, sibling]);
  if (!Array.isArray(imported) || !isSandboxPromise(imported[0]))
    throw new Error("Missing imported Promise graph");
  const reason = await imported[0].promise.catch(value => value);
  expect(reason.sibling).toBe(imported[1]);
});

it("closes mutual settlement references over the imported Promise graph", async () => {
  let resolveLeft!: (value: unknown) => void;
  let resolveRight!: (value: unknown) => void;
  const left = new Promise(done => { resolveLeft = done; });
  const right = new Promise(done => { resolveRight = done; });
  const leftValue: { peer?: Promise<unknown> } = { peer: right };
  const rightValue: { peer?: Promise<unknown> } = { peer: left };
  const imported = deepCopyToSandbox([left, right]);
  if (!Array.isArray(imported) || !isSandboxPromise(imported[0]) || !isSandboxPromise(imported[1]))
    throw new Error("Missing imported Promise graph");
  resolveLeft(leftValue);
  resolveRight(rightValue);
  const [a, b] = await Promise.all([imported[0].promise, imported[1].promise]);
  delete leftValue.peer;
  delete rightValue.peer;
  expect((a as { peer: unknown }).peer).toBe(imported[1]);
  expect((b as { peer: unknown }).peer).toBe(imported[0]);
});

it("keeps independent imports and ordinary settlement data independent", async () => {
  const shared = { value: 1 };
  const original = Promise.resolve(shared);
  const first = deepCopyToSandbox(original);
  const second = deepCopyToSandbox(original);
  const graph = deepCopyToSandbox([original, Promise.resolve(shared), shared]);
  if (!isSandboxPromise(first) || !isSandboxPromise(second) || !Array.isArray(graph) ||
      !isSandboxPromise(graph[0]) || !isSandboxPromise(graph[1]))
    throw new Error("Missing imported Promise graph");
  expect(first).not.toBe(second);
  shared.value = 2;
  const [a, b] = await Promise.all([graph[0].promise, graph[1].promise]);
  expect(a).toEqual({ value: 2 });
  expect(b).toEqual({ value: 2 });
  expect(a).not.toBe(b);
  expect(a).not.toBe(graph[2]);
  expect(graph[2]).toEqual({ value: 1 });
});

it("preserves foreign Promise settlement aliases without admitting own metadata", async () => {
  const sibling = runInNewContext("Promise.resolve(3)");
  const original = runInNewContext("Promise.resolve(value)", { value: { sibling } });
  let reads = 0;
  Object.defineProperty(sibling, "private", { get() { reads++; return "secret"; } });
  sibling[Symbol("host context")] = { secret: true };
  const imported = deepCopyToSandbox([original, sibling]);
  if (!Array.isArray(imported) || !isSandboxPromise(imported[0]) || !isSandboxPromise(imported[1]))
    throw new Error("Missing imported Promise graph");
  const result = await imported[0].promise;
  expect((result as { sibling: unknown }).sibling).toBe(imported[1]);
  expect(Reflect.ownKeys(getPromiseProperties(imported[1]))).toEqual([]);
  expect(reads).toBe(0);
});
