import { describe, expect, it, vi } from "vitest";

import { dump, serializeSafeJSSnapshot } from "./dump.js";
import { Budget } from "./interp/budget.js";
import { declareHostOperation } from "./interp/host-bridge.js";
import { lint } from "./lint.js";
import { run } from "./run.js";
import type { SafeJSSnapshot } from "./restore.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

describe("Promise construction", () => {
  it.each([
    {
      name: "bound constructor",
      source:
        "const Constructor = Promise.bind({ ignored: true }); const pending = new Constructor(resolve => resolve(42)); return [pending instanceof Promise, pending instanceof Constructor, await pending];"
    },
    {
      name: "pre-bound executor",
      source:
        "const Constructor = Promise.bind(null, resolve => resolve(42)).bind(null); return await new Constructor();"
    },
    {
      name: "bound executor",
      source:
        "const executor = function (value, resolve) { resolve(this.base + value); }; return await new Promise(executor.bind({ base: 40 }, 2));"
    },
    {
      name: "bound function receiver and argument order",
      source:
        "const action = function (first, second, third) { return [this.base, first, second, third]; }; const bound = action.bind({ base: 42 }, 1).bind({ base: 13 }, 2); return bound.call({ base: 99 }, 3);"
    },
    {
      name: "bound async executor",
      source:
        "let count = 0; const executor = async function (value, resolve) { count++; await 0; resolve(value); }; const pending = new Promise(executor.bind(null, 42)); return [count, await pending];"
    },
    {
      name: "invalid constructor argument evaluation",
      source:
        "const target = () => 42; let count = 0; try { new target(count++); } catch (error) { return [error.name, count]; }"
    },
    {
      name: "prototype identity",
      source:
        "const pending = Promise.resolve(42); return [pending.constructor === Promise, Promise.prototype.constructor === Promise, pending.then === pending.then, pending.then === Promise.resolve(1).then, pending.then === Promise.prototype.then];"
    },
    {
      name: "non-enumerable prototype methods",
      source: "return Object.keys(Promise.prototype);"
    },
    {
      name: "constructor brand",
      source:
        "const pending = new Promise(resolve => resolve(42)); return [pending instanceof Promise, Promise.resolve(1) instanceof Promise, {} instanceof Promise, await pending];"
    },
    { name: "fulfillment", source: "return await new Promise(resolve => resolve(42));" },
    {
      name: "rejection",
      source:
        "try { await new Promise((resolve, reject) => reject(42)); } catch (reason) { return reason; }"
    },
    {
      name: "executor throw",
      source:
        "try { await new Promise(() => { throw Error('executor'); }); } catch (error) { return error.message; }"
    },
    {
      name: "first resolution",
      source:
        "return await new Promise((resolve, reject) => { resolve(42); reject(13); resolve(99); throw Error('ignored'); });"
    },
    {
      name: "first rejection",
      source:
        "try { await new Promise((resolve, reject) => { reject(42); resolve(13); reject(99); throw Error('ignored'); }); } catch (reason) { return reason; }"
    },
    {
      name: "locked adoption",
      source:
        "return await new Promise((resolve, reject) => { resolve(Promise.resolve(42)); reject(13); });"
    },
    {
      name: "thenable receiver",
      source:
        "return await new Promise(resolve => resolve({ answer: 42, then: function (finish) { finish(this.answer); } }));"
    },
    {
      name: "undefined executor receiver",
      source:
        "let receiver; const pending = new Promise(function (resolve) { receiver = this; resolve(42); }); return [receiver === undefined, await pending];"
    },
    {
      name: "synchronous executor tail",
      source:
        "let count = 0; const pending = new Promise(resolve => { resolve(42); for (let index = 0; index < 32; index++) count++; }); const prefix = count; return [prefix, await pending, count];"
    },
    {
      name: "ignored synchronous return",
      source:
        "const pending = new Promise(() => 42); return await Promise.race([pending, Promise.resolve('pending')]);"
    },
    {
      name: "ignored asynchronous return",
      source:
        "const pending = new Promise(async () => 42); return await Promise.race([pending, Promise.resolve('pending')]);"
    },
    {
      name: "asynchronous executor prefix",
      source:
        "let finish; let completed = false; const pending = new Promise(async resolve => { finish = resolve; await 0; completed = true; return 13; }); const prefix = completed; finish(42); return [prefix, await pending, completed];"
    },
    {
      name: "self resolution",
      source:
        "let finish; const pending = new Promise(resolve => { finish = resolve; }); finish(pending); try { await pending; } catch (error) { return error.name; }"
    },
    {
      name: "chaining and finally",
      source:
        "const order = []; const pending = new Promise(resolve => { order.push('executor'); resolve(42); order.push('tail'); }); order.push('caller'); const value = await pending.then(value => { order.push('then'); return value + 1; }).finally(() => order.push('finally')); return [value, order];"
    },
    {
      name: "requires new",
      source: "try { Promise(() => undefined); } catch (error) { return error.name; }"
    },
    {
      name: "requires a callable executor",
      source: "try { new Promise(42); } catch (error) { return error.name; }"
    }
  ])("matches native $name", async ({ source }) => {
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: await new AsyncFunction(`"use strict"; ${source}`)()
    });
  });

  it.each(["resolve", "reject", "all", "race", "allSettled", "any"])(
    "rejects detached static %s synchronously",
    async (method) => {
      const source = `const method = Promise.${method}; try { method([]); return false; } catch (error) { return error.name; }`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(`"use strict"; ${source}`)()
      });
    }
  );

  it.each(["then", "catch", "finally"])("uses the %s receiver", async (method) => {
    const source = `const first = Promise.resolve(1); const second = Promise.resolve(42); const method = first.${method}; let detached; try { method(); } catch (error) { detached = error.name; } return [detached, await method.call(second, value => value)];`;
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: await new AsyncFunction(`"use strict"; ${source}`)()
    });
  });

  it.each([
    "const pending = new Promise(resolve => resolve(42)); return await pending;",
    "const Constructor = Promise; return await new Constructor(resolve => resolve(42));",
    "const Constructor = Promise.bind(null, resolve => resolve(42)); return await new Constructor();"
  ])("accepts construction in harness lint: %s", (source) => {
    expect(lint(source).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it.each([
    "const Constructor = identity(Promise); return [Constructor === Promise, await new Constructor(resolve => resolve(42))];",
    "return [identity(Promise) === Promise, await identity(Promise).resolve(42)];",
    "const callback = () => 42; return [identity(callback) === callback, identity(callback)()];"
  ])("preserves callable identity through cancelable host round trips: %s", async (source) => {
    const identity = (value: unknown) => value;
    expect(
      await run(source, {
        signal: new AbortController().signal,
        bindings: { identity }
      })
    ).toMatchObject({ ok: true, returnValue: [true, 42] });
  });

  it("does not invoke a host function after cancellation", async () => {
    const controller = new AbortController();
    const effect = vi.fn();
    controller.abort(new Error("cancelled"));
    expect(
      await run("try { effect(); } catch (error) { return error.message; }", {
        bindings: { effect },
        signal: controller.signal
      })
    ).toMatchObject({ ok: true, returnValue: "cancelled" });
    expect(effect).not.toHaveBeenCalled();
  });

  it("rejects pre-constructor replay semantics before host effects", async () => {
    const effect = vi.fn();
    const source = "effect(typeof Promise); return typeof Promise;";
    const original = await run(source, { bindings: { effect } });
    effect.mockClear();
    const snapshot = { ...original.snapshot, executionSemantics: "jobs-v1" };
    await expect(run(source, { snapshot, bindings: { effect } })).rejects.toMatchObject({
      name: "SnapshotValidationError",
      code: "unsupportedVersion",
      path: "$.executionSemantics"
    });
    expect(effect).not.toHaveBeenCalled();
  });

  it("does not retain prototype mutations when reusing a budget", async () => {
    const budget = new Budget();
    expect(
      await run("Promise.prototype.extra = 42; return Promise.resolve(1).extra;", { budget })
    ).toMatchObject({ ok: true, returnValue: 42 });
    expect(await run("return Promise.resolve(1).extra === undefined;", { budget })).toMatchObject({
      ok: true,
      returnValue: true
    });
  });

  it("reconstructs a pending resolver without repeating completed host effects", async () => {
    let save!: (snapshot: SafeJSSnapshot) => void;
    const saved = new Promise<SafeJSSnapshot>((resolve) => {
      save = resolve;
    });
    const controller = new AbortController();
    const record = vi.fn();
    const source =
      "record('before'); let finish; const pending = new Promise(resolve => { finish = resolve; }); const value = await read(); finish(value); const result = await pending; record('after'); return result;";
    const running = run(source, {
      signal: controller.signal,
      snapshotIntervalMs: -1,
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async remove() {},
        async write(snapshot) {
          save(snapshot);
        }
      },
      bindings: {
        record,
        read: declareHostOperation(() => {
          return new Promise<number>(() => undefined);
        }, "re-issue")
      }
    });
    const completion = running.catch((error) => error);
    let snapshot: SafeJSSnapshot;
    try {
      snapshot = JSON.parse(serializeSafeJSSnapshot(await saved));
    } finally {
      controller.abort();
      await completion;
    }
    const resumed = await run(source, {
      snapshot,
      bindings: { record, read: declareHostOperation(async () => 42, "re-issue") }
    });
    expect(resumed).toMatchObject({ ok: true, returnValue: 42 });
    expect(record.mock.calls).toEqual([["before"], ["after"]]);
  });

  it("replays completed constructor chains without losing captured resolvers", async () => {
    const source =
      "let finish; const pending = new Promise(resolve => { finish = resolve; }); finish(42); return await pending.then(value => value + 1);";
    let result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: 43 });
    for (let generation = 0; generation < 3; generation++) {
      result = await run(source, { snapshot: JSON.parse(await dump(result)) });
      expect(result).toMatchObject({ ok: true, returnValue: 43 });
    }
  });

  it("enforces executor step budgets before later host effects", async () => {
    const record = vi.fn();
    await expect(
      run("await new Promise(resolve => { while (true) {} resolve(42); }); record();", {
        budget: new Budget({ maxSteps: 40 }),
        bindings: { record }
      })
    ).rejects.toMatchObject({ name: "SandboxError", code: "budgetExceeded", budget: "steps" });
    expect(record).not.toHaveBeenCalled();
  });

  it.each(["resolve(42);", "reject(42);"])(
    "does not hide fatal executor budgets after %s",
    async (settlement) => {
      await expect(
        run(`return new Promise((resolve, reject) => { ${settlement} while (true) {} });`, {
          budget: new Budget({ maxSteps: 40 })
        })
      ).rejects.toMatchObject({ name: "SandboxError", code: "budgetExceeded", budget: "steps" });
    }
  );

  it("enforces call depth through nested bound constructors", async () => {
    await expect(
      run(
        "let Constructor = Promise; for (let index = 0; index < 20; index++) Constructor = Constructor.bind(null); return new Constructor(resolve => resolve(42));",
        {
          budget: new Budget({ maxCallDepth: 10 })
        }
      )
    ).rejects.toMatchObject({ name: "SandboxError", code: "budgetExceeded", budget: "callDepth" });
  });
});
