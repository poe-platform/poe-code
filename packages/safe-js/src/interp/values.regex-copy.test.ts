import { describe, expect, it, vi } from "vitest";
import { deepCopyFromSandbox as publicCopy, run } from "../index.js";
import { Budget } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import {
  createSandboxClosure,
  createSandboxRegex,
  deepCopyFromSandbox,
  isSandboxRegex
} from "./values.js";

describe("native regex copy identity", () => {
  it("preserves one guest regex identity within one public copy", async () => {
    const result = await run("const regex = /a/g; regex.lastIndex = 2; return [regex, regex];");
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const pair = result.returnValue as unknown[];
    expect(pair[0]).toBe(pair[1]);
    expect(isSandboxRegex(pair[0])).toBe(true);
    const before = Object.getOwnPropertyDescriptors(pair[0]);
    const copy = publicCopy(result.returnValue) as RegExp[];
    expect(copy[0]).toBeInstanceOf(RegExp);
    expect([copy[0].source, copy[0].flags, copy[0].lastIndex]).toEqual(["a", "g", 2]);
    expect(Object.getOwnPropertyDescriptor(copy[0], "lastIndex")).toEqual({
      value: 2,
      writable: true,
      enumerable: false,
      configurable: false
    });
    expect(Object.getOwnPropertyDescriptors(pair[0])).toEqual(before);
    expect(copy[0]).toBe(copy[1]);
  });

  it("does not intern distinct guest regexes with equal fields", async () => {
    const result = await run("return [/a/g, /a/g];");
    if (!result.ok) throw result.error;
    const copy = publicCopy(result.returnValue) as RegExp[];
    expect(copy[0]).toBeInstanceOf(RegExp);
    expect(copy[1]).toBeInstanceOf(RegExp);
    expect(copy[0]).not.toBe(copy[1]);
    expect([copy[0].source, copy[0].flags]).toEqual([copy[1].source, copy[1].flags]);
  });

  it("keeps independent public copies isolated", async () => {
    const result = await run("return /a/g;");
    if (!result.ok) throw result.error;
    const first = publicCopy(result.returnValue) as RegExp;
    const second = publicCopy(result.returnValue) as RegExp;
    expect(first).not.toBe(second);
    first.lastIndex = 4;
    expect(second.lastIndex).toBe(0);
    expect(result.returnValue).toMatchObject({ lastIndex: 0 });
  });

  it("preserves regex aliases across array, object, Map and Set cycles", async () => {
    const result = await run(`
      const regex = /a/g;
      const root = { regex, array: [regex], map: new Map(), set: new Set() };
      root.self = root;
      root.map.set(regex, root);
      root.set.add(regex);
      root.set.add(root);
      return root;
    `);
    if (!result.ok) throw result.error;
    type Graph = {
      regex: RegExp;
      array: RegExp[];
      map: Map<RegExp, Graph>;
      set: Set<unknown>;
      self: Graph;
    };
    const copy = publicCopy(result.returnValue) as Graph;
    expect(copy.self).toBe(copy);
    expect(copy.regex).toBeInstanceOf(RegExp);
    expect(copy.array[0]).toBe(copy.regex);
    expect(copy.map.get(copy.regex)).toBe(copy);
    expect(copy.set.has(copy.regex)).toBe(true);
    expect(copy.set.has(copy)).toBe(true);
  });

  it("preserves shared regex arguments through the ordinary host bridge", async () => {
    const observe = vi.fn((first: unknown, second: unknown) => first === second);
    const result = await run("const regex = /a/g; return observe(regex, regex);", {
      bindings: { observe }
    });
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][0]).toBeInstanceOf(RegExp);
    expect(result).toMatchObject({ ok: true, returnValue: true });
  });

  it.each([
    { repeated: true, steps: 7, data: 3 },
    { repeated: false, steps: 10, data: 6 }
  ])(
    "charges preflight per encounter and native allocation per identity: $repeated",
    ({ repeated, steps, data }) => {
      const first = createSandboxRegex("a", "g");
      const second = repeated ? first : createSandboxRegex("a", "g");
      const budget = new Budget();
      const operation = budget.acquireCompileOwner();
      const compilation = new CompileScope(operation.owner);
      try {
        deepCopyFromSandbox([first, second], { compilation });
        expect(budget.stepsUsed).toBe(steps);
        expect(budget.currentDataSize).toBe(data);
        expect(compilation.tickets.size).toBe(repeated ? 1 : 2);
      } finally {
        compilation.dispose();
        operation.release();
      }
      expect(budget.currentDataSize).toBe(0);
    }
  );

  it.each(["source", "flags"] as const)(
    "validates own DATA %s before a memo hit without invoking hooks",
    (field) => {
      const regex = createSandboxRegex("a");
      const hook = vi.fn(() => "a");
      const closure = createSandboxClosure({ call: () => undefined });
      expect(() =>
        publicCopy([regex, closure, regex], {
          wrapClosure: () => {
            Object.defineProperty(regex, field, { get: hook });
            return undefined;
          }
        })
      ).toThrow(TypeError);
      expect(hook).not.toHaveBeenCalled();
    }
  );

  it("preflights changed source length before a memo hit and releases only owned charges", () => {
    const regex = createSandboxRegex("a");
    const closure = createSandboxClosure({ call: () => undefined });
    const budget = new Budget({ stringLength: 3 });
    const unrelated = {};
    budget.setRetainedDataUsage(unrelated, 5);
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    try {
      expect(() =>
        deepCopyFromSandbox([regex, closure, regex], {
          compilation,
          wrapClosure: () => {
            Object.defineProperty(regex, "source", { value: "abcd" });
            return undefined;
          }
        })
      ).toThrowError(
        expect.objectContaining({
          code: "budgetExceeded",
          budget: "stringLength",
          current: 4,
          limit: 3
        })
      );
      expect(budget.currentDataSize).toBe(7);
      expect(compilation.tickets.size).toBe(1);
    } finally {
      compilation.dispose();
      operation.release();
    }
    expect(budget.currentDataSize).toBe(5);
  });

  it("does not bypass work exhaustion on a memo hit", () => {
    const regex = createSandboxRegex("a");
    const budget = new Budget({ maxSteps: 3 });
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    try {
      expect(() => deepCopyFromSandbox([regex, regex], { compilation })).toThrowError(
        expect.objectContaining({ code: "budgetExceeded", budget: "steps", current: 4, limit: 3 })
      );
    } finally {
      compilation.dispose();
      operation.release();
    }
    expect(budget.currentDataSize).toBe(0);
  });

  it("refuses a stale owner before returning a memoized regex", () => {
    const regex = createSandboxRegex("a");
    const closure = createSandboxClosure({ call: () => undefined });
    const budget = new Budget();
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    let nextOperation: ReturnType<Budget["acquireCompileOwner"]> | undefined;
    try {
      expect(() =>
        deepCopyFromSandbox([regex, closure, regex], {
          compilation,
          wrapClosure: () => {
            operation.release();
            nextOperation = budget.acquireCompileOwner(true);
            return undefined;
          }
        })
      ).toThrowError(expect.objectContaining({ code: "reentry" }));
    } finally {
      compilation.dispose();
      operation.release();
      nextOperation?.release();
    }
    expect(budget.currentDataSize).toBe(0);
  });

  it("does not retain a failed native construction and allows a later valid copy", () => {
    const regex = createSandboxRegex("a");
    Object.defineProperty(regex, "flags", { value: "gg" });
    const budget = new Budget();
    const operation = budget.acquireCompileOwner();
    const compilation = new CompileScope(operation.owner);
    try {
      expect(() => deepCopyFromSandbox(regex, { compilation })).toThrow(SyntaxError);
      expect(budget.currentDataSize).toBe(0);
      expect(compilation.tickets.size).toBe(0);
      Object.defineProperty(regex, "flags", { value: "g" });
      expect(deepCopyFromSandbox(regex, { compilation })).toBeInstanceOf(RegExp);
      expect(budget.stepsUsed).toBe(12);
    } finally {
      compilation.dispose();
      operation.release();
    }
    expect(budget.currentDataSize).toBe(0);
  });
});
