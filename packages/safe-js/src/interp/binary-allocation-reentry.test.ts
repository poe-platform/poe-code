import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";

it.each([
  ["ArrayBuffer", "resize", 8],
  ["ArrayBuffer", "resize", 2],
  ["SharedArrayBuffer", "grow", 8]
] as const)("preserves %s bytes and views after rejected %s(%i)", async (kind, operation, size) => {
  const budget = new Budget({ dataSize: 10000 });
  const result = await run(`
    const b = new ${kind}(4, {maxByteLength: 8});
    const tracking = new Uint8Array(b);
    tracking.set([18,52,86,120]);
    return {b, tracking, fixed: new Uint8Array(b, 1, 2), method: b.${operation}};
  `, { budget });
  expect(result.ok).toBe(true);
  const { b, tracking, fixed, method } = result.returnValue as {
    b: ArrayBuffer; tracking: Uint8Array; fixed: Uint8Array; method: unknown;
  };
  if (!isSandboxClosure(method)) throw new Error("Missing binary intrinsic");
  const retained = measureSandboxData(budget.retainedValues());
  const native = Reflect.get(globalThis[kind].prototype, operation);
  const apply = Reflect.apply;
  const spy = vi.spyOn(Reflect, "apply").mockImplementation((target, receiver, args) => {
    if (target === native && receiver === b) throw new RangeError("injected storage failure");
    return apply(target, receiver, args);
  });
  try {
    await expect(method.call([size], { stack: [], thisValue: b })).rejects.toThrow("injected storage failure");
  } finally {
    spy.mockRestore();
  }
  expect(b.byteLength).toBe(4);
  expect(Array.from(tracking)).toEqual([18, 52, 86, 120]);
  expect(Array.from(fixed)).toEqual([52, 86]);
  expect(fixed.buffer).toBe(b);
  expect(measureSandboxData(budget.retainedValues())).toBe(retained);
  await method.call([size], { stack: [], thisValue: b });
  expect(Array.from(tracking)).toEqual(size === 2 ? [18, 52] : [18, 52, 86, 120, 0, 0, 0, 0]);
  expect(fixed.length).toBe(size === 2 ? 0 : 2);
});

it.each(["ArrayBuffer", "SharedArrayBuffer"])("captures %s slice length before reentrant growth", async kind => {
  expect(await run(`
    const b = new ${kind}(4, {maxByteLength: 8});
    new Uint8Array(b).set([18,52,86,120]);
    const c = b.slice({valueOf() { b.${kind === "ArrayBuffer" ? "resize" : "grow"}(8); return -2; }});
    return [Array.from(new Uint8Array(c)), b.byteLength, c.byteLength];
  `)).toMatchObject({ ok: true, returnValue: [[86, 120], 8, 2] });
});

it.each(["ArrayBuffer", "SharedArrayBuffer"])("checks %s growth charge before mutation and releases rejected roots", async kind => {
  const budget = new Budget({ dataSize: 10000 });
  const operation = kind === "ArrayBuffer" ? "resize" : "grow";
  const result = await run(`
    const b = new ${kind}(4, {maxByteLength: 8});
    const a = new Uint8Array(b); a.set([18,52,86,120]);
    return {b, a, method: b.${operation}};
  `, { budget });
  expect(result.ok).toBe(true);
  const { b, a, method } = result.returnValue as { b: ArrayBuffer; a: Uint8Array; method: unknown };
  if (!isSandboxClosure(method)) throw new Error("Missing binary intrinsic");
  const retained = measureSandboxData(budget.retainedValues());
  const provision = vi.spyOn(budget, "provisionDataUsage").mockImplementation(() => {
    throw new RangeError("injected budget rejection");
  });
  try {
    await expect(method.call([8], { stack: [], thisValue: b })).rejects.toThrow("injected budget rejection");
    expect(provision).toHaveBeenCalledExactlyOnceWith(4);
    expect(Array.from(a)).toEqual([18, 52, 86, 120]);
    expect(b.byteLength).toBe(4);
    expect(measureSandboxData(budget.retainedValues())).toBe(retained);
  } finally {
    provision.mockRestore();
  }
  await method.call([8], { stack: [], thisValue: b });
  expect(Array.from(a)).toEqual([18, 52, 86, 120, 0, 0, 0, 0]);
});
