import { describe, expect, it, vi } from "vitest";

import { run } from "./run.js";
import { restore } from "./restore.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

describe("native promise execution order", () => {
  it.each(["race", "any"])(
    "preserves %s ordering between constructor adoption and async thenable returns",
    async (method) => {
      const source = `return await Promise.${method}([new Promise(resolve => resolve(Promise.resolve('left'))), (async () => ({ then: resolve => resolve('right') }))()]);`;
      expect(await run(source, { signal: new AbortController().signal })).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it.each([
    undefined,
    "legacy",
    "jobs-v1",
    "jobs-v2",
    "jobs-v3",
    "jobs-v4",
    "jobs-v5",
    "jobs-v9",
    null
  ])(
    "rejects incompatible execution semantics %s before host effects",
    async (executionSemantics) => {
      const source = "await read(); return 42;";
      const original = await run(source, { bindings: { read: async () => 1 } });
      const snapshot = { ...original.snapshot, executionSemantics };
      const read = vi.fn(async () => 1);
      expect(() => restore(snapshot, { source })).toThrow(/execution semantics/i);
      await expect(run(source, { snapshot, bindings: { read } })).rejects.toMatchObject({
        name: "SnapshotValidationError",
        code: "unsupportedVersion",
        path: "$.executionSemantics"
      });
      expect(read).not.toHaveBeenCalled();
    }
  );
  it.each([0, 1, 2])("preserves %i aggregate rejection reasons", async (width) => {
    const reasons = ["first", "second"].slice(0, width);
    const source = `try { await Promise.any(${JSON.stringify(reasons)}.map(reason => Promise.reject(reason))); } catch (error) { return [error instanceof AggregateError, error.errors]; }`;
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: await new AsyncFunction(source)()
    });
  });
  it.each([1, 16, 256])(
    "runs all %i synchronous-prefix iterations before returning an async promise",
    async (width) => {
      const source = `let count = 0; const action = async () => { for (let index = 0; index < ${width}; index++) count++; await Promise.resolve(); }; const pending = action(); const prefix = count; await pending; return [prefix, count];`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it.each([1, 16, 256])(
    "finishes %i thenable-tail iterations before its await continuation",
    async (width) => {
      const source = `let count = 0; await Promise.resolve({ then: (resolve) => { resolve(1); for (let index = 0; index < ${width}; index++) count++; } }); return count;`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it.each(["return count;", 'throw Error("expected");'])(
    "finishes an async body without an await before returning: %s",
    async (completion) => {
      const source = `let count = 0; const action = async () => { for (let index = 0; index < 16; index++) count++; ${completion} }; const pending = action(); const prefix = count; try { return [prefix, await pending]; } catch (error) { return [prefix, error.message]; }`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it("defers thenable jobs until surrounding synchronous code finishes", async () => {
    const source =
      'const order = []; const pending = Promise.resolve({ then: (resolve) => { order.push("then"); resolve(1); order.push("after"); } }); order.push("caller"); await pending; return order;';
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: await new AsyncFunction(source)()
    });
  });

  it.each([1, 16, 256])(
    "preserves %i caller iterations before async continuation",
    async (width) => {
      const source = `const order = []; const action = async () => { order.push("before"); await Promise.resolve(); order.push("after"); }; const pending = action(); for (let index = 0; index < ${width}; index++) order.push(index); await pending; return order;`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it.each([
    'const order = []; const first = async () => { order.push("first"); await 0; order.push("first-after"); }; const second = async () => { order.push("second"); await 0; order.push("second-after"); }; await Promise.all([first(), second()]); return order;',
    'const order = []; const pending = Promise.resolve({ then: async (resolve) => { order.push("then"); await 0; order.push("after"); resolve(42); } }); order.push("caller"); return [await pending, order];',
    'const order = []; const pending = Promise.resolve({ then: (resolve) => { order.push("outer"); resolve({ then: (finish) => { order.push("inner"); finish(42); } }); order.push("outer-tail"); } }); order.push("caller"); return [await pending, order];',
    'const order = []; const pending = Promise.resolve().then(async () => { order.push("reaction"); await Promise.resolve().then(() => order.push("nested")); order.push("after"); }); order.push("caller"); await pending; return order;'
  ])("matches native nested asynchronous jobs: %s", async (source) => {
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: await new AsyncFunction(source)()
    });
  });

  it("returns an async promise at its first await rather than waiting for its entire body", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source =
      "let count = 0; const action = async () => { for (let index = 0; index < 16; index++) count++; await pause(); count++; }; const pending = action(); const prefix = count; release(); await pending; return [prefix, count];";
    expect(
      await run(source, { bindings: { pause: () => gate, release: () => release() } })
    ).toMatchObject({ ok: true, returnValue: [16, 17] });
  });

  it.each([
    'const order = []; const value = { toJSON: async () => { order.push("json"); await 0; order.push("after"); return 42; } }; const text = JSON.stringify(value); order.push("caller"); await 0; return [text, order];',
    'const order = []; const text = JSON.stringify({ value: 42 }, async (key, value) => { order.push(key); await 0; order.push("after"); return value; }); order.push("caller"); await 0; return [text, order];',
    "return JSON.stringify({ pending: Promise.resolve(42), values: [Promise.resolve(1)] });",
    'const order = []; const pending = Array.from([1, 2], async (value) => { order.push(value); await 0; return value * 2; }); order.push("caller"); return [await Promise.all(pending), order];',
    'const order = []; const pending = Array.from([1, 2], (value) => Promise.resolve(value * 2)); order.push("caller"); return [await Promise.all(pending), order];',
    'const order = []; const pending = []; new Map([["a", 1], ["b", 2]]).forEach((value) => { pending.push((async () => { order.push(value); await 0; order.push(value + 10); })()); }); order.push("caller"); await Promise.all(pending); return order;',
    'const order = []; const pending = []; new Set([1, 2]).forEach((value) => { pending.push((async () => { order.push(value); await 0; order.push(value + 10); })()); }); order.push("caller"); await Promise.all(pending); return order;',
    'const order = []; const pending = []; const output = "aba".replaceAll("a", (value, index) => { const result = (async () => { order.push(index); await 0; order.push(index + 10); })(); pending.push(result); return result; }); order.push("caller"); await Promise.all(pending); return [output, order];'
  ])("does not implicitly await synchronous builtin callbacks: %s", async (source) => {
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: await new AsyncFunction(source)()
    });
  });
});
